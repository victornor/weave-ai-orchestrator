import type { UiStatus } from '@openconductor/shared';

export const STATUS_LABEL: Record<UiStatus, string> = {
  idle: 'idle',
  working: 'working',
  stalled: 'stalled',
  blocked: 'blocked',
  'needs-you': 'needs you',
  merging: 'merging',
  done: 'done',
  failed: 'failed',
  paused: 'paused',
};

/** Tailwind text colour utility per status (tokens only, no literals). */
export const STATUS_TEXT: Record<UiStatus, string> = {
  idle: 'text-idle',
  working: 'text-working',
  stalled: 'text-stalled',
  blocked: 'text-blocked',
  'needs-you': 'text-needs-you',
  merging: 'text-merging',
  done: 'text-done',
  failed: 'text-failed',
  paused: 'text-paused',
};

/** The CSS custom property holding the hue, for tints and SVG fills. */
export const STATUS_VAR: Record<UiStatus, string> = {
  idle: 'var(--status-idle)',
  working: 'var(--status-working)',
  stalled: 'var(--status-stalled)',
  blocked: 'var(--status-blocked)',
  'needs-you': 'var(--status-needs-you)',
  merging: 'var(--status-merging)',
  done: 'var(--status-done)',
  failed: 'var(--status-failed)',
  paused: 'var(--status-paused)',
};

export type GlyphShape =
  | { kind: 'circle'; filled: boolean }
  | { kind: 'path'; d: string; filled: boolean; dashed?: boolean }
  | { kind: 'bars' };

/**
 * One glyph per status, drawn on a 12×12 grid. Shapes carry the meaning:
 * triangle-up = running; the same triangle hollow and dashed = stalled
 * ("the shape says this was running, the fill says it still is").
 */
export const STATUS_GLYPH: Record<UiStatus, GlyphShape> = {
  idle: { kind: 'circle', filled: false },
  working: { kind: 'path', d: 'M6 0.6 L11.6 11.4 L0.4 11.4 Z', filled: true },
  stalled: { kind: 'path', d: 'M6 0.9 L11.2 11.1 L0.8 11.1 Z', filled: false, dashed: true },
  blocked: { kind: 'path', d: 'M3.2 0.6 H8.8 L11.7 6 L8.8 11.4 H3.2 L0.3 6 Z', filled: true },
  'needs-you': { kind: 'path', d: 'M6 0.3 L11.7 6 L6 11.7 L0.3 6 Z', filled: true },
  merging: { kind: 'path', d: 'M3 0.8 H11.6 L9 11.2 H0.4 Z', filled: true },
  done: { kind: 'circle', filled: true },
  failed: { kind: 'path', d: 'M0.4 0.9 H11.6 L6 11.3 Z', filled: true },
  paused: { kind: 'bars' },
};
