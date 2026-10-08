/**
 * Output names, kept distinct.
 *
 * Two inputs can easily want the same output name — `photo.jpg` and `photo.png`
 * in one folder, `a/logo.png` and `b/logo.png` from a directory walk, or the
 * same screenshot pasted twice. Whatever collects the results (a ZIP, a
 * directory) would otherwise keep the last one and silently lose the rest, which
 * is the kind of loss nobody notices until the images are gone.
 */

/**
 * `name` if it is free, otherwise the same name with a counter before the
 * extension: `logo.webp`, `logo-2.webp`, `logo-3.webp`.
 *
 * Does not record the result — callers add it to `taken` once they commit to it.
 */
export function uniqueName(taken: ReadonlySet<string>, name: string): string {
  if (!taken.has(name)) return name;

  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';

  for (let counter = 2; ; counter++) {
    const candidate = `${stem}-${counter}${extension}`;
    if (!taken.has(candidate)) return candidate;
  }
}
