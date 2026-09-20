/**
 * Translator for `codex app-server` notifications (VS-601): the second producer of the normalized
 * `RuntimeEvent`s, next to the `codex exec --json` parser.
 *
 * Completed items are rewritten into the `exec --json` item shapes and fed to the existing parser,
 * so persisted events, the final text and usage accounting are identical on both paths. What this
 * adds is the live part: `tool.call` when an item starts, `RuntimePartial` frames for deltas, and a
 * `tool.result` that closes a command or file change (exec has none for them). Frame shapes were
 * read from recorded traffic (`test/fixtures/app-server-*.jsonl`), not from the schema alone.
 */
import type { RuntimeEvent, RuntimePartial } from '@weave-ai/runtime-sdk';
import type { PermissionMode } from '@weave-ai/shared';
import { truncate } from '@weave-ai/runtime-sdk';
import { createCodexParser } from './events.js';
import type { CodexUsage } from './usage.js';

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export interface AppServerStep { events: RuntimeEvent[]; partials: RuntimePartial[] }

/** A `commandExecution` / `fileChange` / `mcpToolCall` item is a tool; its output partials are `<id>:out`. */
const outPartId = (itemId: string): string => `${itemId}:out`;

/** The `exec --json` item an app-server `ThreadItem` corresponds to, or null when it has none. */
function execItem(it: Json): Json | null {
  const id = str(it['id']) ?? '';
  switch (str(it['type'])) {
    case 'agentMessage': return { type: 'agent_message', id, text: str(it['text']) ?? '' };
    case 'reasoning': {
      const parts = [...(Array.isArray(it['content']) ? it['content'] : []), ...(Array.isArray(it['summary']) ? it['summary'] : [])];
      return { type: 'reasoning', id, text: parts.filter((p): p is string => typeof p === 'string').join('\n') };
    }
    case 'commandExecution':
      return { type: 'command_execution', id, command: str(it['command']), aggregated_output: str(it['aggregatedOutput']) ?? '', exit_code: num(it['exitCode']), status: str(it['status']) };
    case 'fileChange': {
      const changes = (Array.isArray(it['changes']) ? it['changes'] : []).map((c) => {
        const ch = obj(c) ?? {};
        return { path: str(ch['path']), kind: obj(ch['kind'])?.['type'] ?? ch['kind'], diff: str(ch['diff']) };
      });
      return { type: 'file_change', id, changes, status: str(it['status']) };
    }
    case 'mcpToolCall':
      return { type: 'mcp_tool_call', id, server: str(it['server']), tool: str(it['tool']), arguments: it['arguments'], status: str(it['status']), result: it['result'], error: it['error'] };
    case 'plan': return { type: 'todo_list', id, items: [{ text: str(it['text']) ?? '', completed: false }] };
    default: return null;
  }
}

/** Failure statuses a finished tool item can carry. */
const FAILED = new Set(['failed', 'declined']);

