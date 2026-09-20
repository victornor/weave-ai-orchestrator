import { completeCompat } from './codec/params.js';
import { compact, compactionThreshold, NOTHING_TO_SUMMARISE, SUMMARY_MAX_OUTPUT_TOKENS, type CompactOutcome } from './compaction.js';
import { InstructionLoader } from './instructions.js';
import { pruneMessages } from './prune.js';
import { loadSkills, skillIndex, skillTool } from './skills.js';
import { RequestSizer } from './tokens.js';
import { buildRequest, StreamReducer, type StepResult } from './codec/chatCompletions.js';
import { DoomGuard } from './doom.js';
import { classifyFinish, classifyHttp, classifyNetwork, classifyStreamError, stopError } from './errors.js';
import { invalidToolMessage, repairArgs } from './repair.js';
import { parseRetryAfter, planRetry } from './retry.js';
import { WireLog } from './wire.js';
import { createMcpClient, type McpClient, type McpTool } from './mcp/client.js';
import { assignMcpToolNames } from './mcp/naming.js';
import { bashDenial, isAllowedByLists, modeToolNames, toolDenial, type PermissionConfig } from './permission.js';
import { dirname, join, resolve } from 'node:path';
import { chatCompletionsUrl, requestHeaders, requestOptions, shellEnv } from './profile.js';
import type { ChildEvent, ChildPartial, ChildResult, InitMessage } from './protocol.js';
import { retentionDays, sweepSessions } from './retention.js';
import { Session } from './session.js';
import { SseParser } from './sse.js';
import { bashTool } from './tools/bash.js';
import { editTool } from './tools/edit.js';
import { rgAvailable, grepTool } from './tools/grep.js';
import { globTool } from './tools/glob.js';
import { errorOutput, toolSpecs, type ToolCtx, type ToolDefinition } from './tools/index.js';
import { ReadLedger } from './tools/ledger.js';
import { readTool } from './tools/read.js';
import { makeWebFetchTool } from './tools/webFetch.js';
import { writeTool } from './tools/write.js';
import type { AgentError, ContentBlock, Message, Usage } from './types.js';

export interface LoopIO {
  emit(ev: ChildEvent): void;
  partial(p: ChildPartial): void;
  log(level: 'debug' | 'info' | 'warn' | 'error', msg: string, fields?: Record<string, unknown>): void;
}
export interface LoopDeps { fetch?: typeof fetch; sleep?: (ms: number, signal: AbortSignal) => Promise<void>; idleTimeoutMs?: number; connectTimeoutMs?: number; requestTimeoutMs?: number; partialFlushMs?: number; now?: () => number; random?: () => number }

export const INTERRUPTED = '[Tool execution was interrupted]';
export const WEAVE_MCP_SERVER = 'weave-ai';
const DEFAULT_STEP_CAP = 200;
const DEFAULT_CONNECT_MS = 30_000;
const DEFAULT_IDLE_MS = 120_000;
/** Below the supervisor's 15 minute silence window, so one long request cannot look like a hang. */
const DEFAULT_REQUEST_MS = 600_000;
const MAX_INVALID_CALLS = 3;
const CONTINUE_PROMPT = 'Your previous reply was cut off by the output limit. Continue exactly where you stopped.';
const DEADLINE_MARGIN_MS = 30_000;
export const PREAMBLE = [
  'You are Weave Agent, a coding agent working in a git worktree through tools.',
  'Use `read` to look at files and directories, `grep` and `glob` to search, `edit` and `write` to change files, and `bash` to run commands; paths may be relative to the worktree.',
  'Read a file before you edit or overwrite it; `edit` needs an `old_string` that matches exactly once.',
  'Tool results are capped: when a result says it was truncated, page with `read` offset or open the named output file. An older result may be replaced by a note that it was pruned: run the call again if you still need it.',
  'A directory may have its own AGENTS.md: it is appended to the first result from that directory. Follow it.',
  'The conversation may begin with a summary of earlier work; treat it as what happened.',
  'Work step by step, check your results, and say plainly what you did and what is left.',
].join('\n');

