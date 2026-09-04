/**
 * The nine UI status tokens (design contract §2): one glyph + one hue each, used identically
 * in badges, rows, cards, charts and transcript lines, in the web app and in the TUI.
 */
import { UI_STATUSES, type UiStatus } from '@openconductor/shared';

/** Unicode glyphs for the TUI. The shape carries the meaning, the colour only reinforces it. */
export const STATUS_GLYPHS: Record<UiStatus, string> = {
  idle: '○',
  working: '▲',
  stalled: '△',
  blocked: '■',
  'needs-you': '◆',
  merging: '⬢',
  done: '●',
  failed: '✕',
  paused: '‖',
};

/** Dark-theme hues, straight from the design contract §2 table. */
export const STATUS_COLORS: Record<UiStatus, string> = {
  idle: '#8A8F98',
  working: '#E9A23B',
  stalled: '#C98A2E',
  blocked: '#FF6B4A',
  'needs-you': '#7C87F0',
  merging: '#A472F5',
  done: '#3FB950',
  failed: '#E5484D',
  paused: '#6B7078',
};

/** Nearest Ink/chalk colour for each hue — terminals do not do hex reliably over SSH. */
export const STATUS_INK_COLORS: Record<UiStatus, string> = {
  idle: 'gray',
  working: 'yellow',
  stalled: 'yellowBright',
  blocked: 'red',
  'needs-you': 'blueBright',
  merging: 'magenta',
  done: 'green',
  failed: 'redBright',
  paused: 'gray',
};

/** Human labels; `micro/11` uppercases them, the TUI does not. */
export const STATUS_LABELS: Record<UiStatus, string> = {
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

/** Sort order for fleet views: what needs the human first, what is finished last. */
export const STATUS_ORDER: Record<UiStatus, number> = {
  'needs-you': 0,
  blocked: 1,
  stalled: 2,
  working: 3,
  merging: 4,
  paused: 5,
  idle: 6,
  failed: 7,
  done: 8,
};

export function isUiStatus(value: unknown): value is UiStatus {
  return typeof value === 'string' && (UI_STATUSES as readonly string[]).includes(value);
}

/** Never throws on an unknown status: unknown reads as `idle`. */
export function statusGlyph(status: UiStatus | string | null | undefined): string {
  return isUiStatus(status) ? STATUS_GLYPHS[status] : STATUS_GLYPHS.idle;
}

export function statusColor(status: UiStatus | string | null | undefined): string {
  return isUiStatus(status) ? STATUS_COLORS[status] : STATUS_COLORS.idle;
}

export function statusInkColor(status: UiStatus | string | null | undefined): string {
  return isUiStatus(status) ? STATUS_INK_COLORS[status] : STATUS_INK_COLORS.idle;
}

export function statusLabel(status: UiStatus | string | null | undefined): string {
  return isUiStatus(status) ? STATUS_LABELS[status] : STATUS_LABELS.idle;
}

export function statusRank(status: UiStatus | string | null | undefined): number {
  return isUiStatus(status) ? STATUS_ORDER[status] : STATUS_ORDER.idle;
}

/** `◆ needs you` — the one-token badge used in tables and window titles. */
export function statusBadge(status: UiStatus | string | null | undefined): string {
  return `${statusGlyph(status)} ${statusLabel(status)}`;
}
