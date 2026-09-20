import type { RuntimeEvent } from '@weave-ai/runtime-sdk';
import { truncate } from '@weave-ai/runtime-sdk';
import { parseTestSummary } from '@weave-ai/shared';

export interface OpenCodeParseState {
  sessionId: string | null;
  finalText: string | null;
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number } | null;
  /**
   * VS-462: the first `step_finish`'s request split into fresh (input + cache.write) and cached
   * (cache.read) tokens. A turn that re-sends its whole conversation uncached shows up here. Null
   * when the stream reported no `tokens` object.
   */
  firstRequest: { freshTokens: number; cachedTokens: number } | null;
  /**
   * Size of the last `step_finish` request: input + cache.write + cache.read. The `usage`
   * totals above sum every step and are not a context size. Null when the stream reported
   * no `tokens` object.
   */
  contextTokens: number | null;
  costUsd: number | null;
  isError: boolean;
  errorMessage: string | null;
  /**
   * VS-573: `part.reason` of the last `step_finish`. `tool-calls` means the model asked for another
   * step; a stream that ends there was cut off (opencode swallows the provider error and exits 0).
   */
  lastStepReason: string | null;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const SHELL_TOOLS = new Set(['bash', 'shell']);
const EDIT_TOOLS = new Set(['edit', 'write', 'patch', 'multiedit']);

/**
 * Stream parser for `opencode run --format json`.
 * Verified against opencode 1.18.27: every line is `{type, timestamp, sessionID, part}`
 * with part kinds `step-start`, `text`, `tool`, `step-finish`; errors carry `error` instead.
 * OpenCode emits no terminal event, so `finish()` closes the turn.
 *
 * VS-454: OpenCode compacts sessions, but `run --format json` carries no signal for it. Its only
 * serialized events are `tool_use` / `step_start` / `step_finish` / `text` / `reasoning` / `error`
 * (read from the installed binary's run command), its `session.status` is `idle | retry | busy`
 * (no compacting state), and the compaction events it does have — `session.compacted` and the v2
 * `session.next.compaction.started` / `.ended` — are the bus/TUI protocol, never written by `run`.
 * So this parser emits no `session.compaction.*` event; a compaction-shaped line falls through to
 * `runtime.raw`, which is the honest record that something arrived we do not model.
 */
export function createOpenCodeParser(opts: { resumed: boolean } = { resumed: false }) {
  const state: OpenCodeParseState = { sessionId: null, finalText: null, usage: null, firstRequest: null, contextTokens: null, costUsd: null, isError: false, errorMessage: null, lastStepReason: null };
  const textByMessage = new Map<string, string[]>();
  let lastMessageId: string | null = null;
  let announced = false;
  let tokens = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  let sawTokens = false;

  function handle(line: string): RuntimeEvent[] {
    let msg: Json | null;
    try { msg = obj(JSON.parse(line)); } catch { return [raw('unparseable', { line: truncate(line, 2000) })]; }
    if (!msg) return [];
    const ts = tsOf(msg);
    const out: RuntimeEvent[] = [];
    const sid = str(msg['sessionID']);
    if (sid && !state.sessionId) {
      state.sessionId = sid;
      announced = true;
      out.push({ ts, type: opts.resumed ? 'session.resumed' : 'session.started', payload: { sessionId: sid } });
    }
    const part = obj(msg['part']);
    switch (str(msg['type'])) {
      case 'step_start':
        out.push({ ts, type: 'turn.started', payload: { messageId: str(part?.['messageID']) } });
        break;
      case 'text': {
        const text = str(part?.['text']) ?? '';
        const mid = str(part?.['messageID']) ?? '';
        if (text) {
          lastMessageId = mid;
          const acc = textByMessage.get(mid) ?? [];
          acc.push(text);
          textByMessage.set(mid, acc);
          out.push({ ts, type: 'assistant.text', payload: { text, messageId: mid, ...(str(part?.['id']) ? { partId: str(part?.['id']) } : {}) } });
        }
        break;
      }
      case 'reasoning': {
        const think = str(part?.['text']) ?? '';
        if (think) out.push({ ts, type: 'assistant.thinking', payload: { text: truncate(think, 2000), redacted: think.length > 2000, ...(str(part?.['id']) ? { partId: str(part?.['id']) } : {}) } });
        break;
      }
      case 'tool_use':
        out.push(...tool(part, ts));
        break;
      case 'step_finish': {
        state.lastStepReason = str(part?.['reason']);
        const t = obj(part?.['tokens']);
        if (t) {
          const cache = obj(t['cache']);
          const input = num(t['input']) ?? 0;
          const write = num(cache?.['write']) ?? 0;
          const read = num(cache?.['read']) ?? 0;
          // VS-462: remember only the first step's request, before the running total folds it in.
          if (state.firstRequest == null) state.firstRequest = { freshTokens: input + write, cachedTokens: read };
          sawTokens = true;
          tokens = {
            inputTokens: tokens.inputTokens + input,
            outputTokens: tokens.outputTokens + (num(t['output']) ?? 0),
            cachedInputTokens: tokens.cachedInputTokens + read,
          };
          state.usage = { ...tokens };
          state.contextTokens = input + write + read;
          out.push({ ts, type: 'usage.delta', payload: { ...tokens, basis: 'per_turn', reason: str(part?.['reason']) } });
        }
        const cost = num(part?.['cost']);
        if (cost != null) state.costUsd = (state.costUsd ?? 0) + cost;
        break;
      }
      case 'error': {
        state.isError = true;
        const err = obj(msg['error']);
        state.errorMessage = str(obj(err?.['data'])?.['message']) ?? str(err?.['name']) ?? 'opencode error';
        out.push({ ts, type: 'error', payload: { name: str(err?.['name']), message: truncate(state.errorMessage, 2000) } });
        break;
      }
      default:
        out.push(raw(str(msg['type']) ?? 'unknown', msg, ts));
    }
    return out;
  }

  function tool(part: Json | null, ts: string): RuntimeEvent[] {
    if (!part) return [];
    return toolEvents(part, ts, true);
  }

  /** OpenCode's stream just ends; call this once the process has exited. */
  function finish(): RuntimeEvent[] {
    const texts = lastMessageId ? textByMessage.get(lastMessageId) ?? [] : [];
    state.finalText = texts.length > 0 ? texts.join('') : null;
    if (!sawTokens) state.usage = null;
    return [{ ts: new Date().toISOString(), type: 'turn.completed', payload: { sessionId: state.sessionId, failed: state.isError } }];
  }

  function tsOf(msg: Json): string {
    const t = num(msg['timestamp']);
    return t != null ? new Date(t).toISOString() : new Date().toISOString();
  }
  function raw(originalType: string, payload: unknown, ts = new Date().toISOString()): RuntimeEvent {
    return { ts, type: 'runtime.raw', payload: { originalType, data: payload } };
  }

  return { state, handle, finish, get sessionAnnounced() { return announced; } };
}

