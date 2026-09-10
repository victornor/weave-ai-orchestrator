/**
 * A bounded history of the conductor chat list's follow-and-scroll measurements, for the one time
 * the "sometimes doesn't scroll to the bottom" behaviour (VS-197) is suspected wrong on a device
 * this investigation could not reach. Off by default, and free when off: the flag is read once at
 * module load, so `record` is a single boolean check with no allocation and no timestamp read
 * unless it is turned on.
 *
 * Enable it from devtools, reload, reproduce the bug once, then export the capture:
 *
 *   localStorage.setItem('ac:scroll-diag', '1')   // reload the page
 *   copy(window.__acScrollDiagnostics())           // after reproducing it
 *
 * and paste the result into a ticket comment. This is a captain-only diagnostic tool, not
 * end-user telemetry: in-memory only, gone on reload, never sent anywhere on its own.
 */

const KEY = 'ac:scroll-diag';
/** Enough to see the run-up to a failure without holding a session's whole history. */
const CAPACITY = 300;

export type ScrollDiagnosticEvent = 'scroll' | 'follow' | 'pin';

export interface ScrollDiagnosticSample {
  /** Milliseconds since the page loaded (`performance.now()`), so samples order and space out. */
  t: number;
  /** Which of `useStickToBottom`'s three measurement points recorded this sample. */
  event: ScrollDiagnosticEvent;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  atBottom: boolean;
  following: boolean;
  opened: boolean;
}

function readEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

const enabled = readEnabled();
const buffer: ScrollDiagnosticSample[] = [];

/** No-op unless diagnostics were enabled before this module loaded. */
export function record(sample: Omit<ScrollDiagnosticSample, 't'>): void {
  if (!enabled) return;
  buffer.push({ t: Math.round(performance.now()), ...sample });
  if (buffer.length > CAPACITY) buffer.shift();
}

/** The captured samples so far, oldest first. Exposed on `window` for a devtools console to reach. */
export function diagnostics(): ScrollDiagnosticSample[] {
  return [...buffer];
}

if (typeof window !== 'undefined') {
  (window as unknown as { __acScrollDiagnostics: typeof diagnostics }).__acScrollDiagnostics = diagnostics;
}
