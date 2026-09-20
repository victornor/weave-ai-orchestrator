/**
 * Drives one Codex turn through `codex app-server` (VS-601), so text, reasoning, command output and a
 * running tool reach the page as they happen instead of when their item completes.
 *
 * Steps: spawn the server (same containment, cwd, env and `-c` overrides as `codex exec`), `initialize`,
 * start/resume/fork the thread, `turn/start`, then translate notifications (`app-server-events.ts`)
 * until `turn/completed`. Server-initiated approval requests are answered by permission mode. Cancel
 * sends `turn/interrupt` and then ends the process.
 *
 * A failure *before `turn/start` is accepted* returns `null` and the caller runs `codex exec --json`
 * instead. After that there is no fallback: the prompt is already running, so a second run would
 * execute it twice.
 */
import type { SpawnOutcome, TurnHandle, TurnInput, TurnSink } from '@weave-ai/runtime-sdk';
import { launchCommand, spawnLines } from '@weave-ai/runtime-sdk';
import type { CodexBuiltCommand } from './args.js';
import { answerServerRequest, createAppServerTranslator } from './app-server-events.js';
import type { CodexUsage } from './usage.js';

const HANDSHAKE_TIMEOUT_MS = 10_000;
const INTERRUPT_GRACE_MS = 3_000;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export interface AppServerTurn {
  outcome: Pick<SpawnOutcome, 'exitCode' | 'signal' | 'timedOut' | 'stderr'>;
  translator: ReturnType<typeof createAppServerTranslator>;
  threadId: string;
}

/** Every `-c key=value` pair `buildArgs` produced, so the server is configured exactly like an `exec` turn. */
export function configOverrides(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length - 1; i++) if (args[i] === '-c') out.push('-c', args[++i]!);
  return out;
}

/** Sandbox and approval policy per permission mode (the same postures `buildArgs` gives `exec`). */
export function postureFor(mode: TurnInput['permission']['mode']): { sandbox: string; approvalPolicy: string } {
  if (mode === 'bypass') return { sandbox: 'danger-full-access', approvalPolicy: 'never' };
  if (mode === 'restricted') return { sandbox: 'read-only', approvalPolicy: 'never' };
  return { sandbox: 'workspace-write', approvalPolicy: 'on-request' };
}

