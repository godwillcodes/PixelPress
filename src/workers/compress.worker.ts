/// <reference lib="webworker" />

/**
 * Runs one search at a time, off the main thread.
 *
 * The WASM encoders block whatever thread they are on, and a search is dozens of
 * encodes, so doing this on the main thread would freeze the tab for seconds.
 * The pool in `lib/exact80/pool.ts` runs several of these at once.
 */

import { compressToExactSize } from '@/lib/exact80/core/search';
import { browserCodec } from '@/lib/exact80/codecs/browser';
import type { OutputFormat, SearchStage } from '@/lib/exact80/core/types';

export interface WorkerRequest {
  id: string;
  bytes: ArrayBuffer;
  format: OutputFormat;
}

export type WorkerResponse =
  | { id: string; type: 'progress'; stage: SearchStage }
  | {
      id: string;
      type: 'done';
      data: ArrayBuffer;
      format: OutputFormat;
      bytes: number;
      encodedBytes: number;
      padBytes: number;
      width: number;
      height: number;
      quality: number;
      score: number;
      resized: boolean;
      sourceWidth: number;
      sourceHeight: number;
      encodes: number;
      ms: number;
    }
  | { id: string; type: 'error'; message: string };

const post = (message: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(message, transfer);

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, bytes, format } = event.data;

  try {
    const result = await compressToExactSize(new Uint8Array(bytes), format, browserCodec, {
      onProgress: (stage) => post({ id, type: 'progress', stage }),
    });

    // The result owns its buffer, so hand it over rather than copying it.
    const data = result.data.buffer as ArrayBuffer;
    post({ id, type: 'done', ...result, data }, [data]);
  } catch (error) {
    post({
      id,
      type: 'error',
      message: error instanceof Error ? error.message : 'Compression failed',
    });
  }
};
