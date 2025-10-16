import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { Worker } from 'worker_threads';
import { promisify } from 'util';

// Performance Configuration
const TARGET_BYTES = 80_000;
const TOLERANCE_BALANCED = 10_000;
const TOLERANCE_EXACT = 0;
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const MAX_WALL_TIME_BALANCED = 30_000; // 30 seconds (reduced from 90)
const MAX_WALL_TIME_EXACT = 45_000; // 45 seconds (reduced from 90)
const MAX_CONCURRENT_JOBS = 20; // Increased from 5
const MEMORY_LIMIT_PER_JOB = 100 * 1024 * 1024; // 100MB

// Adaptive Heuristics Configuration
const ADAPTIVE_CONFIG = {
  smallImageThreshold: 1024 * 1024, // 1MB
  mediumImageThreshold: 5 * 1024 * 1024, // 5MB
  maxIterations: {
    small: 5,
    medium: 8,
    large: 12
  },
  qualityBounds: {
    min: 60,
    max: 95
  },
  parallelTests: 4 // Number of parallel quality tests
};

// Supported formats and types
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png'];
const SUPPORTED_OUTPUT_FORMATS = ['webp', 'avif'] as const;
type OutputFormat = typeof SUPPORTED_OUTPUT_FORMATS[number];
type CompressionMode = 'exact' | 'balanced';

// Enhanced interfaces
interface ImageMetadata {
  width: number;
  height: number;
  size: number;
  format: string;
  channels: number;
  density?: number;
  hasAlpha: boolean;
  complexity: number;
}

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
  cacheHit?: boolean;
  parallelTests?: number;
}

interface CompressionMetrics {
  processingTime: number;
  iterationsUsed: number;
  memoryPeak: number;
  cpuUsage: number;
  finalSize: number;
  qualityAchieved: number;
  exactMatch: boolean;
  compressionRatio: number;
  queueLength: number;
  activeJobs: number;
  cacheHitRate: number;
  errorRate: number;
}

interface AdaptiveHeuristics {
  imageComplexity: number;
  estimatedQuality: number;
  maxIterations: number;
  timeoutStrategy: 'aggressive' | 'conservative';
  parallelTests: number;
}

// Resource management
let activeJobs = 0;
let totalJobsProcessed = 0;
let cacheHits = 0;
const jobQueue: Array<() => Promise<void>> = [];

// Simple in-memory cache (in production, use Redis)
const compressionCache = new Map<string, Buffer>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const cacheTimestamps = new Map<string, number>();

class AdaptiveHeuristicsEngine {
  calculateComplexity(metadata: ImageMetadata): number {
    const { width, height, channels, hasAlpha } = metadata;
    
    // Base complexity from dimensions
    const pixelCount = width * height;
    const dimensionComplexity = Math.min(1, Math.log10(pixelCount) / 7); // 0-1 scale
    
    // Channel complexity
    const channelComplexity = (channels + (hasAlpha ? 1 : 0)) / 4; // 0-1 scale
    
    // Size complexity
    const sizeComplexity = Math.min(1, Math.log10(metadata.size) / 8); // 0-1 scale
    
    // Combined complexity (weighted average)
    return (dimensionComplexity * 0.4 + channelComplexity * 0.3 + sizeComplexity * 0.3);
  }
  
  estimateStartingQuality(metadata: ImageMetadata): number {
    const complexity = this.calculateComplexity(metadata);
    const sizeRatio = metadata.size / (metadata.width * metadata.height);
    
    // Heuristic formula: higher complexity = lower starting quality
    const baseQuality = 85;
    const complexityPenalty = complexity * 20;
    const sizePenalty = Math.min(10, sizeRatio * 1000);
    
    return Math.max(
      ADAPTIVE_CONFIG.qualityBounds.min,
      Math.min(
        ADAPTIVE_CONFIG.qualityBounds.max,
        baseQuality - complexityPenalty - sizePenalty
      )
    );
  }
  
