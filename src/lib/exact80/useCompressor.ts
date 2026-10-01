'use client';

/**
 * Drives the worker pool for the page: one job per image, both formats for each.
 *
 * Both formats are always encoded, because the point of the comparison is to let
 * someone see which one holds up better at 80,000 bytes — and at a fixed budget
 * that answer changes from image to image.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CompressorPool } from './pool';
import type { Exact80Result, OutputFormat, SearchStage } from './core/types';

export const FORMATS: OutputFormat[] = ['avif', 'webp'];

export interface FormatOutcome {
  stage?: SearchStage;
  result?: Exact80Result;
  /** Object URL for previewing and downloading the result. */
  url?: string;
  error?: string;
}

export interface Job {
  id: string;
  file: File;
  /** Object URL of the original, for the comparison. */
  previewUrl: string;
  outputs: Record<OutputFormat, FormatOutcome>;
  /** The format on show. Starts as the better-scoring one. */
  selected: OutputFormat;
  /** The better-scoring format, once both have finished. */
  recommended?: OutputFormat;
}

const isFinished = (job: Job) => FORMATS.every((f) => job.outputs[f].result || job.outputs[f].error);

export function useCompressor() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const poolRef = useRef<CompressorPool | null>(null);
  // Object URLs outlive React state updates, so they are tracked separately and
  // revoked on unmount — otherwise every image leaks until the tab closes.
  const urlsRef = useRef<string[]>([]);

  const trackUrl = (url: string) => {
    urlsRef.current.push(url);
    return url;
  };

  useEffect(() => {
    return () => {
      poolRef.current?.dispose();
      poolRef.current = null;
      for (const url of urlsRef.current) URL.revokeObjectURL(url);
      urlsRef.current = [];
    };
  }, []);

  const update = useCallback((id: string, change: (job: Job) => Job) => {
    setJobs((current) => current.map((job) => (job.id === id ? change(job) : job)));
  }, []);

  const addFiles = useCallback(
    (files: File[]) => {
      const pool = (poolRef.current ??= new CompressorPool());

      for (const file of files) {
        const id = `${file.name}-${file.size}-${crypto.randomUUID()}`;
        const job: Job = {
          id,
          file,
          previewUrl: trackUrl(URL.createObjectURL(file)),
          outputs: { avif: { stage: 'decoding' }, webp: { stage: 'decoding' } },
          selected: 'avif',
        };
        setJobs((current) => [...current, job]);

        for (const format of FORMATS) {
          // One copy per format: the buffer is transferred to the worker.
          file
            .arrayBuffer()
            .then((bytes) =>
              pool.compress(bytes, format, (stage) =>
                update(id, (j) => ({ ...j, outputs: { ...j.outputs, [format]: { ...j.outputs[format], stage } } }))
              )
            )
            .then((result) => {
              const url = trackUrl(
                URL.createObjectURL(new Blob([result.data as BlobPart], { type: `image/${format}` }))
              );
              update(id, (j) => withRecommendation({
                ...j,
                outputs: { ...j.outputs, [format]: { stage: 'done', result, url } },
              }));
            })
            .catch((error: Error) => {
              update(id, (j) => withRecommendation({
                ...j,
                outputs: { ...j.outputs, [format]: { error: error.message } },
              }));
            });
        }
      }
    },
    [update]
  );

  const select = useCallback(
    (id: string, format: OutputFormat) => update(id, (job) => ({ ...job, selected: format })),
    [update]
  );

  const remove = useCallback((id: string) => {
    setJobs((current) => current.filter((job) => job.id !== id));
  }, []);

  const clear = useCallback(() => setJobs([]), []);

  return { jobs, addFiles, select, remove, clear, busy: jobs.some((job) => !isFinished(job)) };
}

/** Once both formats are in, the better-looking one becomes the recommendation. */
function withRecommendation(job: Job): Job {
  if (!isFinished(job)) return job;

  const scored = FORMATS.map((format) => ({ format, result: job.outputs[format].result })).filter(
    (entry): entry is { format: OutputFormat; result: Exact80Result } => Boolean(entry.result)
  );
  if (scored.length === 0) return job;

  const best = scored.reduce((a, b) => (b.result.score > a.result.score ? b : a)).format;
  return { ...job, recommended: best, selected: best };
}
