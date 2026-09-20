/**
 * Drives one turn through a per-turn `opencode serve` (VS-595), so text, reasoning and a running
 * tool reach the page as they happen instead of when their part finishes.
 *
 * Steps: start the server (same containment, cwd and env as `opencode run`), wait for its listen
 * line, subscribe to `GET /event`, create or reuse the session, `POST prompt_async`, translate the
 * stream (`serve-events.ts`) until `session.idle`, then stop the server. A permission ask is
 * answered by mode (`auto`/`bypass` → `once`, `restricted` → `reject`), which is what `--auto`
 * does on `run`. Cancel aborts the session and then terminates the server.
 *
 * Any failure *before the turn is under way* (no listen line, session not created, stream never
 * connected) returns `null` and the caller runs `opencode run --format json` instead, so a server
 * that cannot start costs the partials and nothing else.
 */
import type { RuntimeEvent, SpawnOutcome, TurnHandle, TurnInput, TurnSink } from '@weave-ai/runtime-sdk';
import { launchCommand, spawnLines } from '@weave-ai/runtime-sdk';
import type { OpenCodeBuiltCommand } from './args.js';
import { parseListenUrl, splitModel } from './compact.js';
import { createOpenCodeServeTranslator } from './serve-events.js';

const LISTEN_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 10_000;

export interface ServeTurn {
  outcome: Pick<SpawnOutcome, 'exitCode' | 'signal' | 'timedOut' | 'stderr'>;
  state: ReturnType<typeof createOpenCodeServeTranslator>['state'];
  sessionId: string;
  /** Events emitted after the translator finished (the closing `turn.completed`). */
  finish: () => RuntimeEvent[];
  /** The turn reached `session.idle`. False means the stream or the server ended first. */
  idle: boolean;
}

/** Split an SSE byte stream into its `data:` payloads. Exported for its test. */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
        const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
        if (data) yield data;
      }
    }
  } finally { reader.releaseLock(); }
}

const json = { 'content-type': 'application/json' };