  calculateMaxIterations(metadata: ImageMetadata): number {
    const complexity = this.calculateComplexity(metadata);
    
    if (metadata.size < ADAPTIVE_CONFIG.smallImageThreshold) {
      return ADAPTIVE_CONFIG.maxIterations.small;
    } else if (metadata.size < ADAPTIVE_CONFIG.mediumImageThreshold) {
      return ADAPTIVE_CONFIG.maxIterations.medium;
    } else {
      return ADAPTIVE_CONFIG.maxIterations.large;
    }
  }
  
  generateHeuristics(metadata: ImageMetadata): AdaptiveHeuristics {
    return {
      imageComplexity: this.calculateComplexity(metadata),
      estimatedQuality: this.estimateStartingQuality(metadata),
      maxIterations: this.calculateMaxIterations(metadata),
      timeoutStrategy: metadata.size > ADAPTIVE_CONFIG.mediumImageThreshold ? 'conservative' : 'aggressive',
      parallelTests: Math.min(ADAPTIVE_CONFIG.parallelTests, Math.max(2, Math.floor(metadata.size / (1024 * 1024))))
    };
  }
}

class ParallelCompressor {
  private targetSize: number;
  private tolerance: number;
  private maxWallTime: number;
  private mode: CompressionMode;
  private requestId: string;
  private startTime: number;
  private heuristics: AdaptiveHeuristics;
  private memoryUsage: number = 0;

