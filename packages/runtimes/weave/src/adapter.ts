import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { agentEntryPath, forkSessionFile, headersWithExtras, listProviderModels, loadPreset, resolveProvider, type ChildResult } from '@weave-ai/agent';
import { childEnv, installBundleFiles, spawnLines, type AgentHome, type CompactSessionInput, type CompactSessionResult, type InstructionBundle, type JsonSchema, type RuntimeAdapter, type RuntimeCapabilities, type RuntimeDetection, type RuntimeEvent, type RuntimeHost, type RuntimeModel, type SessionRef, type TurnHandle, type TurnInput, type TurnResult, type TurnSink } from '@weave-ai/runtime-sdk';
import type { ProviderProfile } from '@weave-ai/shared';
import { buildCompactInit, buildInit, childBaseEnv, layoutFor, splitModel, toolEnvFor } from './child.js';
import { parseChildLine } from './events.js';
import { Semaphore } from './semaphore.js';

export const capabilities: RuntimeCapabilities = {
  resumableSessions: true, forkSessions: true, streamingInput: true, systemPromptInjection: 'system_prompt',
  structuredOutput: true, mcp: true, usageReporting: 'per_turn', costReporting: false, permissionModes: ['auto', 'restricted', 'bypass'],
  partialOutput: 'full',
  // Below the agent's own trigger (window less max(16384, output cap)) for every window worth running; only the meter reads it.
  contextCompactionAt: 0.85,
};

const num = (description: string, minimum: number, maximum?: number) => ({ type: 'number', minimum, ...(maximum !== undefined ? { maximum } : {}), description });
const CONFIG_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    temperature: num('Sampling temperature; sent only when set', 0, 2),
    topP: num('Nucleus sampling; sent only when set', 0, 1),
    frequencyPenalty: num('Frequency penalty; sent only when set', -2, 2),
    presencePenalty: num('Presence penalty; sent only when set', -2, 2),
    maxOutputTokens: { type: 'integer', minimum: 1, description: 'Output cap, sent under the provider\'s max-tokens name only when set' },
    seed: { type: 'integer', description: 'Sampling seed; sent only when set' },
    stop: { type: 'array', items: { type: 'string' }, description: 'Stop sequences; sent only when set' },
    toolChoice: { type: 'string', enum: ['auto', 'required', 'none'], description: 'How the model may pick tools; sent only when set and the endpoint allows it' },
    parallelToolCalls: { type: 'boolean', description: 'Whether the model may call several tools at once; sent only when set and the endpoint takes it' },
    responseFormat: { type: 'string', enum: ['text', 'json_object'], description: 'Response format; sent only when set and the endpoint lists it' },
    extraBody: { type: 'string', description: 'A JSON object merged last into the request body (a string, because an option cannot hold an object)' },
    extraHeaders: { type: 'array', items: { type: 'string' }, description: 'Extra request headers, one "Name: value" per entry' },
    contextWindowTokens: { type: 'integer', minimum: 1, description: 'The model\'s context window when the endpoint does not say' },
    maxTurnTokens: { type: 'integer', minimum: 1, description: 'Stop the turn (as tooling/budget_exhausted) once it has used this many tokens; unset means no cap' },
    sessionRetentionDays: { type: 'integer', minimum: 0, description: 'Delete sessions unused for this many days (default 30, 0 keeps them)' },
    debugWire: { type: 'boolean', description: 'Record each request and response, redacted, under the run\'s wire directory. Sensitive: message content is kept' },
    webFetch: { type: 'boolean', description: 'Enable the web_fetch tool; off by default and denied in restricted mode' },
  },
};

export interface WeaveAdapterOptions {
  /** The child entry file. Defaults to `@weave-ai/agent`'s. */
  entry?: string;
  /** Arguments before the entry, e.g. a loader for a source checkout. */
  nodeArgs?: string[];
  host?: RuntimeHost;
  /** For discovery; defaults to the global fetch. */
  fetch?: typeof fetch;
  now?: () => number;
}

