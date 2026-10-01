'use client';

/**
 * Before and after, under a draggable divider.
 *
 * The whole product is a claim about how the result looks, so people need to
 * check it rather than take a number on trust. Both images are rendered at the
 * same display size — which is how the compressed one will actually be seen —
 * and the divider is a range input, so it works with a mouse, a finger, or the
 * arrow keys, and screen readers announce it without extra wiring.
 */

import { useId, useState } from 'react';

/** Tallest the comparison frame gets, so a portrait photo still fits on screen. */
const MAX_HEIGHT = 420;

interface CompareSliderProps {
  beforeUrl: string;
  afterUrl: string;
  /** Used to reserve the right space before the images load. */
  aspectRatio: number;
  beforeLabel?: string;
  afterLabel?: string;
}

export default function CompareSlider({
  beforeUrl,
  afterUrl,
  aspectRatio,
  beforeLabel = 'Original',
  afterLabel = 'Compressed',
}: CompareSliderProps) {
  const [position, setPosition] = useState(50);
  const id = useId();

  return (
    <figure className="m-0">
      <div
        className="relative mx-auto select-none overflow-hidden rounded-lg bg-muted"
        style={{
          aspectRatio,
          // Width is the definite dimension so the aspect ratio can set the
          // height; capping it here is what stops a tall portrait photo from
          // pushing everything else off the screen.
          width: `min(100%, ${Math.round(MAX_HEIGHT * aspectRatio)}px)`,
        }}
      >
        {/* The original fills the frame; the compressed version is clipped over it. */}
        <img
          src={beforeUrl}
          alt={beforeLabel}
          className="absolute inset-0 h-full w-full object-contain"
          draggable={false}
        />
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
        >
          <img
            src={afterUrl}
            alt={afterLabel}
            className="absolute inset-0 h-full w-full object-contain"
            draggable={false}
          />
        </div>

        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/90 shadow-[0_0_6px_rgba(0,0,0,0.6)]"
          style={{ left: `${position}%` }}
          aria-hidden
        >
          <div className="absolute top-1/2 left-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/40 backdrop-blur-sm" />
        </div>

        <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
          {beforeLabel}
        </span>
        <span className="pointer-events-none absolute right-2 bottom-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
          {afterLabel}
        </span>

        <label htmlFor={id} className="sr-only">
          Reveal more of the compressed image
        </label>
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          value={position}
          onChange={(event) => setPosition(Number(event.target.value))}
          className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
        />
      </div>
    </figure>
  );
}
