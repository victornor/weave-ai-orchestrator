/**
 * Chat reading preferences held on this device (VS-74).
 *
 * Whether the chat shows a row for a conductor turn that produced no message is a matter of taste
 * about how much of the machine to watch, not workspace state, so it lives in `localStorage` beside
 * the theme and the notification switches rather than in the workspace config. It defaults to on:
 * the point of the rows is that work the conductor did on its own is not invisible, and someone who
 * wants the quieter conversation turns them off once.
 *
 * The setting is changed on Settings and read on Chat, two screens that are never mounted together,
 * so the switch publishes on an event of its own — `storage` fires only in *other* documents, and
 * this app is one document.
 */
import { useEffect, useState } from 'react';

const KEY = 'conductor.chat.silentTurns';
const EVENT = 'conductor:chat-prefs';

/** The default survives an unreadable store: a browser that refuses storage still shows the rows. */
export function readShowSilentTurns(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function writeShowSilentTurns(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: the setting holds for this session and the device does not remember it */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Reads the setting and follows it, so turning it off takes effect without a reload. */
export function useShowSilentTurns(): boolean {
  const [on, set] = useState(readShowSilentTurns);
  useEffect(() => {
    const sync = (): void => set(readShowSilentTurns());
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
