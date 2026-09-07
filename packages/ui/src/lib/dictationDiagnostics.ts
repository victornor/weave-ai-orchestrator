/**
 * Dictation diagnostics capture (VS-121). Off by default: no worker can dictate on a real phone,
 * and reasoning out a fix from a reconstructed event sequence is a second guess — the same shape
 * of mistake VS-70 already made once. This turns the phone dictating into the instrument instead:
 * while it is on, `useDictation` records the raw recognizer events and the composer text handed
 * back after each one, and a human can copy that log out. Nothing here sends it anywhere; the only
 * way it leaves the device is a deliberate copy.
 *
 * The setting is changed on Settings and read from the composer, two screens that are never
 * mounted together, so it publishes on an event of its own — same shape as `chatPrefs.ts`.
 */
import { useEffect, useState } from 'react';

const KEY = 'conductor.dictationDiagnostics';
const EVENT = 'conductor:dictation-diagnostics';

/** One recognizer result event: its index and every entry it carried, plus what it produced. */
export interface DictationCaptureResult {
  kind: 'result';
  resultIndex: number;
  entries: Array<{ isFinal: boolean; transcript: string }>;
  /** This session's transcript rebuilt from the whole results list, before the committed prefix. */
  sessionTextAfter: string;
  /** What was handed to the composer's callback: the committed prefix plus this session's text. */
  handedToComposer: string;
  final: boolean;
}

export interface DictationCaptureStart {
  kind: 'start';
}

/** A recognition session ending — on its own or because dictation stopped. */
export interface DictationCaptureEnd {
  kind: 'end';
  restarted: boolean;
  committedAfter: string;
}

export type DictationCaptureEntry = DictationCaptureStart | DictationCaptureResult | DictationCaptureEnd;

/** Oldest entries drop first so a long session cannot grow the log without bound. */
export const DICTATION_DIAGNOSTICS_CAP = 500;

export function appendCapture(log: DictationCaptureEntry[], entry: DictationCaptureEntry): void {
  log.push(entry);
  while (log.length > DICTATION_DIAGNOSTICS_CAP) log.shift();
}

export function formatDictationCapture(log: DictationCaptureEntry[]): string {
  return JSON.stringify(log, null, 2);
}

export function readDictationDiagnosticsEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

export function writeDictationDiagnosticsEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: the setting holds for this session and the device does not remember it */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Reads the setting and follows it, so turning it on takes effect without a reload. */
export function useDictationDiagnosticsEnabled(): boolean {
  const [on, set] = useState(readDictationDiagnosticsEnabled);
  useEffect(() => {
    const sync = (): void => set(readDictationDiagnosticsEnabled());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return on;
}
