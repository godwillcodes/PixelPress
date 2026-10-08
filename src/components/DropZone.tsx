'use client';

/**
 * The way images get in: drop, click, or paste.
 *
 * Paste matters more than it looks — a screenshot is the most common thing
 * anyone needs to squeeze under a size limit, and it is already on the clipboard.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';

interface DropZoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

const isImage = (file: File) => file.type.startsWith('image/');

export default function DropZone({ onFiles, disabled }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const accept = useCallback(
    (files: FileList | File[] | null) => {
      const images = Array.from(files ?? []).filter(isImage);
      if (images.length > 0) onFiles(images);
    },
    [onFiles]
  );

  // Paste anywhere on the page, not just when the drop zone has focus.
  useEffect(() => {
    if (disabled) return;

    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.some(isImage)) {
        event.preventDefault();
        accept(files);
      }
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [accept, disabled]);

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Add images: click, drop files here, or paste from the clipboard"
      aria-disabled={disabled}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled) accept(event.dataTransfer.files);
      }}
      className={`group flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/60'
      } ${disabled ? 'pointer-events-none opacity-50' : ''}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          accept(event.target.files);
          event.target.value = ''; // let the same file be picked again
        }}
      />

      <Upload
        className="h-8 w-8 text-muted-foreground transition-colors group-hover:text-primary"
        aria-hidden
      />
      <div>
        <p className="font-medium">Drop images here</p>
        <p className="mt-1 text-sm text-muted-foreground">
          or click to choose, or paste a screenshot
        </p>
      </div>
    </div>
  );
}