const DISCOVERY_TTL_MS = 10 * 60_000;
const DISCOVERY_FAILURE_TTL_MS = 60_000;
interface Discovered { id: string; contextWindow?: number }

export function createAdapter(opts: WeaveAdapterOptions = {}): RuntimeAdapter {
  let host: RuntimeHost | undefined = opts.host;
  const entry = (): string => opts.entry ?? agentEntryPath();
  const providers = (workspaceId?: string): Record<string, ProviderProfile> => host?.providers(workspaceId) ?? {};
  const now = opts.now ?? Date.now;
  const presetOf = (p: ProviderProfile) => loadPreset(p.preset ?? 'openai-compatible');
  const gates = new Map<string, Semaphore>();

  /** `GET {baseUrl}{modelsPath}`, cached ten minutes per provider. A failure is remembered for a minute and yields nothing, so the static models still list. Delegates the request to `listProviderModels` (VS-635) so a run and the Settings fetch use one discovery path. */
  const cache = new Map<string, { at: number; ok: boolean; models: Discovered[] }>();
  async function discover(pid: string, profile: ProviderProfile, workspaceId?: string): Promise<Discovered[]> {
    if (profile.discover === false) return [];
    // The workspace is part of the cache key: two workspaces defining the same provider id must not
    // share one discovery result, or its key.
    const key = `${workspaceId ?? ''}|${pid}|${profile.baseUrl}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < (hit.ok ? DISCOVERY_TTL_MS : DISCOVERY_FAILURE_TTL_MS)) return hit.models;
    const apiKey = host?.providerKey?.(pid, workspaceId);
    const result = await listProviderModels({ profile, apiKey: apiKey ?? undefined, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
    const models: Discovered[] = result.ok ? result.models : [];
    cache.set(key, { at: now(), ok: result.ok, models });
    return models;
  }

  const failure = (sink: TurnSink, code: string, family: 'auth' | 'tooling', message: string): TurnResult => {
    sink.onEvent({ ts: new Date().toISOString(), type: 'error', payload: { code, family, message } });
    return { exitCode: 1, signal: null, timedOut: false, session: null, finalText: null, error: { code, family, message } };
  };

  return {
    id: 'weave',
    displayName: 'Weave Agent',
    capabilities,
    attach(h: RuntimeHost): void { host = h; },

    async detect(): Promise<RuntimeDetection> {
      if (!existsSync(entry())) return { status: 'broken', notes: `agent entry not found at ${entry()}` };
      if (Object.keys(providers()).length === 0) return { status: 'unsupported', notes: 'No model provider is configured: add one under Settings → Providers (daemon), or under `providers` in a workspace config.' };
      return { status: 'available', path: entry() };
    },

    async listModels(workspaceId?: string): Promise<RuntimeModel[]> {
      const out: RuntimeModel[] = [];
      for (const [pid, profile] of Object.entries(providers(workspaceId))) {
        const seen = new Set<string>();
        const add = (mid: string, contextWindow: number | undefined, source: RuntimeModel['source']): void => {
          if (seen.has(mid)) return;
          seen.add(mid);
          const efforts = resolveProvider({ preset: presetOf(profile), profile, model: profile.models[mid] }).compat.reasoning.effortLevels;
          out.push({ id: `${pid}/${mid}`, label: `${mid} (${pid})`, provider: pid, source, ...(contextWindow ? { contextWindowTokens: contextWindow } : {}), ...(efforts.length > 0 ? { efforts } : {}) });
        };
        // Configured models first: what the workspace wrote wins over what the endpoint reports.
        const found = await discover(pid, profile, workspaceId);
        const byId = new Map(found.map((d) => [d.id, d]));
        for (const [mid, m] of Object.entries(profile.models)) add(mid, m.contextWindow ?? byId.get(mid)?.contextWindow, 'static');
        for (const d of found) add(d.id, d.contextWindow, 'detected');
      }
      return out;
    },

    async modelContextWindow(model, workspaceId?: string): Promise<number | undefined> {
      const parts = splitModel(model);
      if (!parts) return undefined;
      const profile = providers(workspaceId)[parts.providerId];
      if (!profile) return undefined;
      return profile.models[parts.modelId]?.contextWindow ?? (await discover(parts.providerId, profile, workspaceId)).find((d) => d.id === parts.modelId)?.contextWindow;
    },

    configSchema(): JsonSchema { return structuredClone(CONFIG_SCHEMA); },
    skillsDir(): string { return '.agents/skills'; },
    instructionFiles(): string[] { return ['AGENTS.md']; },

    async installInstructions(home: AgentHome, bundle: InstructionBundle): Promise<void> {
      installBundleFiles(home, bundle, { instructions: { 'AGENTS.md': bundle.instructions }, skillsDir: '.agents/skills' });
    },

    // The fork copies a file and resolves no provider, so the workspace id is accepted and unused.
    async forkSession(base: SessionRef, _cwd?: string, _workspaceId?: string): Promise<SessionRef> {
      const from = typeof base['path'] === 'string' ? base['path'] : '';
      if (!from || !existsSync(from)) throw new Error('the session file to fork does not exist');
      const id = randomUUID();
      const to = join(dirname(from), `${id}.jsonl`);
      forkSessionFile(from, to, id);
      return { v: 1, id, path: to, leafId: typeof base['leafId'] === 'string' ? base['leafId'] : null };
    },

    async compactSession(input: CompactSessionInput): Promise<CompactSessionResult> {
      const fail = (code: string, message: string): CompactSessionResult => ({ ok: false, error: { code, message } });
      try {
        const path = typeof input.ref['path'] === 'string' ? input.ref['path'] : '';
        if (!path || !existsSync(path)) return fail('session_missing', 'The session file does not exist.');
        const parts = splitModel(input.model);
        if (!parts) return fail('model_not_configured', 'The weave runtime needs a model written as providerId/modelId.');
        const profile = providers(input.workspaceId)[parts.providerId];
        if (!profile) return fail('provider_not_configured', `No provider "${parts.providerId}" in the daemon settings or this workspace config.`);
        const preset = presetOf(profile);
        if (!preset) return fail('preset_unknown', `Provider "${parts.providerId}" names preset "${profile.preset}", which does not exist.`);
        const keyVar = profile.apiKeySecret;
        const apiKey = (keyVar ? input.env?.[keyVar] : undefined) ?? host?.providerKey?.(parts.providerId, input.workspaceId);
        if (profile.auth !== 'none' && keyVar && !apiKey) return fail('key_missing', `The provider key ${keyVar} is not available.`);
        const resolved = resolveProvider({ preset, profile, model: profile.models[parts.modelId] });
        if (resolved.params.contextWindowTokens === undefined) {
          const w = profile.models[parts.modelId]?.contextWindow ?? (await discover(parts.providerId, profile, input.workspaceId)).find((d) => d.id === parts.modelId)?.contextWindow;
          if (w) resolved.params.contextWindowTokens = w;
        }
        const extra = headersWithExtras(profile.headers, resolved.params.extraHeaders);
        if (extra.errors.length > 0) return fail('invalid_option', extra.errors.join('; '));
        const id = typeof input.ref['id'] === 'string' ? input.ref['id'] : 'unknown';
        const init = buildCompactInit({ cwd: input.cwd, ...(input.configHome ? { configHome: input.configHome } : {}), ...parts, profile, apiKey, session: { id, path }, resolved, headers: extra.headers, timeoutMs: input.timeoutMs ?? 300_000 });
        let result: ChildResult | null = null;
        const run = spawnLines({
          cmd: process.execPath, args: [...(opts.nodeArgs ?? []), entry(), '--compact'], cwd: input.cwd, env: childBaseEnv(childEnv()),
          stdin: `${JSON.stringify(init)}\n`, stdinMode: 'open', timeoutMs: (input.timeoutMs ?? 300_000) + 30_000,
          onLine: (stream, line) => { if (stream !== 'stdout') return; const m = parseChildLine(line); if (m.kind === 'result') result = m.result; },
        });
        await run.done;
        const r = result as ChildResult | null;
        if (!r) return fail('agent_crashed', 'The agent process ended without reporting a result.');
        if (r.error) return fail(r.error.code, r.error.message);
        return { ok: true, via: 'child', detail: { ...(r.compaction ?? {}) } };
      } catch (e) { return fail('compact_failed', (e as Error).message); }
    },

    async describeSession(ref: SessionRef) {
      const id = typeof ref['id'] === 'string' ? ref['id'] : 'unknown';
      return { displayId: id, exists: typeof ref['path'] === 'string' && existsSync(ref['path']) };
    },

    async runTurn(input: TurnInput, sink: TurnSink, onHandle?: (h: TurnHandle) => void): Promise<TurnResult> {
      const parts = splitModel(input.model);
      if (!parts) return failure(sink, 'model_not_configured', 'tooling', 'The weave runtime needs a model written as providerId/modelId.');
      const profile = providers(input.workspaceId)[parts.providerId];
      if (!profile) return failure(sink, 'provider_not_configured', 'tooling', `No provider "${parts.providerId}" in the daemon settings or this workspace config.`);
      const keyVar = profile.apiKeySecret;
      // The run's own environment first (a role that carries the secret still wins, and the host
      // environment keeps its VS-92 precedence), then the secret store of the run's own workspace.
      const apiKey = (keyVar ? input.env[keyVar] : undefined) ?? (keyVar ? host?.providerKey?.(parts.providerId, input.workspaceId) : undefined);
      if (profile.auth !== 'none' && keyVar && !apiKey) return failure(sink, 'key_missing', 'auth', `The provider key ${keyVar} is not set: add it under Settings > Providers, or attach the secret to the role.`);

      const preset = presetOf(profile);
      if (!preset) return failure(sink, 'preset_unknown', 'tooling', `Provider "${parts.providerId}" names preset "${profile.preset}", which does not exist.`);
      const resolved = resolveProvider({ preset, profile, model: profile.models[parts.modelId], options: input.options });
      // The option wins; otherwise the model's own window from the profile or discovery, so the child can compact before an overflow.
      if (resolved.params.contextWindowTokens === undefined) {
        const w = profile.models[parts.modelId]?.contextWindow ?? (await discover(parts.providerId, profile)).find((d) => d.id === parts.modelId)?.contextWindow;
        if (w) resolved.params.contextWindowTokens = w;
      }
      const extra = headersWithExtras(profile.headers, resolved.params.extraHeaders);
      const optionErrors = [...resolved.errors, ...extra.errors];
      if (optionErrors.length > 0) return failure(sink, 'invalid_option', 'tooling', `The model options are not valid: ${optionErrors.join('; ')}`);

      const layout = layoutFor(input);
      const prior = input.session.ref && typeof input.session.ref['id'] === 'string' && typeof input.session.ref['path'] === 'string' ? input.session.ref : null;
      const session = prior ? { id: String(prior['id']), path: String(prior['path']) } : (() => { const id = randomUUID(); return { id, path: join(layout.sessionsDir, `${id}.jsonl`) }; })();
      const base = childEnv();
      const init = buildInit(input, { ...parts, profile, apiKey, session, layout, toolEnv: toolEnvFor(input, base, keyVar), resolved, headers: extra.headers, protectedPaths: host?.configDir ? [host.configDir] : [] });

      // At most `maxConcurrentRuns` children per provider; a run cancelled while it waits never takes a slot.
      const wait = new AbortController();
      let live: ReturnType<typeof spawnLines> | null = null;
      /** Set when the child's `result` line arrives: `send` is `closed` from then on (S7). */
      let resultSeen = false;
      // Resolves with the child once it is spawned (or null if the run never gets one). A `send` that
      // arrives before the spawn — the instant a turn starts, or while the concurrency gate holds it —
      // waits here instead of being wrongly reported closed.
      let settleSpawn: (run: ReturnType<typeof spawnLines> | null) => void = () => undefined;
      const spawned = new Promise<ReturnType<typeof spawnLines> | null>((resolve) => { settleSpawn = resolve; });
      onHandle?.({
        get pid() { return live?.child.pid ?? null; },
        cancel: async (mode) => { wait.abort(); await live?.cancel(mode); },
        // Live input (S7): one NDJSON line per message; the child queues it and delivers it at its
        // next request boundary. Once the result exists (or the child is gone) nothing can take it.
        send: async (text) => {
          if (resultSeen) return 'closed';
          const run = live ?? await spawned;
          if (resultSeen || !run) return 'closed';
          return run.write(`${JSON.stringify({ type: 'send', text })}\n`) ? 'delivered' : 'closed';
        },
      });
      let release = (): void => undefined;
      if (profile.maxConcurrentRuns) {
        const gate = gates.get(parts.providerId) ?? new Semaphore(profile.maxConcurrentRuns);
        gates.set(parts.providerId, gate);
        gate.setLimit(profile.maxConcurrentRuns);
        try { release = await gate.acquire(wait.signal); }
        catch { settleSpawn(null); return { exitCode: 143, signal: 'SIGTERM', timedOut: false, session: input.session.ref, finalText: null, provider: parts.providerId }; }
      }
      try {
        let seq = 0;
        const emit = (ev: RuntimeEvent): void => sink.onEvent({ ...ev, seq: seq++ });
        emit({ ts: new Date().toISOString(), type: prior ? 'session.resumed' : 'session.started', payload: { sessionId: session.id } });

        let result: ChildResult | null = null;
        let lastStderr = '';
        const run = spawnLines({
          cmd: process.execPath, args: [...(opts.nodeArgs ?? []), entry()], cwd: input.cwd, env: childBaseEnv(base),
          stdin: `${JSON.stringify(init)}\n`, stdinMode: 'open',
          // The child stops itself 30 s before the limit; this is the backstop.
          timeoutMs: input.limits.timeoutMs + 60_000,
          ...(input.containment ? { containment: input.containment } : {}),
          onSpawn: (pid) => sink.onSpawn({ pid, pgid: pid }),
          onLine: (stream, line) => {
            if (stream === 'stderr') { lastStderr = line; sink.onRaw('stderr', line); return; }
            const m = parseChildLine(line);
            if (m.kind === 'event') emit(m.ev);
            else if (m.kind === 'partial') sink.onPartial?.(m.partial);
            else if (m.kind === 'log') sink.onRaw('stderr', m.text);
            else if (m.kind === 'result') { result = m.result; resultSeen = true; }
            else sink.onRaw('stdout', m.text);
          },
        });
        live = run;
        settleSpawn(run);
        const outcome = await run.done;
        return finish(result, outcome, lastStderr, input, parts.providerId);
      } finally { settleSpawn(null); release(); }
    },
  };
}

function finish(result: ChildResult | null, outcome: { exitCode: number | null; signal: string | null; timedOut: boolean }, stderrTail: string, input: TurnInput, providerId: string): TurnResult {
  if (result) {
    const { error, usage, ...rest } = result;
    return { ...rest, timedOut: result.timedOut || outcome.timedOut, ...(usage ? { usage } : {}), ...(error ? { error } : {}), provider: providerId, ...(result.session ? { session: result.session as unknown as SessionRef } : {}) };
  }
  // The child died before it could report: classify by how it died.
  const killed = outcome.signal === 'SIGKILL' || outcome.exitCode === 137;
  const error = killed
    ? { code: 'killed', family: 'resource' as const, message: 'The agent process was killed (out of memory or stopped by the system).' }
    : { code: 'agent_crashed', family: 'unknown' as const, message: `The agent process exited without a result${stderrTail ? `: ${stderrTail.slice(0, 500)}` : ''}` };
  return { exitCode: killed ? 137 : (outcome.exitCode ?? 1), signal: outcome.signal, timedOut: outcome.timedOut, session: input.session.ref, finalText: null, provider: providerId, error };
}

export const adapter: RuntimeAdapter = createAdapter();
export default adapter;