export function createAppServerTranslator(opts: { resumed: boolean; baseline?: CodexUsage | null }) {
  const parser = createCodexParser(opts);
  let turnId: string | null = null;
  let usage: { total: CodexUsage; last: CodexUsage | null } | null = null;
  let done = false;
  let ended = false;
  const started = new Set<string>();

  const feed = (msg: Json): RuntimeEvent[] => parser.handle(JSON.stringify(msg));
  const asUsage = (v: unknown): CodexUsage | null => {
    const u = obj(v);
    return u ? { inputTokens: num(u['inputTokens']) ?? 0, outputTokens: num(u['outputTokens']) ?? 0, cachedInputTokens: num(u['cachedInputTokens']) ?? 0 } : null;
  };
  /** The exec parser names an item's id `id`; the engine supersedes a partial by `partId`. */
  const withPartId = (ev: RuntimeEvent): RuntimeEvent => {
    const id = ev.payload['id'];
    if ((ev.type === 'assistant.text' || ev.type === 'assistant.thinking') && typeof id === 'string') return { ...ev, payload: { ...ev.payload, partId: id } };
    return ev;
  };

  function toolStart(it: Json, ts: string): RuntimeEvent[] {
    const id = str(it['id']) ?? '';
    if (!id || started.has(id)) return [];
    switch (str(it['type'])) {
      case 'commandExecution':
        started.add(id);
        return [{ ts, type: 'tool.call', payload: { id, name: 'command', input: { command: str(it['command']), cwd: str(it['cwd']) } } }];
      case 'fileChange': {
        started.add(id);
        const changes = (Array.isArray(it['changes']) ? it['changes'] : []).map((c) => str(obj(c)?.['path'])).filter((p): p is string => Boolean(p));
        return [{ ts, type: 'tool.call', payload: { id, name: 'file_change', input: { paths: changes } } }];
      }
      case 'mcpToolCall':
        started.add(id);
        return feed({ type: 'item.started', item: execItem(it) });
      default: return [];
    }
  }

  function toolResult(it: Json, ts: string): RuntimeEvent[] {
    const id = str(it['id']) ?? '';
    const type = str(it['type']);
    if (type !== 'commandExecution' && type !== 'fileChange') return [];
    const status = str(it['status']);
    const exit = num(it['exitCode']);
    return [{
      ts, type: 'tool.result',
      payload: { id, partId: outPartId(id), status, isError: (status !== null && FAILED.has(status)) || (exit !== null && exit !== 0), content: truncate(str(it['aggregatedOutput']) ?? '') },
    }];
  }

  function handle(msg: Json): AppServerStep {
    const step: AppServerStep = { events: [], partials: [] };
    const method = str(msg['method']);
    const p = obj(msg['params']) ?? {};
    if (!method) return step;
    const ts = new Date().toISOString();
    // A resumed thread replays earlier turns' notifications; only ours count.
    const foreign = str(p['turnId']) !== null && turnId !== null && p['turnId'] !== turnId;
    if (foreign || (str(p['turnId']) !== null && turnId === null)) return step;

    switch (method) {
      case 'turn/started': step.events.push(...feed({ type: 'turn.started' })); break;
      case 'item/started': {
        const it = obj(p['item']);
        if (it) step.events.push(...toolStart(it, ts));
        break;
      }
      case 'item/completed': {
        const it = obj(p['item']);
        if (!it) break;
        const kind = str(it['type']);
        if (kind === 'userMessage' || kind === 'hookPrompt' || kind === 'functionCallOutput') break;
        // A tool that completes without an `item/started` (a replayed or very fast item) still shows a call.
        step.events.push(...toolStart(it, ts));
        const mapped = execItem(it);
        const raw = mapped ? feed({ type: 'item.completed', item: mapped }) : [{ ts, type: 'runtime.raw' as const, payload: { originalType: `item.${kind ?? 'unknown'}`, data: it } }];
        // The exec parser's `mcp_tool_call` completion already carries the `tool.result`.
        const result = kind === 'commandExecution' || kind === 'fileChange' ? toolResult(it, ts) : [];
        const before = raw.filter((e) => e.type === 'tool.result' || e.type === 'tool.call');
        step.events.push(...before, ...result, ...raw.filter((e) => !before.includes(e)).map(withPartId));
        break;
      }
      case 'item/agentMessage/delta': {
        const id = str(p['itemId']); const text = str(p['delta']);
        if (id && text) step.partials.push({ kind: 'text', partId: id, text });
        break;
      }
      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta': {
        const id = str(p['itemId']); const text = str(p['delta']);
        if (id && text) step.partials.push({ kind: 'thinking', partId: id, text });
        break;
      }
      case 'item/commandExecution/outputDelta':
      case 'item/fileChange/outputDelta':
      case 'item/mcpToolCall/progress': {
        const id = str(p['itemId']); const text = str(p['delta']) ?? str(p['message']);
        if (id && text) step.partials.push({ kind: 'tool_input', partId: outPartId(id), toolCallId: id, text });
        break;
      }
      case 'thread/tokenUsage/updated': {
        const u = obj(p['tokenUsage']);
        const total = asUsage(u?.['total']);
        if (total) usage = { total, last: asUsage(u?.['last']) };
        break;
      }
      case 'error': {
        // `willRetry` is the server retrying a request, not a failed turn.
        if (p['willRetry'] === true) break;
        step.events.push(...feed({ type: 'error', message: str(obj(p['error'])?.['message']) ?? 'codex error' }));
        break;
      }
      case 'turn/completed': {
        const turn = obj(p['turn']);
        const status = str(turn?.['status']);
        done = true;
        if (status === 'failed' || status === 'interrupted') {
          const message = str(obj(turn?.['error'])?.['message']) ?? (status === 'interrupted' ? 'codex turn interrupted' : 'codex turn failed');
          step.events.push(...feed({ type: 'turn.failed', error: { message } }));
        } else {
          step.events.push(...feed({
            type: 'turn.completed',
            ...(usage ? { usage: { input_tokens: usage.total.inputTokens, output_tokens: usage.total.outputTokens, cached_input_tokens: usage.total.cachedInputTokens ?? 0 } } : {}),
          }));
        }
        ended = true;
        break;
      }
      case 'warning':
      case 'model/rerouted':
        step.events.push({ ts, type: 'runtime.raw', payload: { originalType: method, data: p } });
        break;
      default: break; // status, rate-limit, startup and similar chatter: not worth an events row
    }
    step.events = step.events.map((e) => (e.type === 'runtime.raw' ? e : withPartId(e)));
    return step;
  }

  return {
    state: parser.state,
    /** The thread this turn runs on; emits the same `thread.started` an exec turn opens with. */
    threadStarted(threadId: string): RuntimeEvent[] { return feed({ type: 'thread.started', thread_id: threadId }); },
    setTurn(id: string): void { turnId = id; },
    /** True once `turn/completed` arrived for our turn. */
    get finished(): boolean { return ended; },
    get sawCompletion(): boolean { return done; },
    /** Size of the thread's last request, from the latest usage notification. */
    get lastUsage(): CodexUsage | null { return usage?.last ?? null; },
    handle,
  };
}

/**
 * The reply to a server-initiated request, decided by permission mode, because nobody is there to
 * answer. `exec` runs headless too: an escalation outside the sandbox is declined, and the run's own
 * MCP servers stay reachable (`bypass` accepts everything, as `--dangerously-bypass-approvals-and-sandbox`
 * does). Anything unrecognised gets an error response: a request left unanswered hangs the turn.
 */
export function answerServerRequest(method: string, params: Json, mode: PermissionMode, mcpServers: readonly string[]): { result: unknown } | { error: { code: number; message: string } } {
  const bypass = mode === 'bypass';
  switch (method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
      return { result: { decision: bypass ? 'accept' : 'decline' } };
    case 'applyPatchApproval':
    case 'execCommandApproval':
      return { result: { decision: bypass ? 'approved' : 'denied' } };
    case 'mcpServer/elicitation/request': {
      const server = str(params['serverName']);
      const allow = bypass || (mode === 'auto' && server !== null && mcpServers.includes(server));
      return { result: { action: allow ? 'accept' : 'decline', content: null } };
    }
    default:
      return { error: { code: -32601, message: `weave-ai cannot answer ${method} in a headless turn` } };
  }
}
