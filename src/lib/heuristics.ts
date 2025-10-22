/**
 * Adaptive heuristics engine for intelligent compression parameter estimation
 */

import { ImageMetadata, AdaptiveHeuristics } from './types';
import { ADAPTIVE_CONFIG } from './config';
import { logger } from './logger';

export class AdaptiveHeuristicsEngine {
  /**
   * Calculate image complexity based on dimensions, channels, and file size
   */
  calculateComplexity(metadata: ImageMetadata): number {
    const { width, height, channels, hasAlpha } = metadata;
    
    // Base complexity from dimensions (logarithmic scale)
    const pixelCount = width * height;
    const dimensionComplexity = Math.min(1, Math.log10(pixelCount) / 7); // 0-1 scale
    
    // Channel complexity (more channels = more complex)
    const channelComplexity = (channels + (hasAlpha ? 1 : 0)) / 4; // 0-1 scale
    
    // Size complexity (larger files = more complex)
    const sizeComplexity = Math.min(1, Math.log10(metadata.size) / 8); // 0-1 scale
    
    // Combined complexity (weighted average)
    const complexity = (dimensionComplexity * 0.4 + channelComplexity * 0.3 + sizeComplexity * 0.3);
    
    logger.debug(`Complexity calculation: dimensions=${dimensionComplexity.toFixed(3)}, channels=${channelComplexity.toFixed(3)}, size=${sizeComplexity.toFixed(3)}, total=${complexity.toFixed(3)}`);
    
    return complexity;
  }
  
  /**
   * Estimate starting quality based on image characteristics
   */
  estimateStartingQuality(metadata: ImageMetadata): number {
    const complexity = this.calculateComplexity(metadata);
    const sizeRatio = metadata.size / (metadata.width * metadata.height);
    
    // Heuristic formula: higher complexity = lower starting quality
    const baseQuality = 85;
    const complexityPenalty = complexity * 20;
    const sizePenalty = Math.min(10, sizeRatio * 1000);
    
    const estimatedQuality = Math.max(
      ADAPTIVE_CONFIG.qualityBounds.min,
      Math.min(
        ADAPTIVE_CONFIG.qualityBounds.max,
        baseQuality - complexityPenalty - sizePenalty
      )
    );
    
    logger.debug(`Quality estimation: base=${baseQuality}, complexityPenalty=${complexityPenalty.toFixed(1)}, sizePenalty=${sizePenalty.toFixed(1)}, estimated=${estimatedQuality.toFixed(1)}`);
    
    return Math.round(estimatedQuality);
  }
  
  /**
   * Calculate maximum iterations based on image size and complexity
   */
  calculateMaxIterations(metadata: ImageMetadata): number {
    const complexity = this.calculateComplexity(metadata);
    
    let maxIterations: number;
    if (metadata.size < ADAPTIVE_CONFIG.smallImageThreshold) {
      maxIterations = ADAPTIVE_CONFIG.maxIterations.small;
    } else if (metadata.size < ADAPTIVE_CONFIG.mediumImageThreshold) {
      maxIterations = ADAPTIVE_CONFIG.maxIterations.medium;
    } else {
      maxIterations = ADAPTIVE_CONFIG.maxIterations.large;
    }
    
    // Adjust based on complexity
    const complexityMultiplier = 0.8 + (complexity * 0.4); // 0.8 to 1.2
    maxIterations = Math.round(maxIterations * complexityMultiplier);
    
    logger.debug(`Max iterations: base=${ADAPTIVE_CONFIG.maxIterations.large}, complexity=${complexity.toFixed(3)}, multiplier=${complexityMultiplier.toFixed(3)}, final=${maxIterations}`);
    
    return maxIterations;
  }
  
  /**
   * Generate comprehensive heuristics for compression optimization
   */
  generateHeuristics(metadata: ImageMetadata): AdaptiveHeuristics {
    const complexity = this.calculateComplexity(metadata);
    const estimatedQuality = this.estimateStartingQuality(metadata);
    const maxIterations = this.calculateMaxIterations(metadata);
    
    const heuristics: AdaptiveHeuristics = {
      imageComplexity: complexity,
      estimatedQuality,
      maxIterations,
      timeoutStrategy: metadata.size > ADAPTIVE_CONFIG.mediumImageThreshold ? 'conservative' : 'aggressive',
      parallelTests: Math.min(
        ADAPTIVE_CONFIG.parallelTests, 
        Math.max(2, Math.floor(metadata.size / (1024 * 1024)))
      ),
    };
    
    logger.info(`Generated heuristics: complexity=${complexity.toFixed(3)}, quality=${estimatedQuality}, iterations=${maxIterations}, strategy=${heuristics.timeoutStrategy}, parallelTests=${heuristics.parallelTests}`);
    
    return heuristics;
  }
}

