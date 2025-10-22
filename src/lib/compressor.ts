/**
 * Advanced compression engine with parallel processing and adaptive algorithms
 */

import { v4 as uuidv4 } from 'uuid';
import { 
  OutputFormat, 
  CompressionMode, 
  CompressionResult, 
  QualityTestResult, 
  ScalingResult,
  AdaptiveHeuristics 
} from './types';
import { COMPRESSION_CONFIG } from './config';
import { logger } from './logger';
import { ImageEncoder } from './encoder';

export class ParallelCompressor {
  private targetSize: number;
  private tolerance: number;
  private maxWallTime: number;
  private mode: CompressionMode;
  private requestId: string;
  private startTime: number;
  private heuristics: AdaptiveHeuristics;
  private memoryUsage: number = 0;
  private encoder: ImageEncoder;

  constructor(mode: CompressionMode = 'balanced', heuristics: AdaptiveHeuristics) {
    this.mode = mode;
    this.targetSize = COMPRESSION_CONFIG.targetBytes;
    this.tolerance = mode === 'exact' ? COMPRESSION_CONFIG.toleranceExact : COMPRESSION_CONFIG.toleranceBalanced;
    this.maxWallTime = mode === 'exact' ? COMPRESSION_CONFIG.maxWallTimeExact : COMPRESSION_CONFIG.maxWallTimeBalanced;
    this.requestId = uuidv4();
    this.startTime = Date.now();
    this.heuristics = heuristics;
    this.encoder = new ImageEncoder();
  }

  /**
   * Main compression method with three-phase approach
   */
  async compress(inputBuffer: Buffer, format: OutputFormat): Promise<CompressionResult> {
    logger.info(`Starting compression in ${this.mode} mode for ${format}`, null, this.requestId, 'COMPRESSOR');
    
    const inputSize = inputBuffer.length;
    const inputDims = await this.encoder.extractMetadata(inputBuffer);
    
    logger.info(`Input: ${inputSize} bytes, ${inputDims.width}x${inputDims.height}`, null, this.requestId, 'COMPRESSOR');
    logger.info(`Heuristics: complexity=${this.heuristics.imageComplexity.toFixed(2)}, estimatedQuality=${this.heuristics.estimatedQuality}, maxIterations=${this.heuristics.maxIterations}`, null, this.requestId, 'COMPRESSOR');
    
    let result: CompressionResult;
    let totalIterations = 0;
    
    try {
      // Phase 1: Parallel quality testing with adaptive heuristics
      const initialResults = await this.parallelQualityTest(inputBuffer, format);
      totalIterations += initialResults.length;

      if (initialResults.length === 0) {
        throw new Error('Initial quality testing failed');
      }

      // Phase 2: Parallel binary search
      const binaryResult = await this.parallelBinarySearch(inputBuffer, format, initialResults);
      totalIterations += binaryResult.iterations;
      
      if (this.isWithinTolerance(binaryResult.size)) {
        result = this.createResult(binaryResult, inputDims, totalIterations, initialResults.length);
        logger.info(`Compression completed in phase 2: ${result.size} bytes`, null, this.requestId, 'COMPRESSOR');
        return result;
      }
      
      // Phase 3: Progressive scaling (if needed and time permits)
      if (!this.checkTimeout()) {
        try {
          const scaleResult = await this.progressiveScaling(inputBuffer, format);
          totalIterations += scaleResult.iterations;
          
          if (this.isWithinTolerance(scaleResult.size)) {
            result = this.createResult(scaleResult, inputDims, totalIterations, initialResults.length, scaleResult.scaleFactor);
            logger.info(`Compression completed in phase 3: ${result.size} bytes`, null, this.requestId, 'COMPRESSOR');
            return result;
          }
        } catch (error) {
          logger.warn('Progressive scaling failed, using binary search result', error, this.requestId, 'COMPRESSOR');
        }
      }
      
      // Return best available result
      result = this.createResult(binaryResult, inputDims, totalIterations, initialResults.length);
      logger.info(`Compression completed with best available result: ${result.size} bytes`, null, this.requestId, 'COMPRESSOR');
      return result;
      
    } catch (error) {
      logger.error('Compression failed', error, this.requestId, 'COMPRESSOR');
      throw error;
    }
  }

  /**
   * Test multiple quality values in parallel
   */
  private async parallelQualityTest(
    buffer: Buffer, 
    format: OutputFormat,
    qualities?: number[]
  ): Promise<QualityTestResult[]> {
    const testQualities = qualities || this.generateInitialQualities();
    logger.debug(`Testing ${testQualities.length} qualities in parallel: ${testQualities.join(', ')}`, null, this.requestId, 'COMPRESSOR');
    
    const promises = testQualities.map(async (quality) => {
      try {
        const result = await this.encoder.encode(buffer, quality, format);
        this.trackMemory(result);
        return {
          quality,
          size: result.length,
          buffer: result
        };
      } catch (error) {
        logger.warn(`Error testing quality ${quality}`, error, this.requestId, 'COMPRESSOR');
        return null;
      }
    });

    const results = await Promise.all(promises);
    return results.filter(result => result !== null) as QualityTestResult[];
  }

