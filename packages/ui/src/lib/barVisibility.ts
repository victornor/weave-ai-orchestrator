/**
 * Whether the phone tab bar is hidden, remembered per device.
 *
 * A view preference rather than workspace state, so it lives in `localStorage` next to the rail's
 * expansion (`wsExpansion.ts`): hiding the bar costs no round-trip, and a phone can keep it out of
 * the way while a tablet keeps it. Every access is guarded the same way — private mode throws on
 * `localStorage`, and a bar that cannot remember being hidden must still be there.
 */

const KEY = 'conductor.bar.hidden';

/** The remembered choice. Anything unreadable or unrecognised reads as "shown" — the safe default. */
export function readBarHidden(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function writeBarHidden(hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: the session honours the choice, the device just does not remember it */
  }
}
