/**
 * "Send automatically when dictation ends" (VS-435). Off by default. It is a device-local habit —
 * the same on every phone and desk this browser is used from — not daemon policy, so it lives in
 * `localStorage` rather than `daemon.yaml`, in the same shape as the diagnostics toggle
 * (`dictationDiagnostics.ts`). Settings and the composer are never mounted together, so the write
 * publishes on its own event and a mounted composer follows a change without a reload.
 */
import { useEffect, useState } from 'react';

const KEY = 'conductor.dictationAutoSend';
const EVENT = 'conductor:dictation-auto-send';

export function readDictationAutoSend(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

export function writeDictationAutoSend(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: the setting holds for this session and the device does not remember it */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Reads the setting and follows it, so turning it on takes effect without a reload. */
export function useDictationAutoSend(): boolean {
  const [on, set] = useState(readDictationAutoSend);
  useEffect(() => {
    const sync = (): void => set(readDictationAutoSend());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return on;
}
