/**
 * In-memory cache system for compression results
 */

import { createHash } from 'crypto';
import { OutputFormat, CompressionMode } from './types';
import { CACHE_CONFIG } from './config';
import { logger } from './logger';

export class CompressionCache {
  private cache = new Map<string, Buffer>();
  private timestamps = new Map<string, number>();
  private hitCount = 0;
  private missCount = 0;

  generateKey(buffer: Buffer, format: OutputFormat, mode: CompressionMode): string {
    const hash = createHash('md5').update(buffer).digest('hex');
    return `${hash}-${format}-${mode}`;
  }

  get(key: string): Buffer | null {
    if (!this.cache.has(key)) {
      this.missCount++;
      return null;
    }

    const timestamp = this.timestamps.get(key);
    if (!timestamp || !this.isValid(timestamp)) {
      this.delete(key);
      this.missCount++;
      return null;
    }

    this.hitCount++;
    return this.cache.get(key)!;
  }

  set(key: string, buffer: Buffer): void {
    this.cache.set(key, buffer);
    this.timestamps.set(key, Date.now());
  }

  delete(key: string): void {
    this.cache.delete(key);
    this.timestamps.delete(key);
  }

  private isValid(timestamp: number): boolean {
    return Date.now() - timestamp < CACHE_CONFIG.ttl;
  }

  cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, timestamp] of this.timestamps.entries()) {
      if (now - timestamp > CACHE_CONFIG.ttl) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.delete(key));
    
    if (keysToDelete.length > 0) {
      logger.debug(`Cache cleanup: removed ${keysToDelete.length} expired entries`);
    }
  }

  getStats() {
    const total = this.hitCount + this.missCount;
    return {
      size: this.cache.size,
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRate: total > 0 ? this.hitCount / total : 0,
    };
  }

  clear(): void {
    this.cache.clear();
    this.timestamps.clear();
    this.hitCount = 0;
    this.missCount = 0;
  }
}

export const compressionCache = new CompressionCache();

