/**
 * Core types and interfaces for the Exact80 compression system
 */

export type OutputFormat = 'webp' | 'avif';
export type CompressionMode = 'exact' | 'balanced';

export interface ImageMetadata {
  width: number;
  height: number;
  size: number;
  format: string;
  channels: number;
  density?: number;
  hasAlpha: boolean;
  complexity: number;
}

export interface CompressionResult {
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

export interface CompressionMetrics {
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

export interface AdaptiveHeuristics {
  imageComplexity: number;
  estimatedQuality: number;
  maxIterations: number;
  timeoutStrategy: 'aggressive' | 'conservative';
  parallelTests: number;
}

export interface CompressionConfig {
  targetBytes: number;
  toleranceBalanced: number;
  toleranceExact: number;
  maxFileSize: number;
  maxWallTimeBalanced: number;
  maxWallTimeExact: number;
  maxConcurrentJobs: number;
  memoryLimitPerJob: number;
}

export interface AdaptiveConfig {
  smallImageThreshold: number;
  mediumImageThreshold: number;
  maxIterations: {
    small: number;
    medium: number;
    large: number;
  };
  qualityBounds: {
    min: number;
    max: number;
  };
  parallelTests: number;
}

export interface QualityTestResult {
  quality: number;
  size: number;
  buffer: Buffer;
}

export interface ScalingResult {
  buffer: Buffer;
  quality: number;
  size: number;
  scaleFactor: number;
  iterations: number;
}

