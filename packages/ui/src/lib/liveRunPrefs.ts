/**
 * Whether the weaver chat shows the weaver's streamed text and mid-turn tool trace (VS-616).
 *
 * Captain asked for this to be opt-in and off by default: the streamed text is run output, not
 * something the weaver decided to send, so showing it unasked risks it being read as a delivered
 * message. Off, the weaver chat shows only sent messages plus the one-line activity row.
 *
 * Like every other chat-display preference (`chatPrefs.ts`'s "Turns with no reply", the rail, the
 * theme, text size) this is held in this browser's localStorage, not on the daemon — there is no
 * per-user settings store. The switch is changed on Settings and read on Chat, two screens that are
 * never mounted together, so the writer publishes on an event of its own.
 */
import { useEffect, useState } from 'react';

const KEY = 'conductor.chat.liveRunOutput';
const EVENT = 'conductor:chat-live-run-output';

/** The default is off: text the weaver has not sent is not shown until the human asks for it. */
export function readShowLiveRunOutput(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
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