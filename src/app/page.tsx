'use client';

/**
 * One screen, one promise: every image comes out at exactly 80,000 bytes.
 *
 * Drop images, see each one as AVIF and WebP side by side with the original, and
 * download the one that looks better. Nothing is uploaded — the compression runs
 * in Web Workers on this machine.
 */

import { useState } from 'react';
import Link from 'next/link';
import { zip } from 'fflate';
import { Download, Loader2 } from 'lucide-react';
import DropZone from '@/components/DropZone';
import ResultCard from '@/components/ResultCard';
import { Button } from '@/components/ui/button';
import { EXACT80_BYTES } from '@/lib/exact80/core/search';
import { useCompressor, type Job } from '@/lib/exact80/useCompressor';

function downloadName(originalName: string, format: string): string {
  return `${originalName.replace(/\.[^.]+$/, '').replace(/\s+/g, '-')}-80kb.${format}`;
}

/** Bundle each image's chosen format into one archive. */
async function downloadAll(jobs: Job[]): Promise<void> {
  const entries: Record<string, Uint8Array> = {};

  for (const job of jobs) {
    const result = job.outputs[job.selected].result;
    if (result) entries[downloadName(job.file.name, job.selected)] = result.data;
  }

  const archive = await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, { level: 0 }, (error, data) => (error ? reject(error) : resolve(data)));
  });

  const url = URL.createObjectURL(new Blob([archive as BlobPart], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'exact-80kb.zip';
  link.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const { jobs, addFiles, select, remove, clear, busy } = useCompressor();
  const [zipping, setZipping] = useState(false);

  const finished = jobs.filter((job) => job.outputs[job.selected].result);
  const originalBytes = finished.reduce((sum, job) => sum + job.file.size, 0);
  const savedBytes = originalBytes - finished.length * EXACT80_BYTES;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto max-w-3xl px-4 py-10 text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Every image, exactly <span className="text-primary">80 KB</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Drop an image and get it back as WebP or AVIF at exactly 80,000 bytes — the
            best-looking version that fits. It runs on your device, so nothing is uploaded.
          </p>
          <p className="mt-4 text-sm">
            <Link href="/gallery" className="font-medium text-primary underline-offset-4 hover:underline">
              See what 80 KB looks like →
            </Link>
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <DropZone onFiles={addFiles} />

        {jobs.length > 0 && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {busy
                  ? `Compressing ${jobs.length} image${jobs.length === 1 ? '' : 's'}…`
                  : savedBytes > 0
                    ? `${finished.length} image${finished.length === 1 ? '' : 's'} · ${(savedBytes / 1024 / 1024).toFixed(1)} MB saved`
                    : `${finished.length} image${finished.length === 1 ? '' : 's'} ready`}
              </p>

              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={clear}>
                  Clear
                </Button>
                {finished.length > 1 && (
                  <Button
                    size="sm"
                    disabled={zipping}
                    onClick={async () => {
                      setZipping(true);
                      try {
                        await downloadAll(finished);
                      } finally {
                        setZipping(false);
                      }
                    }}
                  >
                    {zipping ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Download className="mr-2 h-4 w-4" aria-hidden />
                    )}
                    Download all
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-4">
              {jobs.map((job) => (
                <ResultCard
                  key={job.id}
                  job={job}
                  onSelect={(format) => select(job.id, format)}
                  onRemove={() => remove(job.id)}
                />
              ))}
            </div>
          </>
        )}

        <section className="space-y-3 border-t border-border pt-6 text-sm text-muted-foreground">
          <h2 className="font-medium text-foreground">How it hits the number</h2>
          <p>
            Encoders cannot be asked for an exact file size, so this finds the best-looking
            version that fits under 80,000 bytes, then pads the file to the number with a chunk
            that decoders ignore. The image is unchanged.
          </p>
          <p>
            Fitting the budget is a trade between resolution and quality. Squeezing a large photo
            into 80 KB by dropping quality alone looks bad, so each candidate size is scored
            against the original and the one that survives best wins — which usually means a
            smaller, cleaner image.
          </p>

          <h2 className="pt-3 font-medium text-foreground">In a build, or from a terminal</h2>
          <p>
            The same engine runs as a command and as an endpoint, for the images you never open a
            browser for.
          </p>
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs text-foreground">
            <code>{`npx exact80 ./images --format webp

curl -X POST https://exact80.vercel.app/api/compress \\
  -F image=@photo.jpg -o photo.avif`}</code>
          </pre>
          <p>
            There is a GitHub Action too, which compresses the images in a pull request and comments
            with what it saved. The{' '}
            <a
              href="https://github.com/godwillcodes/PixelPress#readme"
              className="underline underline-offset-4 hover:text-foreground"
            >
              README
            </a>{' '}
            has the details.
          </p>
        </section>
      </main>
    </div>
  );
}
