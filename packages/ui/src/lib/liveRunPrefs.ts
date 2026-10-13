/**
 * Whether the weaver chat shows the weaver's streamed text and mid-turn tool trace (VS-616).
 *
 * On by default (VS-799): watching a long turn with only a "running" indicator left the reader in
 * the dark. The section is marked as in-progress run output and clears when the real message
 * arrives, so it is not read as a delivered message. Off (an explicit choice in Settings), the
 * weaver chat shows only sent messages plus the one-line activity row.
 *
 * Like every other chat-display preference (`chatPrefs.ts`'s "Turns with no reply", the rail, the
 * theme, text size) this is held in this browser's localStorage, not on the daemon — there is no
 * per-user settings store. The switch is changed on Settings and read on Chat, two screens that are
 * never mounted together, so the writer publishes on an event of its own.
 */
import { useEffect, useState } from 'react';

const KEY = 'conductor.chat.liveRunOutput';
const EVENT = 'conductor:chat-live-run-output';

/** The default is on: only a stored 'off' (the user turned it off) hides the live section. */
export function readShowLiveRunOutput(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function writeShowLiveRunOutput(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: the setting holds for this session and the device does not remember it */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Reads the setting and follows it, so toggling it takes effect without a reload. */
export function useShowLiveRunOutput(): boolean {
  const [on, set] = useState(readShowLiveRunOutput);
  useEffect(() => {
    const sync = (): void => set(readShowLiveRunOutput());
    window.addEventListener(EVENT, sync);
    // Another tab of the same app: `storage` is the only signal that crosses documents.
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return on;
}