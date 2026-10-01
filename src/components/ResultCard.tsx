'use client';

/**
 * One image: what went in, the two formats it came out as, and the comparison.
 *
 * Both formats are shown at their exact size, because that is the promise, and
 * the thing that varies between them is how they look — so the dimensions and
 * the comparison get the space, not the byte count.
 */

import { Check, Download, X } from 'lucide-react';
import CompareSlider from './CompareSlider';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Progress } from './ui/progress';
import { FORMATS, type Job } from '@/lib/exact80/useCompressor';
import type { OutputFormat, SearchStage } from '@/lib/exact80/core/types';

const STAGE_LABEL: Record<SearchStage, string> = {
  decoding: 'Reading the image',
  probing: 'Sizing it up',
  searching: 'Finding the best fit',
  scoring: 'Comparing candidates',
  done: 'Done',
};

const STAGE_PROGRESS: Record<SearchStage, number> = {
  decoding: 10,
  probing: 25,
  searching: 55,
  scoring: 85,
  done: 100,
};

const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

function downloadName(originalName: string, format: OutputFormat): string {
  const stem = originalName.replace(/\.[^.]+$/, '').replace(/\s+/g, '-');
  return `${stem}-80kb.${format}`;
}

interface ResultCardProps {
  job: Job;
  onSelect: (format: OutputFormat) => void;
  onRemove: () => void;
}

export default function ResultCard({ job, onSelect, onRemove }: ResultCardProps) {
  const chosen = job.outputs[job.selected];
  const pending = FORMATS.filter((format) => !job.outputs[format].result && !job.outputs[format].error);
  const stage = pending.length > 0 ? (job.outputs[pending[0]].stage ?? 'decoding') : 'done';
  const failures = FORMATS.filter((format) => job.outputs[format].error);

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium" title={job.file.name}>
              {job.file.name}
            </p>
            <p className="text-sm text-muted-foreground">
              {formatBytes(job.file.size)}
              {chosen.result && ` → exactly 80,000 bytes`}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove ${job.file.name}`}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {pending.length > 0 && (
          <div>
            <Progress value={STAGE_PROGRESS[stage]} />
            <p className="mt-2 text-sm text-muted-foreground">
              {STAGE_LABEL[stage]}
              {pending.length === 1 && ` (${pending[0].toUpperCase()})`}
            </p>
          </div>
        )}

        {failures.length === FORMATS.length ? (
          <p className="text-sm text-destructive">{job.outputs[failures[0]].error}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              {FORMATS.map((format) => {
                const outcome = job.outputs[format];
                const selected = job.selected === format;

                return (
                  <button
                    key={format}
                    type="button"
                    onClick={() => onSelect(format)}
                    disabled={!outcome.result}
                    aria-pressed={selected}
                    className={`rounded-lg border p-3 text-left transition-colors disabled:opacity-50 ${
                      selected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium uppercase">{format}</span>
                      {job.recommended === format && (
                        <Badge variant="default" className="text-[10px]">
                          Looks best
                        </Badge>
                      )}
                      {selected && <Check className="ml-auto h-4 w-4 text-primary" aria-hidden />}
                    </div>

                    {outcome.result ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {outcome.result.width}×{outcome.result.height} · quality{' '}
                        {outcome.result.quality}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {outcome.error ?? 'Working…'}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>

            {chosen.result && chosen.url && (
              <>
                <CompareSlider
                  beforeUrl={job.previewUrl}
                  afterUrl={chosen.url}
                  aspectRatio={chosen.result.width / chosen.result.height}
                  afterLabel={`${job.selected.toUpperCase()} · 80 KB`}
                />

                {/* Stacks on narrow screens: side by side, the caption runs
                    under the button. */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-muted-foreground">
                    {chosen.result.resized
                      ? `Resized from ${chosen.result.sourceWidth}×${chosen.result.sourceHeight} so the detail that fits stays sharp`
                      : 'Kept at full size'}
                  </p>
                  <Button asChild size="sm" className="shrink-0 self-start sm:self-auto">
                    <a href={chosen.url} download={downloadName(job.file.name, job.selected)}>
                      <Download className="mr-2 h-4 w-4" aria-hidden />
                      Download
                    </a>
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
