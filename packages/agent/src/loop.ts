import { buildRequest, classifyHttp, parseArgs, StreamReducer, type StepResult } from './codec/chatCompletions.js';
import { McpHttpClient } from './mcp/http.js';
import { chatCompletionsUrl, requestHeaders, requestOptions, shellEnv } from './profile.js';
import type { ChildEvent, ChildPartial, ChildResult, InitMessage } from './protocol.js';
import { Session } from './session.js';
import { SseParser } from './sse.js';
import { bashTool } from './tools/bash.js';
import { errorOutput, toolSpecs, type ToolDefinition } from './tools/index.js';
import { readTool } from './tools/read.js';
import type { AgentError, ContentBlock, Message, Usage } from './types.js';

export interface LoopIO {
  emit(ev: ChildEvent): void;
  partial(p: ChildPartial): void;
  log(level: 'debug' | 'info' | 'warn' | 'error', msg: string, fields?: Record<string, unknown>): void;
}
export interface LoopDeps { fetch?: typeof fetch; sleep?: (ms: number, signal: AbortSignal) => Promise<void>; idleTimeoutMs?: number; partialFlushMs?: number }

export const INTERRUPTED = '[Tool execution was interrupted]';
export const WEAVE_MCP_SERVER = 'weave-ai';
const DEFAULT_STEP_CAP = 200;
const MAX_RETRIES = 2;
const DEADLINE_MARGIN_MS = 30_000;
const PREAMBLE = [
  'You are Weave Agent, a coding agent working in a git worktree through tools.',
  'Use `read` to look at files and directories and `bash` to run commands; paths may be relative to the worktree.',
  'Tool results are capped: when a result says it was truncated, page with `read` offset or open the named output file.',
  'Work step by step, check your results, and say plainly what you did and what is left.',
].join('\n');

class StepFailure extends Error { constructor(readonly err: AgentError) { super(err.message); } }
class Cancelled extends Error {}
/** A 400 naming `stream_options`: the endpoint rejects the usage option, so the request is re-sent without it. */
class DropStreamOptions extends Error {}

const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal.aborted) return reject(new Cancelled());
  const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = (): void => { clearTimeout(t); reject(new Cancelled()); };
  signal.addEventListener('abort', onAbort, { once: true });
});

/** Coalesces partial deltas: at most one message per part per flush window. */
class PartialBatcher {
  private pending = new Map<string, ChildPartial>();
  private timer: NodeJS.Timeout | null = null;
  constructor(private send: (p: ChildPartial) => void, private windowMs: number) {}
  add(p: ChildPartial): void {
    const cur = this.pending.get(p.partId);
    if (cur) cur.text += p.text; else this.pending.set(p.partId, { ...p });
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.windowMs);
  }
  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const p of all) this.send(p);
  }
}

