import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';

// Constants and Configuration
const TARGET_BYTES = 80_000;
const TOLERANCE_BALANCED = 10_000;
const TOLERANCE_EXACT = 0;
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const MAX_WALL_TIME_BALANCED = 90_000; // 90 seconds
const MAX_WALL_TIME_EXACT = 90_000; // 90 seconds
const Q_ITERS = 14; // Quality iterations
const S_ITERS = 5; // Scale iterations
const PALETTE_ITER = 3; // Palette iterations
const MAX_CONCURRENT_JOBS = 5;

// Supported formats and types
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png'];
const SUPPORTED_OUTPUT_FORMATS = ['webp', 'avif'] as const;
type OutputFormat = typeof SUPPORTED_OUTPUT_FORMATS[number];

// Compression modes
type CompressionMode = 'exact' | 'balanced';

// Compression result interface
interface CompressionResult {
  buffer: Buffer;
  quality: number;
  size: number;
  dimensions: { width: number; height: number };
  exactMatch: boolean;
  iterations: number;
  mode: CompressionMode;
  processingTime: number;
  scaleFactor?: number;
  paletteReduced?: boolean;
}

// Logging interface
interface CompressionLog {
  requestId: string;
  mode: CompressionMode;
  inputBytes: number;
  inputDims: { width: number; height: number };
  format: OutputFormat;
  iterations: number;
  bestQ: number;
  bestSize: number;
  finalSize: number;
  finalDims: { width: number; height: number };
  exactMatch: 0 | 1;
  durationMs: number;
  cpuSec: number;
  scaleFactor?: number;
  paletteReduced?: boolean;
}

// Resource management
let activeJobs = 0;

class HybridCompressor {
  private targetSize: number;
  private tolerance: number;
  private maxWallTime: number;
  private mode: CompressionMode;
  private requestId: string;
  private startTime: number;

  constructor(mode: CompressionMode = 'balanced') {
    this.mode = mode;
    this.targetSize = TARGET_BYTES;
    this.tolerance = mode === 'exact' ? TOLERANCE_EXACT : TOLERANCE_BALANCED;
    this.maxWallTime = mode === 'exact' ? MAX_WALL_TIME_EXACT : MAX_WALL_TIME_BALANCED;
    this.requestId = uuidv4();
    this.startTime = Date.now();
  }

