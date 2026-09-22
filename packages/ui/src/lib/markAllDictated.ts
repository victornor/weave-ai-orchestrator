/**
 * "Mark all my messages as voice dictated" (VS-657). Off by default.
 *
 * A person who dictates everything can still have every message delivered with the `(voice dictated)`
 * line, whether or not that particular message was dictated. Like the other dictation habits it is
 * device-local (`localStorage`), not daemon policy: dictation belongs to the person and the device
 * they are speaking into, and a workspace setting would mark every human's messages. Settings and the
 * composer are never mounted together, so the write publishes an event a mounted composer follows.
 */
import { useEffect, useState } from 'react';

const KEY = 'conductor.markAllDictated';
const EVENT = 'conductor:mark-all-dictated';

export function readMarkAllDictated(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

export function writeMarkAllDictated(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: the setting holds for this session and the device does not remember it */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Reads the setting and follows it, so turning it on takes effect without a reload. */
export function useMarkAllDictated(): boolean {
  const [on, set] = useState(readMarkAllDictated);
  useEffect(() => {
    const sync = (): void => set(readMarkAllDictated());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return on;
}