export async function runServeTurn(
  input: TurnInput,
  sink: TurnSink,
  onHandle: ((h: TurnHandle) => void) | undefined,
  built: OpenCodeBuiltCommand,
  nextSeq: () => number,
): Promise<ServeTurn | null> {
  const launch = launchCommand(built.cmd, built.env);
  let base: string | null = null;
  const listen: { announce: () => void } = { announce: () => undefined };
  const listening = new Promise<void>((resolve) => { listen.announce = resolve; });
  const proc = spawnLines({
    cmd: launch.cmd,
    args: ['serve', '--hostname', '127.0.0.1', '--port', '0'],
    cwd: input.cwd,
    env: launch.env,
    stdin: null,
    timeoutMs: input.limits.timeoutMs,
    containment: input.containment,
    onSpawn: (pid) => sink.onSpawn({ pid, pgid: pid }),
    onLine: (_stream, line) => {
      if (base) return;
      const url = parseListenUrl(line);
      if (url && /listening/i.test(line)) { base = url; listen.announce(); }
    },
  });
  let sessionId: string | null = built.sessionId;
  const ac = new AbortController();
  let cancelled = false;
  const abortSession = async (): Promise<void> => {
    if (!base || !sessionId) return;
    try { await fetch(`${base}/session/${encodeURIComponent(sessionId)}/abort?directory=${encodeURIComponent(input.cwd)}`, { method: 'POST', signal: AbortSignal.timeout(3000) }); } catch { /* the kill below is the backstop */ }
  };
  onHandle?.({
    pid: proc.child.pid ?? null,
    cancel: async (mode) => { cancelled = true; if (mode === 'interrupt') await abortSession(); ac.abort(); await proc.cancel(mode); },
  });
  const stop = async (): Promise<SpawnOutcome> => { ac.abort(); await proc.cancel('kill'); return proc.done; };

  /** A turn cancelled before it was under way ends here: falling back to `run` would start it again. */
  const cancelledTurn = (): ServeTurn => ({
    outcome: { exitCode: null, signal: 'SIGTERM', timedOut: false, stderr: '' },
    state: createOpenCodeServeTranslator({ resumed: built.resumed, sessionId: sessionId ?? '' }).state,
    sessionId: sessionId ?? '', finish: () => [], idle: false,
  });

  const up = await Promise.race([listening.then(() => true), proc.done.then(() => false), new Promise<false>((r) => setTimeout(() => r(false), LISTEN_TIMEOUT_MS))]);
  if (!up || !base) { await stop(); return cancelled ? cancelledTurn() : null; }
  const root = base as string;
  const dir = `?directory=${encodeURIComponent(input.cwd)}`;

  try {
    if (!sessionId) {
      const res = await fetch(`${root}/session${dir}`, { method: 'POST', headers: json, body: '{}', signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`session create ${res.status}`);
      sessionId = ((await res.json()) as { id?: string }).id ?? null;
      if (!sessionId) throw new Error('session create returned no id');
    }
    const events = await fetch(`${root}/event${dir}`, { signal: ac.signal });
    if (!events.ok || !events.body) throw new Error(`event stream ${events.status}`);
    const sid = sessionId;
    const translator = createOpenCodeServeTranslator({ resumed: built.resumed, sessionId: sid });
    let idle = false;
    const gate: { open: () => void } = { open: () => undefined };
    const ready = new Promise<void>((resolve) => { gate.open = resolve; });

    const pump = (async () => {
      try {
        for await (const data of sseData(events.body!)) {
          let evt: Record<string, unknown>;
          try { evt = JSON.parse(data) as Record<string, unknown>; } catch { continue; }
          if (evt['type'] === 'server.connected') { gate.open(); continue; }
          const step = translator.handle(evt);
          for (const ev of step.events) sink.onEvent({ ...ev, seq: nextSeq() });
          if (sink.onPartial) for (const p of step.partials) sink.onPartial(p);
          if (step.permission) {
            const allow = input.permission.mode === 'auto' || input.permission.mode === 'bypass';
            void fetch(`${root}/session/${encodeURIComponent(sid)}/permissions/${encodeURIComponent(step.permission.id)}${dir}`, { method: 'POST', headers: json, body: JSON.stringify({ response: allow ? 'once' : 'reject' }) }).catch(() => undefined);
          }
          if (step.idle) { idle = true; break; }
        }
      } catch { /* aborted, or the stream dropped: the outcome below says which */ }
    })();

    await Promise.race([ready, proc.done.then(() => undefined), new Promise<void>((r) => setTimeout(r, CONNECT_TIMEOUT_MS))]);
    const model = splitModel(input.model ?? (typeof input.options?.['model'] === 'string' ? (input.options['model'] as string) : null));
    const agent = typeof input.options?.['agent'] === 'string' ? (input.options['agent'] as string) : undefined;
    const variant = input.effort ?? (typeof input.options?.['effort'] === 'string' ? (input.options['effort'] as string) : undefined);
    const prompt = await fetch(`${root}/session/${encodeURIComponent(sid)}/prompt_async${dir}`, {
      method: 'POST', headers: json, signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
      body: JSON.stringify({ ...(model ? { model } : {}), ...(agent ? { agent } : {}), ...(variant ? { variant } : {}), parts: [{ type: 'text', text: input.prompt }] }),
    });
    if (!prompt.ok) throw new Error(`prompt_async ${prompt.status}`);

    await Promise.race([pump, proc.done]);
    const out = await stop();
    await pump;
    return {
      // A stream that ends after a `tool-calls` step with no error is a cut-off turn, not a crash: exit 0
      // lets `finishTurn` report it as `incomplete_turn` exactly as it does for `opencode run` (VS-573).
      outcome: { exitCode: idle || (!cancelled && !out.timedOut && !translator.state.isError && translator.state.lastStepReason === 'tool-calls') ? 0 : out.exitCode ?? 1, signal: idle ? null : out.signal, timedOut: out.timedOut, stderr: out.stderr },
      state: translator.state, sessionId: sid, finish: translator.finish, idle,
    };
  } catch {
    // Failed before the prompt was accepted: nothing ran, so `opencode run` can take the turn.
    await stop();
    return cancelled ? cancelledTurn() : null;
  }
}