  private log(message: string, data?: any) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${this.requestId}] ${message}`, data || '');
  }

  private isWithinTolerance(size: number): boolean {
    return Math.abs(size - this.targetSize) <= this.tolerance;
  }

  private isExactMatch(size: number): boolean {
    return size === this.targetSize;
  }

  private checkTimeout(): boolean {
    return (Date.now() - this.startTime) > this.maxWallTime;
  }

  private async encodeImage(buffer: Buffer, quality: number, format: OutputFormat, scaleFactor: number = 1): Promise<Buffer> {
    let pipeline = sharp(buffer)
      .withMetadata({}) // Remove all metadata for determinism
      .rotate(); // Auto-rotate based on EXIF

    // Apply scaling if needed
    if (scaleFactor < 1) {
      const metadata = await sharp(buffer).metadata();
      if (metadata.width && metadata.height) {
        pipeline = pipeline.resize({
          width: Math.round(metadata.width * scaleFactor),
          height: Math.round(metadata.height * scaleFactor),
          fit: 'inside',
          kernel: sharp.kernel.lanczos3 // Deterministic resizing
        });
      }
    }

    // Apply format-specific encoding
    switch (format) {
      case 'webp':
        return pipeline.webp({
          quality,
          effort: 6, // Fixed effort for determinism
          lossless: false
        }).toBuffer();
      
      case 'avif':
        return pipeline.avif({
          quality,
          effort: 6 // Fixed effort for determinism
        }).toBuffer();
      
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  private async binarySearchQuality(
    buffer: Buffer, 
    format: OutputFormat, 
    scaleFactor: number = 1
  ): Promise<{ buffer: Buffer; quality: number; size: number; iterations: number }> {
    let low = 1;
    let high = 100;
    let bestResult: { buffer: Buffer; quality: number; size: number } | null = null;
    let iterations = 0;

    this.log(`Starting binary search for ${format} at scale ${scaleFactor}`);

    while (low <= high && iterations < Q_ITERS && !this.checkTimeout()) {
      const quality = Math.floor((low + high) / 2);
      
      try {
        const result = await this.encodeImage(buffer, quality, format, scaleFactor);
        const size = result.length;
        
        this.log(`Iteration ${iterations + 1}: Quality=${quality}, Size=${size}, Target=${this.targetSize}, Diff=${size - this.targetSize}`);
        
        // Track best result
        if (!bestResult || Math.abs(size - this.targetSize) < Math.abs(bestResult.size - this.targetSize)) {
          bestResult = { buffer: result, quality, size };
        }

        // Check if we're within tolerance
        if (this.isWithinTolerance(size)) {
          this.log(`Found acceptable result: ${size} bytes (within tolerance)`);
          return { buffer: result, quality, size, iterations: iterations + 1 };
        }

        // Adjust search bounds
        if (size > this.targetSize) {
          high = quality - 1;
        } else {
          low = quality + 1;
        }

        iterations++;
      } catch (error) {
        this.log(`Error encoding at quality ${quality}:`, error);
        high = quality - 1;
        iterations++;
      }
    }

    // Return best result if no exact match found
    if (bestResult) {
      this.log(`Binary search completed. Best result: ${bestResult.size} bytes at quality ${bestResult.quality}`);
      return { ...bestResult, iterations };
    }

    throw new Error('Binary search failed to produce any result');
  }

  private async microBruteOptimization(
    buffer: Buffer, 
    format: OutputFormat, 
    baseQuality: number, 
    scaleFactor: number = 1
  ): Promise<{ buffer: Buffer; quality: number; size: number }> {
    this.log(`Starting micro-brute optimization around quality ${baseQuality}`);
    
    let bestResult: { buffer: Buffer; quality: number; size: number } | null = null;
    const range = 3;
    
    for (let offset = -range; offset <= range; offset++) {
      const quality = Math.max(1, Math.min(100, baseQuality + offset));
      
      try {
        const result = await this.encodeImage(buffer, quality, format, scaleFactor);
        const size = result.length;
        
        if (!bestResult || Math.abs(size - this.targetSize) < Math.abs(bestResult.size - this.targetSize)) {
          bestResult = { buffer: result, quality, size };
        }
        
        if (this.isExactMatch(size)) {
          this.log(`Exact match found at quality ${quality}: ${size} bytes`);
          return { buffer: result, quality, size };
        }
      } catch (error) {
        this.log(`Error in micro-brute at quality ${quality}:`, error);
      }
    }
    
    if (bestResult) {
      this.log(`Micro-brute completed. Best result: ${bestResult.size} bytes at quality ${bestResult.quality}`);
      return bestResult;
    }
    
    throw new Error('Micro-brute optimization failed');
  }

  private async progressiveScaling(
    buffer: Buffer, 
    format: OutputFormat
  ): Promise<{ buffer: Buffer; quality: number; size: number; scaleFactor: number; iterations: number }> {
    // More aggressive scaling for exact mode
    const scaleFactors = this.mode === 'exact' 
      ? [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2]
      : [0.9, 0.8, 0.7, 0.6, 0.5];
    let totalIterations = 0;
    let bestResult: { buffer: Buffer; quality: number; size: number; scaleFactor: number; iterations: number } | null = null;
    
    this.log('Starting progressive scaling');
    
    for (const scaleFactor of scaleFactors) {
      if (this.checkTimeout()) {
        this.log('Timeout reached during progressive scaling');
        break;
      }
      
      try {
        const result = await this.binarySearchQuality(buffer, format, scaleFactor);
        totalIterations += result.iterations;
        
        // Track best result
        if (!bestResult || Math.abs(result.size - this.targetSize) < Math.abs(bestResult.size - this.targetSize)) {
          bestResult = { ...result, scaleFactor, iterations: totalIterations };
        }
        
        if (this.isWithinTolerance(result.size)) {
          this.log(`Progressive scaling succeeded at scale ${scaleFactor}: ${result.size} bytes`);
          return { ...result, scaleFactor, iterations: totalIterations };
        }
      } catch (error) {
        this.log(`Error in progressive scaling at scale ${scaleFactor}:`, error);
      }
    }
    
    // Return best result if no exact match found
    if (bestResult) {
      this.log(`Progressive scaling completed with best result: ${bestResult.size} bytes at scale ${bestResult.scaleFactor}`);
      return bestResult;
    }
    
    throw new Error('Progressive scaling failed to produce any result');
  }

  private async paletteReduction(
    buffer: Buffer, 
    format: OutputFormat
  ): Promise<{ buffer: Buffer; quality: number; size: number; iterations: number }> {
    if (format !== 'webp') {
      throw new Error('Palette reduction only supported for WebP');
    }
    
    this.log('Starting palette reduction');
    
    // Convert to PNG with palette reduction
    const paletteSizes = [256, 128, 64, 32];
    let totalIterations = 0;
    let bestResult: { buffer: Buffer; quality: number; size: number; iterations: number } | null = null;
    
    for (const paletteSize of paletteSizes) {
      if (this.checkTimeout()) {
        this.log('Timeout reached during palette reduction');
        break;
      }
      
      try {
        // Create palette-reduced PNG first
        const pngBuffer = await sharp(buffer)
          .withMetadata({})
          .png({ palette: true, colors: paletteSize })
          .toBuffer();
        
        // Then convert to WebP
        const result = await this.binarySearchQuality(pngBuffer, format);
        totalIterations += result.iterations;
        
        // Track best result
        if (!bestResult || Math.abs(result.size - this.targetSize) < Math.abs(bestResult.size - this.targetSize)) {
          bestResult = { ...result, iterations: totalIterations };
        }
        
        if (this.isWithinTolerance(result.size)) {
          this.log(`Palette reduction succeeded with ${paletteSize} colors: ${result.size} bytes`);
          return { ...result, iterations: totalIterations };
        }
      } catch (error) {
        this.log(`Error in palette reduction with ${paletteSize} colors:`, error);
      }
    }
    
    // Return best result if no exact match found
    if (bestResult) {
      this.log(`Palette reduction completed with best result: ${bestResult.size} bytes`);
      return bestResult;
    }
    
    throw new Error('Palette reduction failed to produce any result');
  }

  private async lastResortOptimization(
    buffer: Buffer, 
    format: OutputFormat
  ): Promise<{ buffer: Buffer; quality: number; size: number; iterations: number }> {
    if (this.mode !== 'exact') {
      throw new Error('Last resort optimization only available in exact mode');
    }
    
    this.log('Starting last resort optimization');
    
    // Try different effort settings
    const effortSettings = format === 'webp' ? [6, 7, 8] : [6, 7, 8];
    let totalIterations = 0;
    
    for (const effort of effortSettings) {
      if (this.checkTimeout()) {
        this.log('Timeout reached during last resort optimization');
        break;
      }
      
      try {
        // Encode with different effort
        const result = await sharp(buffer)
          .withMetadata({})
          .rotate()
          [format]({ quality: 1, effort })
          .toBuffer();
        
        totalIterations++;
        
        if (this.isExactMatch(result.length)) {
          this.log(`Last resort succeeded with effort ${effort}: ${result.length} bytes`);
          return { buffer: result, quality: 1, size: result.length, iterations: totalIterations };
        }
      } catch (error) {
        this.log(`Error in last resort with effort ${effort}:`, error);
      }
    }
    
    // Final brute force over all qualities
    this.log('Starting final brute force over all qualities');
    
    for (let quality = 1; quality <= 100; quality++) {
      if (this.checkTimeout()) {
        this.log('Timeout reached during final brute force');
        break;
      }
      
      try {
        const result = await this.encodeImage(buffer, quality, format);
        totalIterations++;
        
        if (this.isExactMatch(result.length)) {
          this.log(`Final brute force succeeded at quality ${quality}: ${result.length} bytes`);
          return { buffer: result, quality, size: result.length, iterations: totalIterations };
        }
      } catch (error) {
        this.log(`Error in final brute force at quality ${quality}:`, error);
      }
    }
    
    throw new Error('Last resort optimization failed');
  }

  async compress(inputBuffer: Buffer, format: OutputFormat): Promise<CompressionResult> {
    this.log(`Starting compression in ${this.mode} mode for ${format}`);
    
    const inputSize = inputBuffer.length;
    const inputDims = await sharp(inputBuffer).metadata();
    
    if (!inputDims.width || !inputDims.height) {
      throw new Error('Invalid image dimensions');
    }
    
    this.log(`Input: ${inputSize} bytes, ${inputDims.width}x${inputDims.height}`);
    
    let result: CompressionResult;
    let totalIterations = 0;
    
    try {
      // Phase 1: Binary search with micro-brute
      const binaryResult = await this.binarySearchQuality(inputBuffer, format);
      totalIterations += binaryResult.iterations;
      
      if (this.isWithinTolerance(binaryResult.size)) {
        const microResult = await this.microBruteOptimization(inputBuffer, format, binaryResult.quality);
        totalIterations++;
        
        result = {
          buffer: microResult.buffer,
          quality: microResult.quality,
          size: microResult.size,
          dimensions: { width: inputDims.width, height: inputDims.height },
          exactMatch: this.isExactMatch(microResult.size),
          iterations: totalIterations,
          mode: this.mode,
          processingTime: Date.now() - this.startTime
        };
        
        this.log(`Compression completed in phase 1: ${result.size} bytes`);
        return result;
      }
      
      // Phase 2: Progressive scaling
      if (this.checkTimeout()) {
        this.log('Timeout reached before scaling phase, returning best result from phase 1');
        result = {
          buffer: binaryResult.buffer,
          quality: binaryResult.quality,
          size: binaryResult.size,
          dimensions: { width: inputDims.width, height: inputDims.height },
          exactMatch: false,
          iterations: totalIterations,
          mode: this.mode,
          processingTime: Date.now() - this.startTime
        };
        return result;
      }
      
      let scaleResult;
      try {
        scaleResult = await this.progressiveScaling(inputBuffer, format);
        totalIterations += scaleResult.iterations;
        
        if (this.isWithinTolerance(scaleResult.size)) {
          result = {
            buffer: scaleResult.buffer,
            quality: scaleResult.quality,
            size: scaleResult.size,
            dimensions: { width: inputDims.width, height: inputDims.height },
            exactMatch: this.isExactMatch(scaleResult.size),
            iterations: totalIterations,
            mode: this.mode,
            processingTime: Date.now() - this.startTime,
            scaleFactor: scaleResult.scaleFactor
          };
          
          this.log(`Compression completed in phase 2: ${result.size} bytes`);
          return result;
        }
      } catch (error) {
        this.log('Progressive scaling failed, continuing with best result from phase 1:', error);
        // Continue with best result from phase 1
      }
      
      // Phase 3: Palette reduction (WebP only)
      if (format === 'webp' && !this.checkTimeout()) {
        try {
          const paletteResult = await this.paletteReduction(inputBuffer, format);
          totalIterations += paletteResult.iterations;
          
          if (this.isWithinTolerance(paletteResult.size)) {
            result = {
              buffer: paletteResult.buffer,
              quality: paletteResult.quality,
              size: paletteResult.size,
              dimensions: { width: inputDims.width, height: inputDims.height },
              exactMatch: this.isExactMatch(paletteResult.size),
              iterations: totalIterations,
              mode: this.mode,
              processingTime: Date.now() - this.startTime,
              paletteReduced: true
            };
            
            this.log(`Compression completed in phase 3: ${result.size} bytes`);
            return result;
          }
        } catch (error) {
          this.log('Palette reduction failed, continuing to last resort:', error);
        }
      }
      
      // Phase 4: Last resort (Exact mode only)
      if (this.mode === 'exact' && !this.checkTimeout()) {
        try {
          const lastResortResult = await this.lastResortOptimization(inputBuffer, format);
          totalIterations += lastResortResult.iterations;
          
          result = {
            buffer: lastResortResult.buffer,
            quality: lastResortResult.quality,
            size: lastResortResult.size,
            dimensions: { width: inputDims.width, height: inputDims.height },
            exactMatch: this.isExactMatch(lastResortResult.size),
            iterations: totalIterations,
            mode: this.mode,
            processingTime: Date.now() - this.startTime
          };
          
          this.log(`Compression completed in phase 4: ${result.size} bytes`);
          return result;
        } catch (error) {
          this.log('Last resort optimization failed:', error);
        }
      }
      
      // If we get here, return the best available result
      const bestResult = scaleResult || binaryResult;
      result = {
        buffer: bestResult.buffer,
        quality: bestResult.quality,
        size: bestResult.size,
        dimensions: { width: inputDims.width, height: inputDims.height },
        exactMatch: false,
        iterations: totalIterations,
        mode: this.mode,
        processingTime: Date.now() - this.startTime,
        scaleFactor: scaleResult?.scaleFactor
      };
      
      this.log(`Compression completed with best available result: ${result.size} bytes`);
      return result;
      
    } catch (error) {
      this.log('Compression failed:', error);
      throw error;
    }
  }

  generateLog(result: CompressionResult, inputBuffer: Buffer, format: OutputFormat): CompressionLog {
    const inputDims = { width: 0, height: 0 };
    // Note: In a real implementation, you'd extract input dimensions from metadata
    
    return {
      requestId: this.requestId,
      mode: this.mode,
      inputBytes: inputBuffer.length,
      inputDims,
      format,
      iterations: result.iterations,
      bestQ: result.quality,
      bestSize: result.size,
      finalSize: result.size,
      finalDims: result.dimensions,
      exactMatch: result.exactMatch ? 1 : 0,
      durationMs: result.processingTime,
      cpuSec: result.processingTime / 1000,
      scaleFactor: result.scaleFactor,
      paletteReduced: result.paletteReduced
    };
  }
}

function generateFilename(originalName: string, format: OutputFormat, result: CompressionResult): string {
  const sanitizedName = originalName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  
  const mode = result.mode.toUpperCase();
  const { width, height } = result.dimensions;
  
  return `exact80--${sanitizedName}--${format}--${result.size}B--w${width}h${height}--q${result.quality}--m${mode}.${format}`;
}

export async function POST(request: NextRequest) {
  // Resource management
  if (activeJobs >= MAX_CONCURRENT_JOBS) {
    return NextResponse.json(
      { error: 'Server busy. Please try again later.' },
      { status: 503 }
    );
  }

  activeJobs++;
  
  try {
    const formData = await request.formData();
    const file = formData.get('image') as File;
    const format = formData.get('format') as OutputFormat;
    const mode = (formData.get('mode') as CompressionMode) || 'balanced';

    if (!file) {
      return NextResponse.json({ error: 'No image file provided' }, { status: 400 });
    }

    if (!SUPPORTED_OUTPUT_FORMATS.includes(format)) {
      return NextResponse.json({ error: 'Unsupported output format' }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large' }, { status: 400 });
    }

    const inputBuffer = Buffer.from(await file.arrayBuffer());
    const compressor = new HybridCompressor(mode);
    
    const result = await compressor.compress(inputBuffer, format);
    const log = compressor.generateLog(result, inputBuffer, format);
    
    // Log the compression result
    console.log('Compression metrics:', log);
    
    // Generate filename
    const filename = generateFilename(file.name, format, result);
    
    // Set response headers
    const headers = new Headers();
    headers.set('Content-Type', `image/${format}`);
    headers.set('Content-Length', result.buffer.length.toString());
    headers.set('X-Exact-Match', result.exactMatch ? '1' : '0');
    headers.set('X-Result-Bytes', result.size.toString());
    headers.set('X-Compression-Quality', result.quality.toString());
    headers.set('X-Iterations', result.iterations.toString());
    headers.set('X-Processing-Time', result.processingTime.toString());
    headers.set('X-Mode', result.mode);
    headers.set('X-Compression-Ratio', (inputBuffer.length / result.size).toFixed(2));
    headers.set('X-Scale-Factor', result.scaleFactor?.toString() || '1');
    headers.set('X-Palette-Reduced', result.paletteReduced ? '1' : '0');
    headers.set('Content-Disposition', `attachment; filename="${filename}"`);

    return new NextResponse(result.buffer as BodyInit, { headers });
    
  } catch (error) {
    console.error('Compression API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Compression failed' },
      { status: 500 }
    );
  } finally {
    activeJobs--;
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}