/**
 * `liveTurn` — what a running turn is doing right now, and how long it has been doing it (VS-595).
 *
 * A live run must never read as a bare "working": between two events the model is generating, a tool
 * is running, or nothing has happened for a while — three different situations a human needs told
 * apart. Pure over the run's persisted events plus the partial output still being generated, with
 * `now` passed in so the page's one-second clock (not the model) drives the elapsed times.
 */
import type { RunEvent } from '@weave-ai/shared';
import { oneLine } from './format.js';
import { toolTarget } from './transcript.js';

export type LiveTurnState = 'starting' | 'streaming' | 'thinking' | 'tool' | 'waiting';

export interface LiveTurnPartial { partId: string; kind: 'text' | 'thinking' | 'tool_input'; text: string }

export interface LiveTurn {
  state: LiveTurnState;
  /** The words for the state: `Running bash sleep 3; ls`, `Waiting for the model`, … */
  label: string;
  /** How long the current state has lasted. */
  stateMs: number;
  /** Since the turn's first event. */
  turnMs: number;
  toolCount: number;
  /** Since anything last arrived: an event or a fragment of partial output. */
  sinceLastMs: number;
  /** Tools started and not yet finished, newest last. */
  running: Array<{ id: string; name: string; target: string | null; elapsedMs: number }>;
  /** True when the run's runtime cannot report partial output: the page says so in words. */
  wholeStepsOnly: boolean;
}

type Payload = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const obj = (v: unknown): Payload | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Payload) : null);
const at = (ts: string): number => { const t = Date.parse(ts); return Number.isFinite(t) ? t : 0; };

export function liveTurn(
  events: readonly RunEvent[],
  partials: readonly LiveTurnPartial[],
  now: number,
  opts: { partialOutput?: 'none' | 'text' | 'full'; lastPartialAt?: number | null; partialSince?: number | null } = {},
): LiveTurn {
  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  let toolCount = 0;
  const open = new Map<string, { name: string; target: string | null; startedAt: number }>();
  for (const e of events) {
    const t = at(e.ts);
    if (t > 0) { first = Math.min(first, t); last = Math.max(last, t); }
    const p = e.payload as Payload;
    if (e.type === 'tool.call') {
      toolCount += 1;
      const name = str(p['name']) ?? 'tool';
      open.set(str(p['id']) ?? `#${e.seq}`, { name, target: toolTarget(name, obj(p['input'])) ?? str(p['title']), startedAt: t });
    } else if (e.type === 'tool.result' || e.type === 'tool.denied') {
      open.delete(str(p['id']) ?? '');
    }
  }
  const running = [...open].map(([id, o]) => ({ id, name: o.name, target: o.target, elapsedMs: Math.max(0, now - o.startedAt) }));
  const lastAny = Math.max(last, opts.lastPartialAt ?? 0);
  const base = { toolCount, running, turnMs: Number.isFinite(first) ? Math.max(0, now - first) : 0, sinceLastMs: lastAny > 0 ? Math.max(0, now - lastAny) : 0, wholeStepsOnly: !opts.partialOutput || opts.partialOutput === 'none' };

  const live = partials.filter((p) => p.text.length > 0);
  const newest = running.at(-1);
  if (newest) {
    const more = running.length > 1 ? ` (+${running.length - 1} more)` : '';
    const what = oneLine([newest.name, newest.target].filter(Boolean).join(' '), 80);
    return { ...base, state: 'tool', label: `Running ${what}${more}`, stateMs: newest.elapsedMs };
  }
  if (live.some((p) => p.kind === 'text')) return { ...base, state: 'streaming', label: 'Writing', stateMs: opts.partialSince ? Math.max(0, now - opts.partialSince) : base.sinceLastMs };
  if (live.some((p) => p.kind === 'thinking')) return { ...base, state: 'thinking', label: 'Thinking', stateMs: opts.partialSince ? Math.max(0, now - opts.partialSince) : base.sinceLastMs };
  if (events.length === 0 || lastAny === 0) return { ...base, state: 'starting', label: 'Starting the turn', stateMs: base.turnMs };
  return { ...base, state: 'waiting', label: 'Waiting for the model', stateMs: base.sinceLastMs };
}

/** `4 s`, `1 m 05 s`: the compact clock the activity row uses. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} m ${String(s % 60).padStart(2, '0')} s`;
}