export async function runAppServerTurn(
  input: TurnInput,
  sink: TurnSink,
  onHandle: ((h: TurnHandle) => void) | undefined,
  built: CodexBuiltCommand,
  nextSeq: () => number,
  opts: { resumed: boolean; baseline?: CodexUsage | null; model: string | null },
): Promise<AppServerTurn | null> {
  const launch = launchCommand(built.cmd, built.env);
  const translator = createAppServerTranslator({ resumed: opts.resumed, baseline: opts.baseline });
  const pending = new Map<number, (m: Json) => void>();
  let nextId = 0;
  let cancelled = false;
  let turnId: string | null = null;
  let threadId: string | null = built.threadId;
  let finishedTurn: () => void = () => undefined;
  const turnDone = new Promise<void>((resolve) => { finishedTurn = resolve; });
  const mcpNames = Object.keys(input.mcpServers ?? {});
  const emit = (events: ReturnType<typeof translator.handle>['events']): void => { for (const ev of events) sink.onEvent({ ...ev, seq: nextSeq() }); };

  const proc = spawnLines({
    cmd: launch.cmd,
    args: ['app-server', ...configOverrides(built.args)],
    cwd: input.cwd,
    env: launch.env,
    stdin: null,
    stdinMode: 'open',
    timeoutMs: input.limits.timeoutMs,
    containment: input.containment,
    onSpawn: (pid) => sink.onSpawn({ pid, pgid: pid }),
    onLine: (stream, line) => {
      sink.onRaw(stream, line);
      if (stream !== 'stdout') return;
      let msg: Json | null;
      try { msg = obj(JSON.parse(line)); } catch { return; }
      if (!msg) return;
      const id = typeof msg['id'] === 'number' ? msg['id'] : null;
      const method = str(msg['method']);
      if (id !== null && method) {
        // A server-initiated request: nobody is there to answer it, so the mode does.
        const reply = answerServerRequest(method, obj(msg['params']) ?? {}, input.permission.mode, mcpNames);
        proc.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...reply })}\n`);
        return;
      }
      if (id !== null) { pending.get(id)?.(msg); pending.delete(id); return; }
      const step = translator.handle(msg);
      emit(step.events);
      if (sink.onPartial) for (const p of step.partials) sink.onPartial(p);
      if (translator.finished) finishedTurn();
    },
  });
  /** `onReply` runs synchronously when the reply line arrives, before any notification behind it is read. */
  const request = (method: string, params: Json, timeoutMs = HANDSHAKE_TIMEOUT_MS, onReply?: (m: Json) => void): Promise<Json | null> => {
    const id = ++nextId;
    const answered = new Promise<Json | null>((resolve) => { pending.set(id, (m) => { onReply?.(m); resolve(m); }); });
    proc.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return Promise.race([answered, proc.done.then(() => null), new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))]);
  };

  const stop = async (): Promise<SpawnOutcome> => { await proc.cancel('kill'); return proc.done; };
  onHandle?.({
    pid: proc.child.pid ?? null,
    cancel: async (mode) => {
      cancelled = true;
      if (mode === 'interrupt' && threadId && turnId) {
        await Promise.race([request('turn/interrupt', { threadId, turnId }, INTERRUPT_GRACE_MS), turnDone]);
        await Promise.race([turnDone, new Promise<void>((r) => setTimeout(r, INTERRUPT_GRACE_MS))]);
      }
      await proc.cancel(mode);
    },
  });
  /** Ended before the turn was under way: falling back to `exec` would start the turn again. */
  const cancelledTurn = async (): Promise<AppServerTurn> => {
    const out = await stop();
    return { outcome: { exitCode: null, signal: out.signal ?? 'SIGTERM', timedOut: out.timedOut, stderr: out.stderr }, translator, threadId: threadId ?? '' };
  };

  const init = await request('initialize', { clientInfo: { name: 'weave-ai', version: '1' } });
  if (!init || init['error']) { if (cancelled) return cancelledTurn(); await stop(); return null; }
  proc.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} })}\n`);

  const posture = postureFor(input.permission.mode);
  const common: Json = {
    cwd: input.cwd, ...(opts.model ? { model: opts.model } : {}),
    sandbox: posture.sandbox, approvalPolicy: posture.approvalPolicy,
  };
  const threadReq = built.mode === 'resume'
    ? request('thread/resume', { threadId: built.threadId, excludeTurns: true, ...common })
    : built.mode === 'fork'
      ? request('thread/fork', { threadId: built.threadId, excludeTurns: true, ...common })
      : request('thread/start', common);
  const thread = await threadReq;
  const startedId = str(obj(obj(thread?.['result'])?.['thread'])?.['id']);
  if (!thread || thread['error'] || !startedId) { if (cancelled) return cancelledTurn(); await stop(); return null; }
  threadId = startedId;
  emit(translator.threadStarted(startedId));

  const turn = await request('turn/start', {
    threadId: startedId,
    input: [{ type: 'text', text: input.prompt, text_elements: [] }],
    ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
  }, HANDSHAKE_TIMEOUT_MS, (m) => {
    // Notifications can follow the reply in the same read, so the turn id must be set right here.
    const id = str(obj(obj(m['result'])?.['turn'])?.['id']);
    if (id) { turnId = id; translator.setTurn(id); }
  });
  const startedTurn = str(obj(obj(turn?.['result'])?.['turn'])?.['id']);
  if (!turn || turn['error'] || !startedTurn) {
    // Not accepted: nothing ran, so `exec` can take the turn. (A timeout here is ambiguous only if the
    // server did accept it; the process is killed either way, so at most the prompt is never delivered twice.)
    if (cancelled) return cancelledTurn();
    await stop();
    return null;
  }

  await Promise.race([turnDone, proc.done]);
  const out = await stop();
  return { outcome: { exitCode: translator.finished ? 0 : out.exitCode, signal: translator.finished ? null : out.signal, timedOut: out.timedOut, stderr: out.stderr }, translator, threadId: startedId };
}