/**
 * The events for one opencode `tool` part: `tool.call` (when `withCall`), and — once the part is
 * `completed` or `error` — `tool.result` plus the shell/edit events derived from it. Shared by the
 * `run --format json` parser (which sees a finished part only) and the server driver (which sees the
 * call when it starts and the result when it ends).
 */
export function toolEvents(part: Json, ts: string, withCall: boolean): RuntimeEvent[] {
  const name = str(part['tool']) ?? 'unknown';
  const id = str(part['callID']) ?? str(part['id']) ?? '';
  const st = obj(part['state']);
  const status = str(st?.['status']) ?? 'unknown';
  const out: RuntimeEvent[] = withCall ? [{ ts, type: 'tool.call', payload: { id, name, input: st?.['input'], title: str(st?.['title']), ...(str(part['id']) ? { partId: str(part['id']) } : {}) } }] : [];
  if (status === 'completed' || status === 'error') {
    const output = str(st?.['output']) ?? '';
    const isError = status === 'error';
    out.push({ ts, type: 'tool.result', payload: { id, name, status, isError, content: truncate(output) } });
    if (SHELL_TOOLS.has(name)) {
      const meta = obj(st?.['metadata']);
      // VS-328: read the test tally from the whole output, before it is size-bounded.
      const tests = parseTestSummary(output);
      out.push({ ts, type: 'command.executed', payload: { id, command: str(obj(st?.['input'])?.['command']), exitCode: num(meta?.['exit']), output: truncate(output), isError, ...(tests ? { tests } : {}) } });
    }
    if (EDIT_TOOLS.has(name)) {
      const path = str(obj(st?.['input'])?.['filePath'] ?? obj(st?.['input'])?.['file_path'] ?? obj(st?.['input'])?.['path']);
      if (path) out.push({ ts, type: 'file.changed', payload: { id, path, tool: name } });
    }
  }
  return out;
}

/**
 * A provider error opencode logged for one session. Its `run` CLI retries such an error silently —
 * the failure never appears on stdout, so the stream parser above cannot see it (VS-461). The only
 * account is opencode's own log line:
 *
 *   timestamp=… level=ERROR run=… message="stream error" providerID=deepseek modelID=deepseek-flash
 *   session.id=ses_… small=false agent=build mode=primary error.error.message="We were unable to
 *   start processing your request within the 900-second timeout limit. Please try again later."
 */
export interface OpenCodeProviderError {
  sessionId: string;
  provider: string | null;
  model: string | null;
  message: string;
}

const FIELD = (name: string): RegExp => new RegExp(`(?:^|\\s)${name.replace('.', '\\.')}=(\\S+)`);
const QUOTED = (name: string): RegExp => new RegExp(`(?:^|\\s)${name.replace(/\./g, '\\.')}="((?:[^"\\\\]|\\\\.)*)"`);

/**
 * The last provider error in `text` logged for `sessionId`, or null. Only level-ERROR `stream error`
 * lines count; a line for another session (concurrent turns share one log) is ignored. `sessionId`
 * null returns null rather than guessing, so one worker's error is never attributed to another's run.
 */
export function parseOpenCodeProviderErrors(text: string, sessionId: string | null): OpenCodeProviderError | null {
  if (!sessionId) return null;
  let found: OpenCodeProviderError | null = null;
  for (const line of text.split('\n')) {
    if (!line.includes('level=ERROR') || !line.includes('message="stream error"')) continue;
    const sid = FIELD('session.id').exec(line)?.[1] ?? null;
    if (sid !== sessionId) continue;
    const message = QUOTED('error.error.message').exec(line)?.[1]?.replace(/\\"/g, '"') ?? null;
    if (!message) continue;
    found = { sessionId, provider: FIELD('providerID').exec(line)?.[1] ?? null, model: FIELD('modelID').exec(line)?.[1] ?? null, message };
  }
  return found;
}
