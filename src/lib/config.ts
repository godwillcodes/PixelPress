/**
 * Configuration constants for the PixelPress compression system
 */

import { CompressionConfig, AdaptiveConfig } from './types';

export const COMPRESSION_CONFIG: CompressionConfig = {
  targetBytes: 1_000, // Minimum possible size (1KB)
  toleranceBalanced: 5_000,
  toleranceExact: 0,
  maxFileSize: 25 * 1024 * 1024, // 25MB
  maxWallTimeBalanced: 20_000, // 20 seconds (Vercel optimized)
  maxWallTimeExact: 25_000, // 25 seconds (Vercel optimized)
  maxConcurrentJobs: 20,
  memoryLimitPerJob: 100 * 1024 * 1024, // 100MB
};

export const ADAPTIVE_CONFIG: AdaptiveConfig = {
  smallImageThreshold: 1024 * 1024, // 1MB
  mediumImageThreshold: 5 * 1024 * 1024, // 5MB
  maxIterations: {
    small: 5,
    medium: 8,
    large: 12,
  },
  qualityBounds: {
    min: 60,
    max: 95,
  },
  parallelTests: 4,
};

export const SUPPORTED_OUTPUT_FORMATS = ['webp', 'avif'] as const;
export const ALLOWED_INPUT_TYPES = ['image/jpeg', 'image/jpg', 'image/png'] as const;

export const CACHE_CONFIG = {
  ttl: 24 * 60 * 60 * 1000, // 24 hours
  cleanupInterval: 100, // Cleanup every 100 requests
} as const;

