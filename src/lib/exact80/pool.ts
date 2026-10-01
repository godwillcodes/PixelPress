/**
 * A small pool of compression workers.
 *
 * Each search is a long sequence of encodes that cannot be split, so the unit of
 * parallelism is one image per worker. A batch of twenty photos therefore
 * finishes in roughly (20 / workers) × the time for one, and the page stays
 * responsive throughout.
 */

import type { Exact80Result, OutputFormat, SearchStage } from './core/types';
import type { WorkerRequest, WorkerResponse } from '@/workers/compress.worker';

/**
 * Leave a core for the browser itself, and stop at four: beyond that the
 * encoders mostly compete for memory bandwidth rather than going faster.
 */
function defaultPoolSize(): number {
  const cores = typeof navigator === 'undefined' ? 2 : navigator.hardwareConcurrency || 2;
  return Math.max(1, Math.min(4, cores - 1));
}

interface Job {
  request: WorkerRequest;
  onStage?: (stage: SearchStage) => void;
  resolve: (result: Exact80Result) => void;
  reject: (error: Error) => void;
}

export class CompressorPool {
  private readonly size: number;
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly queue: Job[] = [];
  private readonly running = new Map<Worker, Job>();
  private nextId = 0;

  constructor(size: number = defaultPoolSize()) {
    this.size = size;
  }

  /**
   * Compress one image. Resolves with a result that is exactly 80,000 bytes.
   */
  compress(
    input: ArrayBuffer,
    format: OutputFormat,
    onStage?: (stage: SearchStage) => void
  ): Promise<Exact80Result> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        request: { id: `job-${this.nextId++}`, bytes: input, format },
        onStage,
        resolve,
        reject,
      });
      this.pump();
    });
  }

  /** Hand queued work to whichever worker is free, starting more if allowed. */
  private pump(): void {
    while (this.queue.length > 0) {
      const worker = this.idle.pop() ?? (this.workers.length < this.size ? this.spawn() : null);
      if (!worker) return;

      const job = this.queue.shift()!;
      this.running.set(worker, job);
      worker.postMessage(job.request, [job.request.bytes]);
    }
  }

  private spawn(): Worker {
    const worker = new Worker(new URL('@/workers/compress.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handle(worker, event.data);
    worker.onerror = (event) => this.fail(worker, new Error(event.message || 'Worker failed'));

    this.workers.push(worker);
    return worker;
  }

  private handle(worker: Worker, message: WorkerResponse): void {
    const job = this.running.get(worker);
    if (!job || job.request.id !== message.id) return;

    if (message.type === 'progress') {
      job.onStage?.(message.stage);
      return;
    }

    this.release(worker);

    if (message.type === 'error') {
      job.reject(new Error(message.message));
      return;
    }

    const { type, id, data, ...rest } = message;
    job.resolve({ ...rest, data: new Uint8Array(data) });
  }

  private fail(worker: Worker, error: Error): void {
    const job = this.running.get(worker);
    this.release(worker);
    job?.reject(error);
  }

  private release(worker: Worker): void {
    this.running.delete(worker);
    this.idle.push(worker);
    this.pump();
  }

  /** Stop every worker. Queued and in-flight jobs reject. */
  dispose(): void {
    const abandoned = [...this.running.values(), ...this.queue];
    this.running.clear();
    this.queue.length = 0;

    for (const worker of this.workers) worker.terminate();
    this.workers.length = 0;
    this.idle.length = 0;

    for (const job of abandoned) job.reject(new Error('Compression cancelled'));
  }
}
