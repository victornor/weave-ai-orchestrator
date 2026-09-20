/**
 * The engine's partial-output buffer (VS-595).
 *
 * A runtime reports fragments of the parts it is still generating; this accumulates them per part,
 * coalesces them to one `run.delta` frame per interval per run, redacts them like any persisted event,
 * and keeps the shown text so a page that connects mid-step can read it. Nothing here is stored: the
 * completed event for a part supersedes its partial (`complete`), and a turn's end or cancel drops all.
 *
 * Redaction: a secret split across two fragments must never show. Text is released only up to
 * the point where the raw text ends in something that could still become a secret, and never
 * mid-way through an occurrence of a secret, so a secret is either whole inside released text (and
 * masked) or not released.
 */
import type { RunDeltaFrame, RunDeltaPart, RunLiveSnapshot } from '@weave-ai/shared';
import type { RuntimePartial } from '@weave-ai/runtime-sdk';

const DEFAULT_INTERVAL_MS = 50;
const DEFAULT_CAP_CHARS = 64 * 1024;

interface PartState { kind: RunDeltaPart['kind']; raw: string; released: number; shown: string; dirty: boolean }

export interface PartialBufferOptions {
  emit: (frame: RunDeltaFrame) => void;
  runId: string;
  /** Masks a released chunk; the engine's own redactor for strings. */
  redact: (text: string) => string;
  /** The redaction secrets in force; read at every release so a late-registered secret is honoured. */
  secrets?: () => readonly string[];
  intervalMs?: number;
  capChars?: number;
}

/** The length of the longest tail of `raw` that is a proper prefix of one of `secrets`. */
function secretPrefixTail(raw: string, secrets: readonly string[]): number {
  let hold = 0;
  for (const v of secrets) {
    for (let k = Math.min(v.length - 1, raw.length); k > hold; k--) {
      if (raw.endsWith(v.slice(0, k))) { hold = k; break; }
    }
  }
  return hold;
}

export class PartialBuffer {
  private readonly parts = new Map<string, PartState>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly intervalMs: number;
  private readonly capChars: number;

  constructor(private readonly opts: PartialBufferOptions) {
    this.intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.capChars = opts.capChars ?? DEFAULT_CAP_CHARS;
  }

  push(p: RuntimePartial): void {
    if (!p.text) return;
    let part = this.parts.get(p.partId);
    if (!part) { part = { kind: p.kind, raw: '', released: 0, shown: '', dirty: false }; this.parts.set(p.partId, part); }
    // Past the cap the part stops growing: the completed event carries the whole text.
    const room = this.capChars - part.raw.length;
    if (room <= 0) return;
    part.raw += p.text.length > room ? p.text.slice(0, room) : p.text;
    part.dirty = true;
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.intervalMs);
  }

  /** The completed event for `partId` has been recorded: its partial is superseded. */
  complete(partId: string): void { this.parts.delete(partId); }

  /** The turn ended or was cancelled: drop everything, emit nothing further. */
  clear(): void {
    this.parts.clear();
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  /** What each live part has shown so far (already redacted). */
  snapshot(): RunLiveSnapshot {
    return { partials: [...this.parts].filter(([, s]) => s.shown).map(([partId, s]) => ({ partId, kind: s.kind, text: s.shown })) };
  }

  flush(): void {
    this.timer = null;
    const secrets = (this.opts.secrets?.() ?? []).filter((s) => s.length >= 8);
    const out: RunDeltaPart[] = [];
    for (const [partId, s] of this.parts) {
      if (!s.dirty) continue;
      s.dirty = false;
      // Only a tail that could be the start of a secret is held back, so ordinary text has no lag.
      let safe = s.raw.length - secretPrefixTail(s.raw, secrets);
      // A secret that straddles the boundary is released whole or not at all.
      for (let moved = true; moved;) {
        moved = false;
        for (const v of secrets) {
          for (let i = s.raw.indexOf(v); i >= 0; i = s.raw.indexOf(v, i + 1)) {
            if (i < safe && i + v.length > safe) { safe = i; moved = true; }
          }
        }
      }
      if (safe <= s.released) continue;
      const text = this.opts.redact(s.raw.slice(s.released, safe));
      out.push({ partId, kind: s.kind, offset: s.shown.length, text });
      s.shown += text;
      s.released = safe;
    }
    if (out.length > 0) this.opts.emit({ runId: this.opts.runId, parts: out });
  }
}
