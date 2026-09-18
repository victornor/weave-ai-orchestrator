/**
 * The V2 text-size preference (VS-551): one multiplier for the app's whole type scale, chosen from a
 * bounded ladder and remembered on this device, like the V2 theme. The value is published as
 * `--fs-scale` on `.v2-root` (via a `data-text-size` attribute), so every `text-*` utility — and the
 * weaver chat — resizes from one place. Kept out of any daemon or workspace setting: it is a reading
 * preference of the device, not of the workspace.
 */
import { useSyncExternalStore } from 'react';

export type TextSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface TextSizeStep {
  key: TextSize;
  label: string;
  scale: number;
}

/** The ladder. `md` is the designed size and the default, so an untouched install is unchanged. */
export const TEXT_SIZE_STEPS: readonly TextSizeStep[] = [
  { key: 'xs', label: 'Smallest', scale: 0.9 },
  { key: 'sm', label: 'Smaller', scale: 0.95 },
  { key: 'md', label: 'Default', scale: 1 },
  { key: 'lg', label: 'Large', scale: 1.1 },
  { key: 'xl', label: 'Largest', scale: 1.2 },
];

export const DEFAULT_TEXT_SIZE: TextSize = 'md';

/** Deliberately the `weave.v2.*` family, beside the theme and the rail. */
const KEY = 'weave.v2.textSize';

/** The stored step, or the default for anything absent or unrecognised. */
export function readTextSize(): TextSize {
  try {
    const v = localStorage.getItem(KEY);
    return TEXT_SIZE_STEPS.some((s) => s.key === v) ? (v as TextSize) : DEFAULT_TEXT_SIZE;
  } catch {
    return DEFAULT_TEXT_SIZE;
  }
}

export function writeTextSize(size: TextSize): void {
  try {
    localStorage.setItem(KEY, size);
  } catch {
    /* private mode */
  }
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify(): void {
  for (const cb of listeners) cb();
}

/** Write the choice and let every mounted reader (the root, the control) follow in the same paint. */
export function setTextSize(size: TextSize): void {
  if (size === readTextSize()) return;
  writeTextSize(size);
  notify();
}

/** The current step and its setter. The value is a string, so `useSyncExternalStore` is tear-free. */
export function useTextSize(): { size: TextSize; setSize: (size: TextSize) => void } {
  const size = useSyncExternalStore(subscribe, readTextSize, () => DEFAULT_TEXT_SIZE);
  return { size, setSize: setTextSize };
}
