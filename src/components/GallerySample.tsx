'use client';

/**
 * One gallery entry: the original against its 80,000-byte version, with the
 * numbers that produced it.
 *
 * The format toggle is the point of the page — at a fixed budget the better
 * format changes from image to image, and seeing that is more convincing than
 * being told it.
 */

import { useState } from 'react';
import CompareSlider from './CompareSlider';
import { Badge } from './ui/badge';
import type { OutputFormat } from '@/lib/exact80/core/types';

export interface SampleOutput {
  width: number;
  height: number;
  quality: number;
  score: number;
  encodes: number;
  ms: number;
  file: string;
}

export interface Sample {
  slug: string;
  title: string;
  note: string;
  credit: string | null;
  sourceBytes: number;
  sourceWidth: number;
  sourceHeight: number;
  previewFile: string;
  outputs: Partial<Record<OutputFormat, SampleOutput>>;
}

const FORMATS: OutputFormat[] = ['avif', 'webp'];

const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

export default function GallerySample({ sample }: { sample: Sample }) {
  const available = FORMATS.filter((format) => sample.outputs[format]);
  const best = available.reduce((a, b) =>
    (sample.outputs[b]?.score ?? 0) > (sample.outputs[a]?.score ?? 0) ? b : a
  );
  const [selected, setSelected] = useState<OutputFormat>(best);
  const output = sample.outputs[selected]!;

  return (
    <section className="space-y-4 border-t border-border pt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold">{sample.title}</h2>
        <p className="font-mono text-sm text-muted-foreground">
          {formatBytes(sample.sourceBytes)} → 80,000 bytes
        </p>
      </div>

      <p className="max-w-2xl text-sm text-muted-foreground">{sample.note}</p>

      <div className="flex flex-wrap gap-2">
        {available.map((format) => (
          <button
            key={format}
            type="button"
            onClick={() => setSelected(format)}
            aria-pressed={selected === format}
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
              selected === format
                ? 'border-primary bg-primary/5 font-medium'
                : 'border-border hover:border-primary/50'
            }`}
          >
            {format.toUpperCase()}
            {format === best && (
              <Badge variant="default" className="ml-2 text-[10px]">
                Looks best
              </Badge>
            )}
          </button>
        ))}
      </div>

      <CompareSlider
        beforeUrl={sample.previewFile}
        afterUrl={output.file}
        aspectRatio={output.width / output.height}
        afterLabel={`${selected.toUpperCase()} · 80 KB`}
      />

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Original</dt>
          <dd className="font-mono">
            {sample.sourceWidth}×{sample.sourceHeight}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">At 80 KB</dt>
          <dd className="font-mono">
            {output.width}×{output.height}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Quality</dt>
          <dd className="font-mono">{output.quality}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground" title="Structural similarity to the original, 1.0 is identical">
            SSIM
          </dt>
          <dd className="font-mono">{output.score.toFixed(3)}</dd>
        </div>
      </dl>

      {sample.credit && <p className="text-xs text-muted-foreground">{sample.credit}</p>}
    </section>
  );
}