  constructor(mode: CompressionMode = 'balanced', heuristics: AdaptiveHeuristics) {
    this.mode = mode;
    this.targetSize = TARGET_BYTES;
    this.tolerance = mode === 'exact' ? TOLERANCE_EXACT : TOLERANCE_BALANCED;
    this.maxWallTime = mode === 'exact' ? MAX_WALL_TIME_EXACT : MAX_WALL_TIME_BALANCED;
    this.requestId = uuidv4();
    this.startTime = Date.now();
    this.heuristics = heuristics;
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

  private trackMemory(buffer: Buffer): void {
    this.memoryUsage += buffer.length;
    if (this.memoryUsage > MEMORY_LIMIT_PER_JOB) {
      throw new Error('Memory limit exceeded');
    }
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

    // Apply format-specific encoding with optimized settings
    switch (format) {
      case 'webp':
        return pipeline.webp({
          quality,
          effort: 4, // Reduced from 6 for speed
          lossless: false,
          smartSubsample: true
        }).toBuffer();
      
      case 'avif':
        return pipeline.avif({
          quality,
          effort: 4, // Reduced from 6 for speed
          speed: 6, // Faster encoding
          chromaSubsampling: '4:2:0' // Faster encoding
        }).toBuffer();
      
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  private async parallelQualityTest(
    buffer: Buffer, 
    format: OutputFormat, 
    qualities: number[]
  ): Promise<Array<{ quality: number; size: number; buffer: Buffer }>> {
    this.log(`Testing ${qualities.length} qualities in parallel: ${qualities.join(', ')}`);
    
    const promises = qualities.map(async (quality) => {
      try {
        const result = await this.encodeImage(buffer, quality, format);
        this.trackMemory(result);
        return {
          quality,
          size: result.length,
          buffer: result
        };
      } catch (error) {
        this.log(`Error testing quality ${quality}:`, error);
        return null;
      }
    });

    const results = await Promise.all(promises);
    return results.filter(result => result !== null) as Array<{ quality: number; size: number; buffer: Buffer }>;
  }

  private async parallelBinarySearch(
    buffer: Buffer, 
    format: OutputFormat, 
    initialResults: Array<{ quality: number; size: number; buffer: Buffer }>
  ): Promise<{ buffer: Buffer; quality: number; size: number; iterations: number }> {
    
    // Find the best starting point from parallel tests
    const bestResult = initialResults.reduce((best, current) => {
      const currentDiff = Math.abs(current.size - this.targetSize);
      const bestDiff = Math.abs(best.size - this.targetSize);
      return currentDiff < bestDiff ? current : best;
    });

    this.log(`Best initial result: quality=${bestResult.quality}, size=${bestResult.size}`);

    // If we're already within tolerance, return immediately
    if (this.isWithinTolerance(bestResult.size)) {
      return { ...bestResult, iterations: initialResults.length };
    }

    // Determine search direction and bounds
    let low = bestResult.quality;
    let high = bestResult.quality;
    
    if (bestResult.size > this.targetSize) {
      // Need lower quality
      low = Math.max(1, bestResult.quality - 20);
      high = bestResult.quality;
    } else {
      // Need higher quality
      low = bestResult.quality;
      high = Math.min(100, bestResult.quality + 20);
    }

    let iterations = initialResults.length;
    let currentBest = bestResult;

    // Parallel binary search with reduced iterations
    while (low <= high && iterations < this.heuristics.maxIterations && !this.checkTimeout()) {
      const mid = Math.floor((low + high) / 2);
      
      // Test 3 qualities in parallel around the midpoint
      const testQualities = [mid - 1, mid, mid + 1].filter(q => q >= 1 && q <= 100);
      const results = await this.parallelQualityTest(buffer, format, testQualities);
      
      if (results.length === 0) break;
      
      // Find best result from this batch
      const batchBest = results.reduce((best, current) => {
        const currentDiff = Math.abs(current.size - this.targetSize);
        const bestDiff = Math.abs(best.size - this.targetSize);
        return currentDiff < bestDiff ? current : best;
      });

      // Update current best
      if (Math.abs(batchBest.size - this.targetSize) < Math.abs(currentBest.size - this.targetSize)) {
        currentBest = batchBest;
      }

      iterations += results.length;

      // Check if we found a good result
      if (this.isWithinTolerance(batchBest.size)) {
        this.log(`Found acceptable result: ${batchBest.size} bytes (within tolerance)`);
        return { ...batchBest, iterations };
      }

      // Adjust search bounds
      if (batchBest.size > this.targetSize) {
        high = Math.min(...results.map(r => r.quality)) - 1;
      } else {
        low = Math.max(...results.map(r => r.quality)) + 1;
      }
    }

    this.log(`Parallel binary search completed. Best result: ${currentBest.size} bytes at quality ${currentBest.quality}`);
    return { ...currentBest, iterations };
  }

  private async progressiveScaling(
    buffer: Buffer, 
    format: OutputFormat
  ): Promise<{ buffer: Buffer; quality: number; size: number; scaleFactor: number; iterations: number }> {
    
    // More aggressive scaling for exact mode, fewer steps for speed
    const scaleFactors = this.mode === 'exact' 
      ? [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3]
      : [0.9, 0.8, 0.7, 0.6, 0.5];
    
    let totalIterations = 0;
    let bestResult: { buffer: Buffer; quality: number; size: number; scaleFactor: number; iterations: number } | null = null;
    
    this.log('Starting progressive scaling');
    
    // Test multiple scales in parallel
    const scalePromises = scaleFactors.map(async (scaleFactor) => {
      if (this.checkTimeout()) return null;
      
      try {
        // Quick quality test at this scale
        const testQualities = [70, 80, 90];
        const results = await this.parallelQualityTest(buffer, format, testQualities);
        
        if (results.length === 0) return null;
        
        const best = results.reduce((best, current) => {
          const currentDiff = Math.abs(current.size - this.targetSize);
          const bestDiff = Math.abs(best.size - this.targetSize);
          return currentDiff < bestDiff ? current : best;
        });

        return {
          ...best,
          scaleFactor,
          iterations: results.length
        };
      } catch (error) {
        this.log(`Error in progressive scaling at scale ${scaleFactor}:`, error);
        return null;
      }
    });

    const scaleResults = await Promise.all(scalePromises);
    const validResults = scaleResults.filter(result => result !== null) as Array<{ buffer: Buffer; quality: number; size: number; scaleFactor: number; iterations: number }>;
    
    if (validResults.length === 0) {
      throw new Error('Progressive scaling failed to produce any result');
    }

    // Find best result
    const bestScaleResult = validResults.reduce((best, current) => {
      const currentDiff = Math.abs(current.size - this.targetSize);
      const bestDiff = Math.abs(best.size - this.targetSize);
      return currentDiff < bestDiff ? current : best;
    });

    totalIterations = validResults.reduce((sum, result) => sum + result.iterations, 0);

    if (this.isWithinTolerance(bestScaleResult.size)) {
      this.log(`Progressive scaling succeeded at scale ${bestScaleResult.scaleFactor}: ${bestScaleResult.size} bytes`);
      return { ...bestScaleResult, iterations: totalIterations };
    }

    this.log(`Progressive scaling completed with best result: ${bestScaleResult.size} bytes at scale ${bestScaleResult.scaleFactor}`);
    return { ...bestScaleResult, iterations: totalIterations };
  }

  async compress(inputBuffer: Buffer, format: OutputFormat): Promise<CompressionResult> {
    this.log(`Starting optimized compression in ${this.mode} mode for ${format}`);
    
    const inputSize = inputBuffer.length;
    const inputDims = await sharp(inputBuffer).metadata();
    
    if (!inputDims.width || !inputDims.height) {
      throw new Error('Invalid image dimensions');
    }
    
    this.log(`Input: ${inputSize} bytes, ${inputDims.width}x${inputDims.height}`);
    this.log(`Heuristics: complexity=${this.heuristics.imageComplexity.toFixed(2)}, estimatedQuality=${this.heuristics.estimatedQuality}, maxIterations=${this.heuristics.maxIterations}`);
    
    let result: CompressionResult;
    let totalIterations = 0;
    
    try {
      // Phase 1: Parallel quality testing with adaptive heuristics
      const initialQualities = [
        this.heuristics.estimatedQuality - 10,
        this.heuristics.estimatedQuality - 5,
        this.heuristics.estimatedQuality,
        this.heuristics.estimatedQuality + 5
      ].filter(q => q >= 1 && q <= 100);

      const initialResults = await this.parallelQualityTest(inputBuffer, format, initialQualities);
      totalIterations += initialResults.length;

      if (initialResults.length === 0) {
        throw new Error('Initial quality testing failed');
      }

      // Phase 2: Parallel binary search
      const binaryResult = await this.parallelBinarySearch(inputBuffer, format, initialResults);
      totalIterations += binaryResult.iterations;
      
      if (this.isWithinTolerance(binaryResult.size)) {
        result = {
          buffer: binaryResult.buffer,
          quality: binaryResult.quality,
          size: binaryResult.size,
          dimensions: { width: inputDims.width, height: inputDims.height },
          exactMatch: this.isExactMatch(binaryResult.size),
          iterations: totalIterations,
          mode: this.mode,
          processingTime: Date.now() - this.startTime,
          parallelTests: initialResults.length
        };
        
        this.log(`Compression completed in phase 2: ${result.size} bytes`);
        return result;
      }
      
      // Phase 3: Progressive scaling (if needed and time permits)
      if (!this.checkTimeout()) {
        try {
          const scaleResult = await this.progressiveScaling(inputBuffer, format);
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
              scaleFactor: scaleResult.scaleFactor,
              parallelTests: initialResults.length
            };
            
            this.log(`Compression completed in phase 3: ${result.size} bytes`);
            return result;
          }
        } catch (error) {
          this.log('Progressive scaling failed, using binary search result:', error);
        }
      }
      
      // Return best available result
      result = {
        buffer: binaryResult.buffer,
        quality: binaryResult.quality,
        size: binaryResult.size,
        dimensions: { width: inputDims.width, height: inputDims.height },
        exactMatch: false,
        iterations: totalIterations,
        mode: this.mode,
        processingTime: Date.now() - this.startTime,
        parallelTests: initialResults.length
      };
      
      this.log(`Compression completed with best available result: ${result.size} bytes`);
      return result;
      
    } catch (error) {
      this.log('Compression failed:', error);
      throw error;
    }
  }
}

// Cache management
function generateCacheKey(buffer: Buffer, format: OutputFormat, mode: CompressionMode): string {
  const hash = require('crypto').createHash('md5').update(buffer).digest('hex');
  return `${hash}-${format}-${mode}`;
}

function isCacheValid(timestamp: number): boolean {
  return Date.now() - timestamp < CACHE_TTL;
}

function cleanupCache(): void {
  const now = Date.now();
  for (const [key, timestamp] of cacheTimestamps.entries()) {
    if (now - timestamp > CACHE_TTL) {
      compressionCache.delete(key);
      cacheTimestamps.delete(key);
    }
  }
}

// Metrics collection
function collectMetrics(result: CompressionResult, inputSize: number): CompressionMetrics {
  return {
    processingTime: result.processingTime,
    iterationsUsed: result.iterations,
    memoryPeak: 0, // Would be tracked in production
    cpuUsage: 0, // Would be tracked in production
    finalSize: result.size,
    qualityAchieved: result.quality,
    exactMatch: result.exactMatch,
    compressionRatio: inputSize / result.size,
    queueLength: jobQueue.length,
    activeJobs,
    cacheHitRate: totalJobsProcessed > 0 ? cacheHits / totalJobsProcessed : 0,
    errorRate: 0 // Would be tracked in production
  };
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
  totalJobsProcessed++;
  
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
    
    // Check cache first
    const cacheKey = generateCacheKey(inputBuffer, format, mode);
    if (compressionCache.has(cacheKey) && isCacheValid(cacheTimestamps.get(cacheKey)!)) {
      cacheHits++;
      const cachedBuffer = compressionCache.get(cacheKey)!;
      
      const headers = new Headers();
      headers.set('Content-Type', `image/${format}`);
      headers.set('Content-Length', cachedBuffer.length.toString());
      headers.set('X-Cache-Hit', '1');
      headers.set('X-Processing-Time', '0');
      
      return new NextResponse(cachedBuffer as BodyInit, { headers });
    }

    // Extract metadata for heuristics
    const metadata = await sharp(inputBuffer).metadata();
    const imageMetadata: ImageMetadata = {
      width: metadata.width!,
      height: metadata.height!,
      size: inputBuffer.length,
      format: metadata.format!,
      channels: metadata.channels!,
      density: metadata.density,
      hasAlpha: metadata.hasAlpha || false,
      complexity: 0 // Will be calculated by heuristics engine
    };

    // Generate adaptive heuristics
    const heuristicsEngine = new AdaptiveHeuristicsEngine();
    const heuristics = heuristicsEngine.generateHeuristics(imageMetadata);
    
    // Create optimized compressor
    const compressor = new ParallelCompressor(mode, heuristics);
    
    const result = await compressor.compress(inputBuffer, format);
    
    // Cache the result
    compressionCache.set(cacheKey, result.buffer);
    cacheTimestamps.set(cacheKey, Date.now());
    
    // Cleanup old cache entries periodically
    if (totalJobsProcessed % 100 === 0) {
      cleanupCache();
    }
    
    // Collect metrics
    const metrics = collectMetrics(result, inputBuffer.length);
    console.log('Compression metrics:', metrics);
    
    // Generate filename
    const sanitizedName = file.name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    
    const filename = `exact80--${sanitizedName}--${format}--${result.size}B--w${result.dimensions.width}h${result.dimensions.height}--q${result.quality}--m${mode.toUpperCase()}.${format}`;
    
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
    headers.set('X-Parallel-Tests', result.parallelTests?.toString() || '0');
    headers.set('X-Cache-Hit', '0');
    headers.set('Content-Disposition', `attachment; filename="${filename}"`);

    return new NextResponse(result.buffer as BodyInit, { headers });
    
  } catch (error) {
    console.error('Optimized compression API error:', error);
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