class StepFailure extends Error { constructor(readonly err: AgentError) { super(err.message); } }
class Cancelled extends Error {}
class TimeoutFailure extends Error {}
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
  const nowMs = deps.now ?? Date.now;
  const started = nowMs();
  const now = (): string => new Date().toISOString();
  const emit = (type: string, payload: Record<string, unknown>): void => io.emit({ ts: now(), type, payload });
  const batch = new PartialBatcher((p) => io.partial(p), deps.partialFlushMs ?? 25);
  const session = Session.open({ path: init.session.path, id: init.session.id, cwd: run.cwd });
  const opts = provider.params ?? requestOptions(run.options);
  const compat = completeCompat(provider.compat);
  const wtCwd = run.worktree?.path ?? run.cwd;
  const env = shellEnv(init.toolEnv, provider.apiKey);
  const permissionCfg: PermissionConfig = {
    mode: run.permission.mode,
    ...(run.permission.allowedTools ? { allowedTools: run.permission.allowedTools } : {}),
    ...(run.permission.deniedTools ? { deniedTools: run.permission.deniedTools } : {}),
    ...(run.permission.firstTurn ? { firstTurn: true } : {}),
    ...(run.permission.bashDeny ? { bashDeny: run.permission.bashDeny } : {}),
  };
  // Sessions unused for the retention period are dropped from the shared sessions directory.
  const swept = sweepSessions(dirname(session.path), session.path, retentionDays(run.options));
  if (swept.length > 0) io.log('info', 'removed expired sessions', { count: swept.length });
  const isFirst = session.messages.length === 0;
  const tokens = { prompt: 0, completion: 0, cached: 0 };
  let firstRequest: { freshTokens: number; cachedTokens: number } | undefined;
  let contextTokens: number | undefined;
  let model: string | undefined;
  let finalText: string | null = null;
  let steps = 0;
  const mcpClients: McpClient[] = [];
  /** Cleared for the rest of the run once an endpoint rejects `stream_options`. */
  let sendStreamOptions = true;
  /** The step being streamed, so a cancel can persist the text seen so far. */
  let inFlightReducer: StreamReducer | null = null;
  const warned = new Set<string>();
  const doom = new DoomGuard();
  let invalidStreak = 0;
  let lengthHits = 0;
  const maxTurnTokens = typeof run.options['maxTurnTokens'] === 'number' && run.options['maxTurnTokens'] > 0 ? Math.floor(run.options['maxTurnTokens']) : undefined;
  const sizer = new RequestSizer();
  const window = opts.contextWindowTokens;
  const wire = run.options['debugWire'] === true ? new WireLog(join(dirname(run.spillDir), 'wire'), [provider.apiKey, ...Object.values(init.toolEnv)]) : null;

  const result = (over: Partial<ChildResult>): ChildResult => ({
    exitCode: 0, signal: null, timedOut: false, session: session.ref(), finalText,
    ...(tokens.prompt + tokens.completion > 0 ? { usage: { inputTokens: tokens.prompt - tokens.cached, outputTokens: tokens.completion, cachedInputTokens: tokens.cached, ...(contextTokens !== undefined ? { contextTokens } : {}), basis: 'per_turn' as const, ...(firstRequest ? { firstRequest } : {}) } } : {}),
    ...(model ? { model } : {}), provider: provider.id, ...over,
  });
  const finish = (r: ChildResult, failed: boolean, interrupted = false): ChildResult => {
    batch.flush();
    emit('turn.completed', { sessionId: session.id, failed, ...(interrupted ? { interrupted: true } : {}) });
    session.close();
    // SIGTERM is issued synchronously inside close(); a stdio server must not outlive the turn.
    for (const c of mcpClients) void c.close();
    return r;
  };

  try {
    // Tools: the six core tools plus every MCP tool. The mode removes the write-capable core tools
    // from the request itself; `all` keeps every tool so a call the mode removed is answered with a
    // permission denial rather than "unknown tool".
    const webFetchEnabled = run.options['webFetch'] === true;
    const skills = loadSkills(run.cwd);
    const instructions = new InstructionLoader(wtCwd);
    instructions.pin(join(run.cwd, 'AGENTS.md'));
    const system = [PREAMBLE, init.systemPrompt.mode === 'inject' ? init.systemPrompt.text : '', skillIndex(skills)].filter(Boolean).join('\n\n');
    if (init.mode === 'compact') {
      // Out-of-band compaction (the adapter's `compactSession`): no prompt, no tools, one summary and done.
      const out = await runCompaction('manual', []);
      const noop = !out.ok && out.reason === NOTHING_TO_SUMMARISE;
      if (out.ok || noop) return finish(result({ exitCode: 0, compaction: { ok: out.ok, ...(out.tokensBefore !== undefined ? { tokensBefore: out.tokensBefore } : {}), ...(out.tokensAfter !== undefined ? { tokensAfter: out.tokensAfter } : {}), ...(out.reason ? { reason: out.reason } : {}) } }), false);
      const err: AgentError = { code: 'compaction_failed', family: 'tooling', message: `The conversation could not be compacted: ${out.reason ?? 'unknown'}` };
      emit('error', { code: err.code, family: err.family, message: err.message });
      return finish(result({ exitCode: 1, error: err }), true);
    }
    const coreByName: Record<string, ToolDefinition> = { read: readTool, write: writeTool, edit: editTool, bash: bashTool, grep: grepTool, glob: globTool };
    if (webFetchEnabled) coreByName['web_fetch'] = makeWebFetchTool();
    const modeNames = new Set<string>(modeToolNames(run.permission.mode));
    const coreNames = new Set([...Object.keys(coreByName), 'web_fetch']);
    const all = new Map<string, ToolDefinition>(Object.entries(coreByName));
    const clientsByServer = new Map<string, McpClient>();
    const toolsByServer = new Map<string, McpTool[]>();
    // VS-621: which wire names belong to a user server, and whether that server is declared read-only.
    const userMcpWire = new Map<string, boolean>();
    // A stdio MCP server gets an explicit, minimal environment: the plain base the shell tools start
    // from (PATH/HOME/LANG/TMPDIR/USER/TERM), never the ambient process env and never the turn's role
    // secrets, which ride in `init.toolEnv`. The server's own `env` is added on top of this base.
    const mcpBaseEnv: Record<string, string> = { TERM: 'dumb' };
    for (const k of ['PATH', 'HOME', 'LANG', 'TMPDIR', 'USER']) { const v = init.toolEnv[k]; if (v !== undefined) mcpBaseEnv[k] = v; }
    try {
      // The Weave server first: its names are unprefixed and must be in the namespace before any
      // other server's names can be assigned.
      const entries = Object.entries(init.mcpServers);
      const ordered = [...entries.filter(([s]) => s === WEAVE_MCP_SERVER), ...entries.filter(([s]) => s !== WEAVE_MCP_SERVER)];
      for (const [server, cfg] of ordered) {
        try {
          const client = createMcpClient(server, cfg, {
            ...(deps.fetch ? { fetch: deps.fetch } : {}),
            env: mcpBaseEnv,
            onStderr: (line) => io.log('debug', `[mcp:${server}] ${line}`),
          });
          mcpClients.push(client);
          await client.initialize(signal);
          const listed = await client.listTools(signal);
          clientsByServer.set(server, client);
          toolsByServer.set(server, listed);
        } catch (e) {
          if (signal.aborted) throw new Cancelled();
          if (server === WEAVE_MCP_SERVER) throw new StepFailure({ code: 'mcp_unavailable', family: 'tooling', message: `The Weave tool server is unreachable: ${(e as Error).message}` });
          io.log('warn', `MCP server ${server} skipped`, { error: (e as Error).message });
        }
      }
      const nameMap = assignMcpToolNames([...toolsByServer].map(([server, tools]) => ({ server, tools: tools.map((t) => t.name) })), new Set<string>(), WEAVE_MCP_SERVER);
      // `restricted` keeps a user server's tools only when the human marked it read-only; the run-scoped
      // Weave server's tools stay, as they already are gated by the run token and the first-turn list.
      for (const [name, ref] of nameMap) {
        const client = clientsByServer.get(ref.server)!;
        const meta = toolsByServer.get(ref.server)!.find((t) => t.name === ref.tool)!;
        if (ref.server !== WEAVE_MCP_SERVER) userMcpWire.set(name, init.mcpServers[ref.server]?.readOnly === true);
        all.set(name, {
          name, description: meta.description, parameters: meta.inputSchema, readOnly: meta.readOnly,
          run: async (args, ctx) => { const r = await client.callTool(ref.tool, args, ctx.signal); return { text: r.text, isError: r.isError, ...(r.images ? { images: r.images } : {}) }; },
        });
      }
    } catch (e) { if (e instanceof StepFailure) { emit('error', { code: e.err.code, family: e.err.family, message: e.err.message }); return finish(result({ exitCode: 1, error: e.err }), true); } throw e; }
    if (skills.length > 0) all.set('skill', skillTool(skills));
    const tools = new Map<string, ToolDefinition>();
    const restrictedDropsMcp = (name: string): boolean => run.permission.mode === 'restricted' && userMcpWire.has(name) && userMcpWire.get(name) !== true;
    for (const [name, tool] of all) {
      if (coreNames.has(name) && !modeNames.has(name)) continue;
      if (restrictedDropsMcp(name)) continue;
      if (!isAllowedByLists(name, permissionCfg)) continue;
      tools.set(name, tool);
    }
    const modeAllows = (name: string): boolean => restrictedDropsMcp(name) ? false : (!coreNames.has(name) || modeNames.has(name));
    const toolList = toolSpecs([...tools.values()]);
    const ledger = new ReadLedger();
    instructions.syncFrom(session.context());
    const rg = rgAvailable();
    if (!rg) io.log('info', 'ripgrep is not on PATH; using the built-in search');

    session.append({ role: 'user', text: isFirst ? `${envBlock(run.cwd, wtCwd, run.worktree?.branch)}\n\n${init.prompt}` : init.prompt });

    const stepCap = run.limits.maxTurns ?? DEFAULT_STEP_CAP;
    const deadline = started + Math.max(0, run.limits.timeoutMs - DEADLINE_MARGIN_MS);
    for (;;) {
      if (signal.aborted) throw new Cancelled();
      if (run.limits.timeoutMs > 0 && nowMs() >= deadline) return finish(result({ exitCode: 1, timedOut: true }), true);
      if (steps >= stepCap) {
        const err = stopError.maxSteps(stepCap);
        emit('error', { code: err.code, family: err.family, message: err.message });
        return finish(result({ exitCode: 1, error: err }), true);
      }
      if (maxTurnTokens !== undefined && tokens.prompt + tokens.completion >= maxTurnTokens) {
        const err = stopError.budget(tokens.prompt + tokens.completion, maxTurnTokens);
        emit('error', { code: err.code, family: err.family, message: err.message });
        return finish(result({ exitCode: 1, error: err }), true);
      }
      steps++;
      const messageId = `${run.runId}:${steps}`;
      emit('turn.started', { messageId });
      if (window === undefined) {
        if (!warned.has('window')) { warned.add('window'); io.log('warn', 'the context window is unknown, so the session is only compacted when the provider reports an overflow; set contextWindowTokens on the model or the provider'); }
      } else if (sizer.estimate({ system, tools: toolList, messages: session.context() }) > compactionThreshold(window, opts.maxOutputTokens)) {
        await runCompaction('proactive', toolList);
      }
      let overflowRetried = false;
      let sent = 0;
      let step: StepResult;
      let body: Record<string, unknown>;
      for (;;) {
        const whole = session.context();
        // Above 70 % of the window the oldest tool output is replaced by a stub in this request only.
        const context = pruneMessages(whole, { estimate: sizer.estimate({ system, tools: toolList, messages: whole }), window });
        sent = context.length;
        const reqWarnings: string[] = [];
        body = buildRequest({ model: run.model, system, messages: context, tools: toolList, options: opts, compat, effort: run.effort, warnings: reqWarnings, cacheKey: init.session.id });
        for (const w of reqWarnings.splice(0)) if (!warned.has(w)) { warned.add(w); io.log('warn', w); }
        try { step = await streamStep(body); break; } catch (e) {
          // The provider says the request was too big: summarise and send it once more, then let the error stand.
          if (!overflowRetried && e instanceof StepFailure && e.err.code === 'context_overflow') { overflowRetried = true; if ((await runCompaction('overflow', toolList)).ok) continue; }
          throw e;
        }
      }
      inFlightReducer = null;
      if (step.model) model = step.model;
      const usage = step.usage ?? await estimateUsage(body, step);
      tokens.prompt += usage.promptTokens; tokens.completion += usage.completionTokens; tokens.cached += usage.cachedTokens;
      contextTokens = usage.promptTokens;
      if (!usage.estimated) sizer.observe(usage.promptTokens, sent);
      firstRequest ??= { freshTokens: usage.promptTokens - usage.cachedTokens, cachedTokens: usage.cachedTokens };
      batch.flush();
      const content: ContentBlock[] = [];
      if (step.thinking) { content.push({ type: 'thinking', text: step.thinking }); emit('assistant.thinking', { text: step.thinking.slice(0, 2000), redacted: step.thinking.length > 2000, partId: `${messageId}:k` }); }
      if (step.text) { content.push({ type: 'text', text: step.text }); emit('assistant.text', { text: step.text, messageId, partId: `${messageId}:t` }); }
      // A reply cut off by the output limit is never repaired by closing it: half a `content` would run as if complete.
      const parsed = step.calls.map((c) => ({ c, args: repairArgs(c.argsText, { closeTorn: step.finishReason !== 'length' }) }));
      for (const { c, args } of parsed) content.push({ type: 'toolCall', id: c.id, name: c.name, args: args.ok ? args.value : {}, raw: c.argsText });
      session.append({ role: 'assistant', content, ...(step.model ? { model: step.model } : {}) });
      emit('usage.delta', { inputTokens: tokens.prompt - tokens.cached, outputTokens: tokens.completion, cachedInputTokens: tokens.cached, basis: 'per_turn', reason: step.finishReason, estimated: usage.estimated });
      const stopped = classifyFinish(step.finishReason, step.refusal);
      if (stopped) throw new StepFailure(stopped);
      if (parsed.length === 0) {
        if (step.finishReason === 'length') {
          // The cap was spent: one continuation, and a second truncation (or nothing but reasoning) fails the turn.
          if (++lengthHits >= 2 || !step.text) throw new StepFailure(stopError.truncated());
          io.log('warn', 'reply hit the output limit; asking the model to continue');
          session.append({ role: 'user', text: CONTINUE_PROMPT });
          continue;
        }
        finalText = step.text || null; return finish(result({}), false);
      }

      const done = new Set<string>();
      let stopFailure: AgentError | null = null;
      try {
        for (const { c, args } of parsed) {
          if (signal.aborted) throw new Cancelled();
          emit('tool.call', { id: c.id, name: c.name, input: args.ok ? args.value : c.argsText, partId: c.id });
          const tool = tools.get(c.name);
          const toolCtx: ToolCtx = { cwd: wtCwd, home: run.cwd, configHome: run.configHome, mode: run.permission.mode, imageInput: compat.image.input, env, signal, callId: c.id, spillDir: run.spillDir, ledger, rg, emit: (type, payload) => emit(type, { id: c.id, ...payload }) };
          const key = args.ok ? DoomGuard.key(c.name, args.value) : '';
          const verdict = args.ok && tool ? doom.check(key) : 'ok';
          if (verdict === 'stop') stopFailure = stopError.doom(c.name);
          let out: Awaited<ReturnType<ToolDefinition['run']>>;
          let denied = false;
          if (stopFailure) {
            out = errorOutput(`stopped: repeating ${c.name}`);
          } else if (tool === undefined) {
            const d = all.has(c.name) ? toolDenial(c.name, permissionCfg, modeAllows) : null;
            if (d) { denied = true; emit('tool.denied', { id: c.id, name: c.name, reason: d.reason }); out = { text: d.text, isError: true }; }
            else if (c.name === 'web_fetch' && !modeAllows('web_fetch')) {
              const wedge = toolDenial('web_fetch', permissionCfg, modeAllows)!;
              denied = true; emit('tool.denied', { id: c.id, name: 'web_fetch', reason: wedge.reason }); out = { text: wedge.text, isError: true };
            } else if (c.name === 'web_fetch') {
              out = errorOutput('web_fetch is disabled; enable it with the webFetch option');
            } else out = errorOutput(`unknown tool "${c.name}". Available: ${[...tools.keys()].join(', ')}`);
          } else if (!args.ok) {
            out = errorOutput(invalidToolMessage(c.name, args.error));
          } else if (verdict === 'warn') {
            out = errorOutput(`you have made this exact ${c.name} call three times with the same result. Change the arguments or take a different approach`);
          } else if (c.name === 'bash' && typeof args.value['command'] === 'string') {
            const d = bashDenial(args.value['command'], permissionCfg);
            if (d) { denied = true; emit('tool.denied', { id: c.id, name: c.name, reason: d.reason }); out = { text: d.text, isError: true }; }
            else out = await tool.run(args.value, toolCtx).catch((e: unknown) => errorOutput((e as Error).message));
          } else {
            out = await tool.run(args.value, toolCtx).catch((e: unknown) => errorOutput((e as Error).message));
          }
          // A denied call is a permission answer, not a malformed one; only unknown tools and bad arguments count as invalid.
          invalidStreak = (tool === undefined && !denied) || !args.ok ? invalidStreak + 1 : 0;
          // The first read or edit in a directory brings that directory's AGENTS.md along, once.
          if (tool && args.ok && !out.isError && (c.name === 'read' || c.name === 'edit' || c.name === 'write') && typeof args.value['path'] === 'string') {
            const extra = instructions.forPath(resolve(wtCwd, args.value['path']));
            if (extra) out = { ...out, text: out.text + extra };
          }
          if (out.text.length === 0) out = { ...out, text: '(no output)' };
          if (tool && args.ok && verdict === 'ok' && !stopFailure) doom.record(key, out.text);
          const images = compat.image.input === 'none' ? [] : (out.images ?? []);
          const embed = compat.image.input === 'user_and_tool';
          session.append({ role: 'toolResult', toolCallId: c.id, name: c.name, text: out.text, isError: out.isError === true, ...(embed && images.length > 0 ? { images } : {}) });
          if (!embed && images.length > 0) session.append({ role: 'user', text: `[image from ${c.name}]`, images });
          done.add(c.id);
          if (!denied) emit('tool.result', { id: c.id, name: c.name, status: out.isError ? 'error' : 'completed', isError: out.isError === true, content: out.text.slice(0, 20_000) });
        }
      } finally {
        // Whatever ended the loop early, the persisted history keeps every call paired with a result.
        for (const { c } of parsed) if (!done.has(c.id)) session.append({ role: 'toolResult', toolCallId: c.id, name: c.name, text: INTERRUPTED, isError: true });
      }
      if (stopFailure) throw new StepFailure(stopFailure);
      if (invalidStreak >= MAX_INVALID_CALLS) throw new StepFailure(stopError.invalidCalls(invalidStreak));
    }

    // ---- one model request, retried on the ladder before any result is committed ----
    async function runCompaction(trigger: 'proactive' | 'overflow' | 'manual', specs: ReturnType<typeof toolSpecs>): Promise<CompactOutcome> {
      emit('session.compaction.started', { trigger });
      const out = await compact({ session, window, complete, log: (level, msg, fields) => io.log(level, msg, fields) });
      if (!out.ok) { io.log('info', 'compaction skipped', { trigger, why: out.reason }); emit('session.compaction.completed', { trigger, ok: false }); return out; }
      sizer.reset();
      instructions.syncFrom(session.context());
      emit('session.compaction.completed', { trigger, ok: true, tokensBefore: out.tokensBefore, tokensAfter: out.tokensAfter, postTokens: sizer.estimate({ system, tools: specs, messages: session.context() }) });
      return out;
    }
    /** One summary request through the run's own provider: no tools, no sampling extras, output capped, and none of it shown as the agent's reply. */
    async function complete(sys: string, user: string): Promise<string> {
      const { toolChoice: _tc, parallelToolCalls: _pt, stop: _st, responseFormat: _rf, ...rest } = opts;
      const body = buildRequest({ model: run.model, system: sys, messages: [{ role: 'user', text: user }], tools: [], options: { ...rest, maxOutputTokens: Math.min(opts.maxOutputTokens ?? SUMMARY_MAX_OUTPUT_TOKENS, SUMMARY_MAX_OUTPUT_TOKENS) }, compat, effort: null });
      const r = await streamStep(body, true);
      if (r.usage) { tokens.prompt += r.usage.promptTokens; tokens.completion += r.usage.completionTokens; tokens.cached += r.usage.cachedTokens; }
      if (!r.text.trim()) throw new Error('the model returned no summary');
      return r.text;
    }
    async function streamStep(body: Record<string, unknown>, quiet = false): Promise<StepResult> {
      for (let attempt = 0; ; attempt++) {
        if (!sendStreamOptions) delete body['stream_options'];
        try { return await requestOnce(body, quiet); } catch (e) {
          if (signal.aborted || e instanceof Cancelled) throw new Cancelled();
          if (e instanceof DropStreamOptions) { io.log('info', 'endpoint rejected stream_options; retrying without it'); attempt--; continue; }
          const err = e instanceof StepFailure ? e.err : classifyNetwork(e);
          const plan = planRetry(err, attempt, { deadlineAt: run.limits.timeoutMs > 0 ? deadline : undefined, nowMs: nowMs(), ...(deps.random ? { random: deps.random } : {}) });
          if (!plan.retry) throw new StepFailure(err);
          io.log('warn', 'provider request failed; retrying', { attempt: attempt + 1, code: err.code, delayMs: plan.delayMs });
          wire?.error(`${err.code}: ${err.message}`);
          await sleep(plan.delayMs, signal);
        }
      }
    }
    async function requestOnce(body: Record<string, unknown>, quiet: boolean): Promise<StepResult> {
      const stepCtl = new AbortController();
      const onAbort = (): void => stepCtl.abort();
      signal.addEventListener('abort', onAbort, { once: true });
      const idleMs = deps.idleTimeoutMs ?? provider.timeouts?.idleMs ?? DEFAULT_IDLE_MS;
      const connectMs = deps.connectTimeoutMs ?? provider.timeouts?.connectMs ?? DEFAULT_CONNECT_MS;
      const requestMs = deps.requestTimeoutMs ?? provider.timeouts?.requestMs ?? DEFAULT_REQUEST_MS;
      const cutoff = (what: string, ms: number): void => stepCtl.abort(new TimeoutFailure(`${what}: no ${what === 'connect timeout' ? 'response' : 'data'} from the provider for ${Math.round(ms / 1000)}s`));
      let phase: NodeJS.Timeout | undefined;
      // Connect covers the wait for headers; idle covers every gap after, so any bytes at all, an SSE comment included, reset it.
      const arm = (what: string, ms: number): void => { if (phase) clearTimeout(phase); phase = setTimeout(() => cutoff(what, ms), ms); };
      const whole = setTimeout(() => cutoff('request timeout', requestMs), requestMs);
      const messageId = `${run.runId}:${steps}`;
      const reducer = new StreamReducer(quiet ? {} : {
        onText: (d) => batch.add({ kind: 'text', partId: `${messageId}:t`, messageId, text: d }),
        onThinking: (d) => batch.add({ kind: 'thinking', partId: `${messageId}:k`, messageId, text: d }),
        onToolInput: (id, d) => batch.add({ kind: 'tool_input', partId: id, toolCallId: id, messageId, text: d }),
      }, `call_${run.runId.slice(-6)}_${steps}`, { reasoningField: compat.reasoning.field, cachedTokensField: compat.cachedTokensField });
      if (!quiet) inFlightReducer = reducer;
      try {
        const url = chatCompletionsUrl(provider.baseUrl, provider.query);
        const headers = requestHeaders(provider);
        wire?.request(url, headers, body);
        arm('connect timeout', connectMs);
        const res = await f(url, { method: 'POST', headers, body: JSON.stringify(body), signal: stepCtl.signal });
        wire?.head(res.status, res.headers);
        arm('idle timeout', idleMs);
        if (!res.ok) {
          const retryAfter = parseRetryAfter(res.headers.get('retry-after'), nowMs());
          const errBody = await res.text();
          wire?.chunk(new TextEncoder().encode(errBody));
          if (res.status === 400 && sendStreamOptions && /stream_options/i.test(errBody)) { sendStreamOptions = false; throw new DropStreamOptions(); }
          throw new StepFailure(classifyHttp(res.status, errBody, retryAfter));
        }
        if (!res.body) throw new StepFailure({ code: 'upstream_error', family: 'transient_upstream', message: 'provider returned no body' });
        const parser = new SseParser();
        const reader = res.body.getReader();
        let sawDone = false;
        const handle = (events: Array<{ event?: string; data: string }>): void => {
          for (const e of events) {
            if (e.data.trim() === '[DONE]') { sawDone = true; continue; }
            let json: unknown;
            try { json = JSON.parse(e.data); } catch { io.log('debug', 'unparseable SSE data ignored'); continue; }
            // An `event: error` frame carries the error object bare or wrapped.
            if (e.event === 'error' && typeof json === 'object' && json !== null && !('error' in json)) json = { error: json };
            reducer.push(json);
          }
        };
        for (;;) {
          const { done, value } = await reader.read();
          arm('idle timeout', idleMs);
          if (value) { wire?.chunk(value); handle(parser.feed(value)); }
          if (done) { handle(parser.end()); break; }
        }
        const r = reducer.result();
        if (r.error) throw new StepFailure(classifyStreamError(r.error));
        // A stream that ended with no finish reason and no [DONE] was cut, whatever it had sent so far.
        if (!r.finishReason && !sawDone) throw new StepFailure({ code: 'network', family: 'transient_upstream', message: r.text || r.calls.length > 0 ? 'stream ended before the reply was finished' : 'stream ended before any content' });
        return r;
      } catch (e) {
        if (signal.aborted) throw new Cancelled();
        if (e instanceof StepFailure || e instanceof DropStreamOptions) throw e;
        const reason: unknown = stepCtl.signal.reason;
        if (reason instanceof TimeoutFailure) throw new StepFailure({ code: 'timeout', family: 'transient_upstream', message: reason.message });
        throw new StepFailure(classifyNetwork(e));
      } finally { if (phase) clearTimeout(phase); clearTimeout(whole); signal.removeEventListener('abort', onAbort); }
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

/** The tokenizer is loaded only when a provider reports no usage, so a normal turn never pays for it. */
async function estimateUsage(body: Record<string, unknown>, step: StepResult): Promise<Usage> {
  const { estimateTokens } = await import('@weave-ai/shared');
  const out = step.text + step.thinking + step.calls.map((c) => c.name + c.argsText).join('');
  return { promptTokens: estimateTokens(JSON.stringify(body['messages'])), completionTokens: estimateTokens(out), cachedTokens: 0, reasoningTokens: 0, estimated: true };
}

function envBlock(home: string, cwd: string, branch: string | undefined): string {
  return `<env>\ndate: ${new Date().toISOString().slice(0, 10)}\nworktree: ${cwd}\nagent home: ${home}\nplatform: ${process.platform}${branch ? `\nbranch: ${branch}` : ''}\n</env>`;
}
