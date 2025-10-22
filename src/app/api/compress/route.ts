/**
 * Main compression API endpoint with clean architecture
 */

import { NextRequest, NextResponse } from 'next/server';
import { OutputFormat, CompressionMode } from '@/lib/types';
import { COMPRESSION_CONFIG, SUPPORTED_OUTPUT_FORMATS, ALLOWED_INPUT_TYPES, CACHE_CONFIG } from '@/lib/config';
import { logger } from '@/lib/logger';
import { compressionCache } from '@/lib/cache';
import { AdaptiveHeuristicsEngine } from '@/lib/heuristics';
import { ImageEncoder } from '@/lib/encoder';
import { ParallelCompressor } from '@/lib/compressor';

// Resource management
let activeJobs = 0;
let totalJobsProcessed = 0;

/**
 * Resource management and rate limiting
 */
class ResourceManager {
  static canProcessRequest(): boolean {
    return activeJobs < COMPRESSION_CONFIG.maxConcurrentJobs;
  }

  static startJob(): void {
    activeJobs++;
    totalJobsProcessed++;
  }

  static endJob(): void {
    activeJobs--;
  }

  static getStats() {
    return {
      activeJobs,
      totalJobsProcessed,
      maxConcurrentJobs: COMPRESSION_CONFIG.maxConcurrentJobs,
    };
  }
}

/**
 * Request validation
 */
class RequestValidator {
  static validateRequest(file: File | null, format: string | null): { isValid: boolean; error?: string } {
    if (!file) {
      return { isValid: false, error: 'No image file provided' };
    }

    if (!SUPPORTED_OUTPUT_FORMATS.includes(format as OutputFormat)) {
      return { isValid: false, error: 'Unsupported output format' };
    }

    if (!ALLOWED_INPUT_TYPES.includes(file.type as any)) {
      return { isValid: false, error: 'Unsupported file type' };
    }

    if (file.size > COMPRESSION_CONFIG.maxFileSize) {
      return { isValid: false, error: 'File too large' };
    }

    return { isValid: true };
  }
}

/**
 * Response builder
 */
class ResponseBuilder {
  static buildSuccessResponse(
    result: any,
    inputSize: number,
    filename: string,
    format: OutputFormat
  ): NextResponse {
    const headers = new Headers();
    headers.set('Content-Type', `image/${format}`);
    headers.set('Content-Length', result.buffer.length.toString());
    headers.set('X-Exact-Match', result.exactMatch ? '1' : '0');
    headers.set('X-Result-Bytes', result.size.toString());
    headers.set('X-Compression-Quality', result.quality.toString());
    headers.set('X-Iterations', result.iterations.toString());
    headers.set('X-Processing-Time', result.processingTime.toString());
    headers.set('X-Mode', result.mode);
    headers.set('X-Compression-Ratio', (inputSize / result.size).toFixed(2));
    headers.set('X-Scale-Factor', result.scaleFactor?.toString() || '1');
    headers.set('X-Palette-Reduced', result.paletteReduced ? '1' : '0');
    headers.set('X-Parallel-Tests', result.parallelTests?.toString() || '0');
    headers.set('X-Cache-Hit', '0');
    headers.set('Content-Disposition', `attachment; filename="${filename}"`);

    return new NextResponse(result.buffer as BodyInit, { headers });
  }

  static buildCachedResponse(
    buffer: Buffer,
    format: OutputFormat,
    filename: string
  ): NextResponse {
    const headers = new Headers();
    headers.set('Content-Type', `image/${format}`);
    headers.set('Content-Length', buffer.length.toString());
    headers.set('X-Cache-Hit', '1');
    headers.set('X-Processing-Time', '0');
    headers.set('Content-Disposition', `attachment; filename="${filename}"`);

    return new NextResponse(buffer as BodyInit, { headers });
  }

  static buildErrorResponse(error: string, status: number = 500): NextResponse {
    return NextResponse.json({ error }, { status });
  }
}

/**
 * Filename generator
 */