export async function runAgentTurn(init: InitMessage, io: LoopIO, signal: AbortSignal, deps: LoopDeps = {}): Promise<ChildResult> {
  const f = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const { run, provider } = init;
  const started = Date.now();
  const now = (): string => new Date().toISOString();
  const emit = (type: string, payload: Record<string, unknown>): void => io.emit({ ts: now(), type, payload });
  const batch = new PartialBatcher((p) => io.partial(p), deps.partialFlushMs ?? 25);
  const session = Session.open({ path: init.session.path, id: init.session.id, cwd: run.cwd });
  const opts = requestOptions(run.options);
  const wtCwd = run.worktree?.path ?? run.cwd;
  const env = shellEnv(init.toolEnv, provider.apiKey);
  const isFirst = session.messages.length === 0;
  const tokens = { prompt: 0, completion: 0, cached: 0 };
  let firstRequest: { freshTokens: number; cachedTokens: number } | undefined;
  let contextTokens: number | undefined;
  let model: string | undefined;
  let finalText: string | null = null;
  let steps = 0;
  const mcpClients: McpHttpClient[] = [];
  /** Cleared for the rest of the run once an endpoint rejects `stream_options`. */
  let sendStreamOptions = true;
  /** The step being streamed, so a cancel can persist the text seen so far. */
  let inFlightReducer: StreamReducer | null = null;

  const result = (over: Partial<ChildResult>): ChildResult => ({
    exitCode: 0, signal: null, timedOut: false, session: session.ref(), finalText,
    ...(tokens.prompt + tokens.completion > 0 ? { usage: { inputTokens: tokens.prompt - tokens.cached, outputTokens: tokens.completion, cachedInputTokens: tokens.cached, ...(contextTokens !== undefined ? { contextTokens } : {}), basis: 'per_turn' as const, ...(firstRequest ? { firstRequest } : {}) } } : {}),
    ...(model ? { model } : {}), provider: provider.id, ...over,
  });
  const finish = (r: ChildResult, failed: boolean, interrupted = false): ChildResult => {
    batch.flush();
    emit('turn.completed', { sessionId: session.id, failed, ...(interrupted ? { interrupted: true } : {}) });
    session.close();
    return r;
  };

  try {
    // Tools: core `read`/`bash` plus every MCP tool. A `restricted` turn gets no shell.
    const tools = new Map<string, ToolDefinition>();
    const core = run.permission.mode === 'restricted' ? [readTool] : [readTool, bashTool];
    for (const t of core) tools.set(t.name, t);
    try {
      for (const [server, cfg] of Object.entries(init.mcpServers)) {
        const client = new McpHttpClient({ url: cfg.url, ...(cfg.headers ? { headers: cfg.headers } : {}), ...(deps.fetch ? { fetch: deps.fetch } : {}) });
        try {
          await client.initialize(signal);
          for (const t of await client.listTools(signal)) {
            const name = server === WEAVE_MCP_SERVER ? t.name : `mcp__${server}__${t.name}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
            tools.set(name, { name, description: t.description, parameters: t.inputSchema, readOnly: t.readOnly, run: async (args, ctx) => { const r = await client.callTool(t.name, args, ctx.signal); return { text: r.text, isError: r.isError }; } });
          }
          mcpClients.push(client);
        } catch (e) {
          if (signal.aborted) throw new Cancelled();
          if (server === WEAVE_MCP_SERVER) throw new StepFailure({ code: 'mcp_unavailable', family: 'tooling', message: `The Weave tool server is unreachable: ${(e as Error).message}` });
          io.log('warn', `MCP server ${server} skipped`, { error: (e as Error).message });
        }
      }
    } catch (e) { if (e instanceof StepFailure) { emit('error', { code: e.err.code, family: e.err.family, message: e.err.message }); return finish(result({ exitCode: 1, error: e.err }), true); } throw e; }
    applyPermissionFilter(tools, run.permission);

    const system = [PREAMBLE, init.systemPrompt.mode === 'inject' ? init.systemPrompt.text : ''].filter(Boolean).join('\n\n');
    session.append({ role: 'user', text: isFirst ? `${envBlock(run.cwd, wtCwd, run.worktree?.branch)}\n\n${init.prompt}` : init.prompt });

    const stepCap = run.limits.maxTurns ?? DEFAULT_STEP_CAP;
    const deadline = started + Math.max(0, run.limits.timeoutMs - DEADLINE_MARGIN_MS);
    for (;;) {
      if (signal.aborted) throw new Cancelled();
      if (run.limits.timeoutMs > 0 && Date.now() >= deadline) return finish(result({ exitCode: 1, timedOut: true }), true);
      if (steps >= stepCap) {
        const err: AgentError = { code: 'max_steps', family: 'resource', message: `Stopped after ${stepCap} steps.` };
        emit('error', { ...err });
        return finish(result({ exitCode: 1, error: err }), true);
      }
      steps++;
      const messageId = `${run.runId}:${steps}`;
      emit('turn.started', { messageId });
      const body = buildRequest({ model: run.model, system, messages: session.messages, tools: toolSpecs([...tools.values()]), options: opts });
      const step = await streamStep(body);
      inFlightReducer = null;
      if (step.model) model = step.model;
      const usage = step.usage ?? await estimateUsage(body, step);
      tokens.prompt += usage.promptTokens; tokens.completion += usage.completionTokens; tokens.cached += usage.cachedTokens;
      contextTokens = usage.promptTokens;
      firstRequest ??= { freshTokens: usage.promptTokens - usage.cachedTokens, cachedTokens: usage.cachedTokens };
      batch.flush();
      const content: ContentBlock[] = [];
      if (step.thinking) { content.push({ type: 'thinking', text: step.thinking }); emit('assistant.thinking', { text: step.thinking.slice(0, 2000), redacted: step.thinking.length > 2000, partId: `${messageId}:k` }); }
      if (step.text) { content.push({ type: 'text', text: step.text }); emit('assistant.text', { text: step.text, messageId, partId: `${messageId}:t` }); }
      const parsed = step.calls.map((c) => ({ c, args: parseArgs(c.argsText) }));
      for (const { c, args } of parsed) content.push({ type: 'toolCall', id: c.id, name: c.name, args: args.ok ? args.value : {}, raw: c.argsText });
      session.append({ role: 'assistant', content, ...(step.model ? { model: step.model } : {}) });
      emit('usage.delta', { inputTokens: tokens.prompt - tokens.cached, outputTokens: tokens.completion, cachedInputTokens: tokens.cached, basis: 'per_turn', reason: step.finishReason, estimated: usage.estimated });
      if (step.error) throw new StepFailure(classifyStreamError(step.error));
      if (parsed.length === 0) { finalText = step.text || null; return finish(result({}), false); }

      const done = new Set<string>();
      try {
        for (const { c, args } of parsed) {
          if (signal.aborted) throw new Cancelled();
          emit('tool.call', { id: c.id, name: c.name, input: args.ok ? args.value : c.argsText, partId: c.id });
          const tool = tools.get(c.name);
          let out = tool === undefined ? errorOutput(`unknown tool "${c.name}". Available: ${[...tools.keys()].join(', ')}`)
            : !args.ok ? errorOutput(`arguments for ${c.name} are not valid JSON (${args.error}); send one JSON object`)
            : await tool.run(args.value as Record<string, unknown>, { cwd: wtCwd, env, signal, callId: c.id, spillDir: run.spillDir }).catch((e: unknown) => errorOutput((e as Error).message));
          if (out.text.length === 0) out = { ...out, text: '(no output)' };
          session.append({ role: 'toolResult', toolCallId: c.id, name: c.name, text: out.text, isError: out.isError === true });
          done.add(c.id);
          emit('tool.result', { id: c.id, name: c.name, status: out.isError ? 'error' : 'completed', isError: out.isError === true, content: out.text.slice(0, 20_000) });
          if (c.name === 'bash') emit('command.executed', { id: c.id, command: out.meta?.command, exitCode: out.meta?.exitCode ?? null, output: out.text.slice(0, 20_000), isError: out.isError === true });
        }
      } finally {
        // Whatever ended the loop early, the persisted history keeps every call paired with a result.
        for (const { c } of parsed) if (!done.has(c.id)) session.append({ role: 'toolResult', toolCallId: c.id, name: c.name, text: INTERRUPTED, isError: true });
      }
    }

    // ---- one model request, with retry before any content is committed ----
    async function streamStep(body: Record<string, unknown>): Promise<StepResult> {
      for (let attempt = 0; ; attempt++) {
        if (!sendStreamOptions) delete body['stream_options'];
        try { return await requestOnce(body); } catch (e) {
          if (signal.aborted || e instanceof Cancelled) throw new Cancelled();
          if (e instanceof DropStreamOptions) { io.log('info', 'endpoint rejected stream_options; retrying without it'); attempt--; continue; }
          const err = e instanceof StepFailure ? e.err : { code: 'network', family: 'transient_upstream' as const, message: (e as Error).message };
          if (err.family !== 'transient_upstream' || attempt >= MAX_RETRIES) throw new StepFailure(err);
          const delay = err.retryAfterMs ?? Math.min(30_000, 2000 * 2 ** attempt) * (1 + Math.random() * 0.25);
          io.log('warn', 'provider request failed; retrying', { attempt: attempt + 1, code: err.code, delayMs: Math.round(delay) });
          await sleep(delay, signal);
        }
      }
    }
    async function requestOnce(body: Record<string, unknown>): Promise<StepResult> {
      const stepCtl = new AbortController();
      const onAbort = (): void => stepCtl.abort();
      signal.addEventListener('abort', onAbort, { once: true });
      const idleMs = deps.idleTimeoutMs ?? 120_000;
      let idle: NodeJS.Timeout | undefined;
      const armIdle = (): void => { if (idle) clearTimeout(idle); idle = setTimeout(() => stepCtl.abort(new Error(`no data from the provider for ${Math.round(idleMs / 1000)}s`)), idleMs); };
      const messageId = `${run.runId}:${steps}`;
      const reducer = new StreamReducer({
        onText: (d) => batch.add({ kind: 'text', partId: `${messageId}:t`, messageId, text: d }),
        onThinking: (d) => batch.add({ kind: 'thinking', partId: `${messageId}:k`, messageId, text: d }),
        onToolInput: (id, d) => batch.add({ kind: 'tool_input', partId: id, toolCallId: id, messageId, text: d }),
      }, `call_${run.runId.slice(-6)}_${steps}`);
      inFlightReducer = reducer;
      try {
        armIdle();
        const res = await f(chatCompletionsUrl(provider.baseUrl), { method: 'POST', headers: requestHeaders(provider), body: JSON.stringify(body), signal: stepCtl.signal });
        if (!res.ok) {
          const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
          const errBody = await res.text();
          if (res.status === 400 && sendStreamOptions && /stream_options/i.test(errBody)) { sendStreamOptions = false; throw new DropStreamOptions(); }
          throw new StepFailure(classifyHttp(res.status, errBody, retryAfter));
        }
        if (!res.body) throw new StepFailure({ code: 'upstream_error', family: 'transient_upstream', message: 'provider returned no body' });
        const parser = new SseParser();
        const reader = res.body.getReader();
        const handle = (events: Array<{ data: string }>): void => { for (const e of events) { if (e.data === '[DONE]') continue; try { reducer.push(JSON.parse(e.data)); } catch { io.log('debug', 'unparseable SSE data ignored'); } } };
        for (;;) {
          armIdle();
          const { done, value } = await reader.read();
          if (value) handle(parser.feed(value));
          if (done) { handle(parser.end()); break; }
        }
        const r = reducer.result();
        if (!r.finishReason && r.calls.length === 0 && !r.text && !r.error) throw new StepFailure({ code: 'network', family: 'transient_upstream', message: 'stream ended before any content' });
        return r;
      } catch (e) {
        if (signal.aborted) throw new Cancelled();
        if (e instanceof StepFailure || e instanceof DropStreamOptions) throw e;
        throw new StepFailure({ code: 'network', family: 'transient_upstream', message: stepCtl.signal.reason instanceof Error ? stepCtl.signal.reason.message : (e as Error).message });
      } finally { if (idle) clearTimeout(idle); signal.removeEventListener('abort', onAbort); }
    }
  } catch (e) {
    if (e instanceof Cancelled || signal.aborted) {
      // Text already streamed is kept: the model's last words are part of the history.
      const seen = (inFlightReducer as StreamReducer | null)?.result();
      if (seen?.text) session.append({ role: 'assistant', content: [{ type: 'text', text: seen.text }] });
      return finish(result({ exitCode: 143, signal: 'SIGTERM' }), false, true);
    }
    if (e instanceof StepFailure) {
      emit('error', { code: e.err.code, family: e.err.family, message: e.err.message, ...(e.err.status ? { status: e.err.status } : {}) });
      return finish(result({ exitCode: 1, error: e.err }), true);
    }
    io.log('error', 'agent loop crashed', { error: (e as Error).stack ?? String(e) });
    const err: AgentError = { code: 'agent_crashed', family: 'unknown', message: (e as Error).message };
    emit('error', { ...err });
    return finish(result({ exitCode: 1, error: err }), true);
  }
}

function classifyStreamError(e: NonNullable<StepResult['error']>): AgentError {
  const s = `${e.message} ${e.code ?? ''} ${e.type ?? ''}`.toLowerCase();
  if (/insufficient|quota|balance|billing/.test(s)) return { code: 'quota_exhausted', family: 'provider_quota', message: e.message };
  if (/rate.?limit|overload|timeout|unavailable|server_error|5\d\d/.test(s)) return { code: 'upstream_error', family: 'transient_upstream', message: e.message };
  if (/auth|api key|unauthor/.test(s)) return { code: 'auth_failed', family: 'auth', message: e.message };
  return { code: 'provider_error', family: 'unknown', message: e.message };
}

function parseRetryAfter(v: string | null): number | undefined {
  if (!v) return undefined;
  const secs = Number(v);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(v);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/** The tokenizer is loaded only when a provider reports no usage, so a normal turn never pays for it. */
async function estimateUsage(body: Record<string, unknown>, step: StepResult): Promise<Usage> {
  const { estimateTokens } = await import('@weave-ai/shared');
  const out = step.text + step.thinking + step.calls.map((c) => c.name + c.argsText).join('');
  return { promptTokens: estimateTokens(JSON.stringify(body['messages'])), completionTokens: estimateTokens(out), cachedTokens: 0, reasoningTokens: 0, estimated: true };
}

function envBlock(home: string, cwd: string, branch: string | undefined): string {
  return `<env>\ndate: ${new Date().toISOString().slice(0, 10)}\nworktree: ${cwd}\nagent home: ${home}\nplatform: ${process.platform}${branch ? `\nbranch: ${branch}` : ''}\n</env>`;
}

/** `allowedTools` is exhaustive when set on an interactive first turn; `deniedTools` always removes. Names match case-insensitively. */
function applyPermissionFilter(tools: Map<string, ToolDefinition>, p: InitMessage['run']['permission']): void {
  const lower = (l: string[]): Set<string> => new Set(l.map((s) => s.toLowerCase()));
  if (p.deniedTools?.length) { const d = lower(p.deniedTools); for (const n of [...tools.keys()]) if (d.has(n.toLowerCase())) tools.delete(n); }
  if (p.firstTurn && p.allowedTools?.length) { const a = lower(p.allowedTools); for (const n of [...tools.keys()]) if (!a.has(n.toLowerCase())) tools.delete(n); }
}
