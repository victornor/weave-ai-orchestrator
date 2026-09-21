import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RuntimeAdapter, RuntimeEvent, RuntimePartial, TurnHandle, TurnInput, TurnResult, TurnSink } from './index.js';

/**
 * The fake-process harness for per-adapter interrupt tests (VS-660): one scriptable fake process,
 * one TurnSink recorder, and one adapter-agnostic driver. It exists so a test can prove that an
 * adapter's `cancel('interrupt')` reaches its spawned process or server stand-in, stops the turn,
 * and leaves the events recorded before the cut in place — without any adapter knowing a fake is
 * involved (a fake goes on `PATH`, or is handed to `createAdapter` as its `entry`).
 *
 * Nothing here launches a real coding CLI or talks to a live daemon.
 */

export interface FakeProcessSpec {
  /** The executable basename an adapter resolves, e.g. `claude` or `cursor-agent`. */
  name: string;
  /** Stdout lines written immediately on start, in order. */
  lines?: string[];
  /**
   * Keep the process alive after its lines until a signal arrives. Default `true`; the point of an
   * interrupt test is that only the interrupt can end it.
   */
  hang?: boolean;
  /** On SIGINT: write these stdout lines (a child's flush, e.g. a weave `result`), record the signal, then exit. */
  onInterrupt?: { lines?: string[]; exitCode?: number };
  /** Survive SIGINT, so only SIGKILL stops the process (for the escalation backstop). */
  ignoreSigint?: boolean;
}

export interface FakeProcess {
  /** The temp dir holding the executable — prepend it to `PATH`, or pass `bin` as an adapter `entry`. */
  dir: string;
  /** The executable's absolute path. */
  bin: string;
  /** Records which signal stopped the process; empty until one did. */
  marker: string;
}

/** Write a scriptable fake executable into a fresh temp dir and return it. */
export function writeFakeProcess(spec: FakeProcessSpec): FakeProcess {
  const dir = mkdtempSync(join(tmpdir(), 'ac-fake-process-'));
  const bin = join(dir, spec.name);
  const marker = join(dir, 'signal.txt');
  const exitCode = spec.onInterrupt?.exitCode ?? 0;
  const sigint = spec.ignoreSigint
    ? "process.on('SIGINT', () => { /* survives on purpose */ });"
    : `process.on('SIGINT', () => finish('SIGINT', ${exitCode}));`;
  const script = `#!/usr/bin/env node
const fs = require('node:fs');
const LINES = ${JSON.stringify(spec.lines ?? [])};
const FLUSH = ${JSON.stringify(spec.onInterrupt?.lines ?? [])};
function writeAll(list) { for (const l of list) process.stdout.write(l + '\\n'); }
writeAll(LINES);
function finish(sig, code) {
  try { fs.writeFileSync(${JSON.stringify(marker)}, sig); } catch (e) { /* best effort */ }
  writeAll(FLUSH);
  process.exit(code);
}
${sigint}
process.on('SIGTERM', () => finish('SIGTERM', ${exitCode}));
${spec.hang === false
    ? 'process.exit(0);'
    // The interval is what makes only a signal able to end the turn; the timeout is a safety net so
    // a leaked fake (a test that failed before cancelling) cannot outlive the test run forever.
    : 'setInterval(() => {}, 3600_000);\nsetTimeout(() => process.exit(0), 300_000);'}
`;
  writeFileSync(bin, script, { mode: 0o755 });
  chmodSync(bin, 0o755);
  return { dir, bin, marker };
}

/** What a `recordSink` collected, in arrival order. */
export interface SinkRecord {
  events: RuntimeEvent[];
  partials: RuntimePartial[];
  raw: Array<{ stream: 'stdout' | 'stderr'; line: string }>;
  spawns: Array<{ pid: number; pgid: number | null }>;
}

/** A real `TurnSink` plus the arrays it fills — what an adapter emitted this turn. */
export function recordSink(): { sink: TurnSink; recorded: SinkRecord } {
  const recorded: SinkRecord = { events: [], partials: [], raw: [], spawns: [] };
  const sink: TurnSink = {
    onSpawn: (info) => recorded.spawns.push(info),
    onEvent: (event) => recorded.events.push(event),
    onRaw: (stream, line) => recorded.raw.push({ stream, line }),
    onPartial: (partial) => recorded.partials.push(partial),
  };
  return { sink, recorded };
}

/** Poll until `cond` is true, or reject after `timeoutMs`. Never waits for a background job forever. */
export async function waitFor(cond: () => boolean, opts: { timeoutMs?: number; label?: string } = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (cond()) return;
    if (Date.now() > end) throw new Error(`waitFor timed out after ${timeoutMs}ms${opts.label ? `: ${opts.label}` : ''}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export interface InterruptTurnOptions {
  /** Wait for the turn to be genuinely under way before cancelling. Default: at least one event or partial. */
  until?: (recorded: SinkRecord) => boolean;
  /** Bound on both waiting and stopping. Default 10 000 ms. */
  timeoutMs?: number;
}

/**
 * Start `adapter.runTurn`, wait until the turn is under way, send `cancel('interrupt')`, and return
 * the result plus everything the sink recorded. A cancel that does not reach the process leaves the
 * turn unresolved, which rejects here rather than hanging — the property each test relies on.
 */
export async function interruptedTurn(
  adapter: Pick<RuntimeAdapter, 'runTurn'>,
  input: TurnInput,
  opts: InterruptTurnOptions = {},
): Promise<{ result: TurnResult; recorded: SinkRecord; handle: TurnHandle }> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const { sink, recorded } = recordSink();
  let handle: TurnHandle | undefined;
  const turn = adapter.runTurn(input, sink, (h) => { handle = h; });
  const until = opts.until ?? ((r: SinkRecord) => r.events.length > 0 || r.partials.length > 0);
  await waitFor(() => handle !== undefined && until(recorded), { timeoutMs, label: 'the turn to be under way' });
  await handle!.cancel('interrupt');
  void turn.catch(() => undefined); // a late rejection after the timeout below must not go unhandled
  const result = await raceTimeout(turn, timeoutMs, 'the turn did not stop after cancel(interrupt)');
  return { result, recorded, handle: handle! };
}

async function raceTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`interruptedTurn timed out after ${timeoutMs}ms: ${label}`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}