  /**
   * Parallel binary search for optimal quality
   */
  private async parallelBinarySearch(
    buffer: Buffer, 
    format: OutputFormat, 
    initialResults: QualityTestResult[]
  ): Promise<{ buffer: Buffer; quality: number; size: number; iterations: number }> {
    
    // Find the best starting point from parallel tests
    const bestResult = initialResults.reduce((best, current) => {
      const currentDiff = Math.abs(current.size - this.targetSize);
      const bestDiff = Math.abs(best.size - this.targetSize);
      return currentDiff < bestDiff ? current : best;
    });

    logger.debug(`Best initial result: quality=${bestResult.quality}, size=${bestResult.size}`, null, this.requestId, 'COMPRESSOR');

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
      const testQualities = [mid - 1, mid, mid + 1].map(q => Math.round(q)).filter(q => q >= 1 && q <= 100);
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
        logger.debug(`Found acceptable result: ${batchBest.size} bytes (within tolerance)`, null, this.requestId, 'COMPRESSOR');
        return { ...batchBest, iterations };
      }

      // Adjust search bounds
      if (batchBest.size > this.targetSize) {
        high = Math.min(...results.map(r => r.quality)) - 1;
      } else {
        low = Math.max(...results.map(r => r.quality)) + 1;
      }
    }

    logger.debug(`Parallel binary search completed. Best result: ${currentBest.size} bytes at quality ${currentBest.quality}`, null, this.requestId, 'COMPRESSOR');
    return { ...currentBest, iterations };
  }

  /**
   * Progressive scaling for exact size matching
   */
  private async progressiveScaling(
    buffer: Buffer, 
    format: OutputFormat
  ): Promise<ScalingResult> {
    
    // More aggressive scaling for exact mode, fewer steps for speed
    const scaleFactors = this.mode === 'exact' 
      ? [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3]
      : [0.9, 0.8, 0.7, 0.6, 0.5];
    
    let totalIterations = 0;
    let bestResult: ScalingResult | null = null;
    
    logger.debug('Starting progressive scaling', null, this.requestId, 'COMPRESSOR');
    
    // Test multiple scales in parallel
    const scalePromises = scaleFactors.map(async (scaleFactor) => {
      if (this.checkTimeout()) return null;
      
      try {
        // Quick quality test at this scale
        const testQualities = [70, 80, 90].map(q => Math.round(q));
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
        logger.warn(`Error in progressive scaling at scale ${scaleFactor}`, error, this.requestId, 'COMPRESSOR');
        return null;
      }
    });

    const scaleResults = await Promise.all(scalePromises);
    const validResults = scaleResults.filter(result => result !== null) as ScalingResult[];
    
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
      logger.debug(`Progressive scaling succeeded at scale ${bestScaleResult.scaleFactor}: ${bestScaleResult.size} bytes`, null, this.requestId, 'COMPRESSOR');
      return { ...bestScaleResult, iterations: totalIterations };
    }

    logger.debug(`Progressive scaling completed with best result: ${bestScaleResult.size} bytes at scale ${bestScaleResult.scaleFactor}`, null, this.requestId, 'COMPRESSOR');
    return { ...bestScaleResult, iterations: totalIterations };
  }

  /**
   * Generate initial quality values based on heuristics
   */
  private generateInitialQualities(): number[] {
    return [
      this.heuristics.estimatedQuality - 10,
      this.heuristics.estimatedQuality - 5,
      this.heuristics.estimatedQuality,
      this.heuristics.estimatedQuality + 5
    ].map(q => Math.round(q)).filter(q => q >= 1 && q <= 100);
  }

  /**
   * Create compression result object
   */
  private createResult(
    result: { buffer: Buffer; quality: number; size: number },
    inputDims: { width: number; height: number },
    iterations: number,
    parallelTests: number,
    scaleFactor?: number
  ): CompressionResult {
    return {
      buffer: result.buffer,
      quality: result.quality,
      size: result.size,
      dimensions: inputDims,
      exactMatch: this.isExactMatch(result.size),
      iterations,
      mode: this.mode,
      processingTime: Date.now() - this.startTime,
      scaleFactor,
      parallelTests,
    };
  }

  /**
   * Check if size is within tolerance
   */
  private isWithinTolerance(size: number): boolean {
    return Math.abs(size - this.targetSize) <= this.tolerance;
  }

  /**
   * Check if size is exact match
   */
  private isExactMatch(size: number): boolean {
    return size === this.targetSize;
  }

  /**
   * Check if processing has exceeded time limit
   */
  private checkTimeout(): boolean {
    return (Date.now() - this.startTime) > this.maxWallTime;
  }

  /**
   * Track memory usage
   */
  private trackMemory(buffer: Buffer): void {
    this.memoryUsage += buffer.length;
    if (this.memoryUsage > COMPRESSION_CONFIG.memoryLimitPerJob) {
      throw new Error('Memory limit exceeded');
    }
  }
}
