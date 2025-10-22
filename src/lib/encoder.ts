/**
 * Image encoding service with format-specific optimizations
 */

import sharp from 'sharp';
import { OutputFormat, ImageMetadata } from './types';
import { logger } from './logger';

export class ImageEncoder {
  /**
   * Encode image with specified quality and format
   */
  async encode(
    buffer: Buffer, 
    quality: number, 
    format: OutputFormat, 
    scaleFactor: number = 1
  ): Promise<Buffer> {
    // Ensure quality is an integer
    const intQuality = Math.round(Math.max(1, Math.min(100, quality)));
    
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
          kernel: sharp.kernel.lanczos3, // Deterministic resizing
        });
      }
    }

    // Apply format-specific encoding with optimized settings
    switch (format) {
      case 'webp':
        return this.encodeWebP(pipeline, intQuality);
      
      case 'avif':
        return this.encodeAVIF(pipeline, intQuality);
      
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * WebP encoding with optimized settings
   */
  private async encodeWebP(pipeline: sharp.Sharp, quality: number): Promise<Buffer> {
    return pipeline.webp({
      quality,
      effort: 4, // Balanced speed/compression
      lossless: false,
      smartSubsample: true,
    }).toBuffer();
  }

  /**
   * AVIF encoding with optimized settings
   */
  private async encodeAVIF(pipeline: sharp.Sharp, quality: number): Promise<Buffer> {
    return pipeline.avif({
      quality,
      effort: 4, // Balanced speed/compression
      chromaSubsampling: '4:2:0', // Faster encoding
    }).toBuffer();
  }

  /**
   * Extract image metadata
   */
  async extractMetadata(buffer: Buffer): Promise<ImageMetadata> {
    const metadata = await sharp(buffer).metadata();
    
    if (!metadata.width || !metadata.height) {
      throw new Error('Invalid image dimensions');
    }

    return {
      width: metadata.width,
      height: metadata.height,
      size: buffer.length,
      format: metadata.format || 'unknown',
      channels: metadata.channels || 3,
      density: metadata.density,
      hasAlpha: metadata.hasAlpha || false,
      complexity: 0, // Will be calculated by heuristics engine
    };
  }

  /**
   * Validate image format and size
   */
  validateImage(buffer: Buffer, maxSize: number): void {
    if (buffer.length === 0) {
      throw new Error('Empty image file');
    }

    if (buffer.length > maxSize) {
      throw new Error(`Image too large: ${buffer.length} bytes (max: ${maxSize} bytes)`);
    }

    // Basic format validation
    const header = buffer.slice(0, 4);
    const isValidImage = 
      header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF || // JPEG
      header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47; // PNG

    if (!isValidImage) {
      throw new Error('Invalid image format');
    }
  }
}