class FilenameGenerator {
  static generate(
    originalName: string,
    format: OutputFormat,
    result: any,
    mode: CompressionMode
  ): string {
    const sanitizedName = originalName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    return `exact80--${sanitizedName}--${format}--${result.size}B--w${result.dimensions.width}h${result.dimensions.height}--q${result.quality}--m${mode.toUpperCase()}.${format}`;
  }
}

/**
 * Main POST handler
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  logger.info('Compression request started', null, requestId, 'API');

  // Resource management
  if (!ResourceManager.canProcessRequest()) {
    logger.warn('Server busy, rejecting request', null, requestId, 'API');
    return ResponseBuilder.buildErrorResponse('Server busy. Please try again later.', 503);
  }

  ResourceManager.startJob();

  try {
    // Parse request
    const formData = await request.formData();
    const file = formData.get('image') as File;
    const format = formData.get('format') as OutputFormat;
    const mode = (formData.get('mode') as CompressionMode) || 'balanced';

    // Validate request
    const validation = RequestValidator.validateRequest(file, format);
    if (!validation.isValid) {
      logger.warn(`Request validation failed: ${validation.error}`, null, requestId, 'API');
      return ResponseBuilder.buildErrorResponse(validation.error!, 400);
    }

    const inputBuffer = Buffer.from(await file!.arrayBuffer());
    const encoder = new ImageEncoder();

    // Validate image
    try {
      encoder.validateImage(inputBuffer, COMPRESSION_CONFIG.maxFileSize);
    } catch (error) {
      logger.warn(`Image validation failed: ${error}`, null, requestId, 'API');
      return ResponseBuilder.buildErrorResponse(error instanceof Error ? error.message : 'Invalid image', 400);
    }

    // Check cache
    const cacheKey = compressionCache.generateKey(inputBuffer, format!, mode);
    const cachedResult = compressionCache.get(cacheKey);
    
    if (cachedResult) {
      logger.info('Cache hit', null, requestId, 'API');
      const filename = FilenameGenerator.generate(file!.name, format!, { size: cachedResult.length }, mode);
      return ResponseBuilder.buildCachedResponse(cachedResult, format!, filename);
    }

    // Extract metadata and generate heuristics
    const metadata = await encoder.extractMetadata(inputBuffer);
    const heuristicsEngine = new AdaptiveHeuristicsEngine();
    const heuristics = heuristicsEngine.generateHeuristics(metadata);

    // Compress image
    const compressor = new ParallelCompressor(mode, heuristics);
    const result = await compressor.compress(inputBuffer, format!);

    // Cache the result
    compressionCache.set(cacheKey, result.buffer);

    // Cleanup cache periodically
    if (totalJobsProcessed % CACHE_CONFIG.cleanupInterval === 0) {
      compressionCache.cleanup();
    }

    // Generate filename and response
    const filename = FilenameGenerator.generate(file!.name, format!, result, mode);
    const response = ResponseBuilder.buildSuccessResponse(result, inputBuffer.length, filename, format!);

    const processingTime = Date.now() - startTime;
    logger.info(`Compression completed successfully in ${processingTime}ms`, {
      inputSize: inputBuffer.length,
      outputSize: result.size,
      compressionRatio: (inputBuffer.length / result.size).toFixed(2),
      quality: result.quality,
      iterations: result.iterations,
      exactMatch: result.exactMatch,
    }, requestId, 'API');

    return response;
    
  } catch (error) {
    const processingTime = Date.now() - startTime;
    logger.error(`Compression failed after ${processingTime}ms`, error, requestId, 'API');

    // Check if it's a timeout error
    if (processingTime > COMPRESSION_CONFIG.maxWallTimeExact) {
      return ResponseBuilder.buildErrorResponse(
        'Processing timeout. Please try with a smaller image or different format.',
        408
      );
    }

    return ResponseBuilder.buildErrorResponse(
      error instanceof Error ? error.message : 'Compression failed',
      500
    );
  } finally {
    ResourceManager.endJob();
  }
}

/**
 * OPTIONS handler for CORS
 */
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