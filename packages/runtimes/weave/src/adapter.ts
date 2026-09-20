import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { agentEntryPath, headersWithExtras, loadPreset, requestHeaders, resolveProvider, type ChildResult } from '@weave-ai/agent';
import { childEnv, installBundleFiles, spawnLines, type AgentHome, type InstructionBundle, type JsonSchema, type RuntimeAdapter, type RuntimeCapabilities, type RuntimeDetection, type RuntimeEvent, type RuntimeHost, type RuntimeModel, type SessionRef, type TurnHandle, type TurnInput, type TurnResult, type TurnSink } from '@weave-ai/runtime-sdk';
import type { ProviderProfile } from '@weave-ai/shared';
import { buildInit, childBaseEnv, layoutFor, splitModel, toolEnvFor } from './child.js';
import { parseChildLine } from './events.js';
import { Semaphore } from './semaphore.js';

export const capabilities: RuntimeCapabilities = {
  resumableSessions: true, forkSessions: false, streamingInput: false, systemPromptInjection: 'system_prompt',
  structuredOutput: false, mcp: true, usageReporting: 'per_turn', costReporting: false, permissionModes: ['auto', 'restricted', 'bypass'],
  partialOutput: 'full',
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
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = opts.now ?? Date.now;
  const presetOf = (p: ProviderProfile) => loadPreset(p.preset ?? 'openai-compatible');
  const gates = new Map<string, Semaphore>();

  /** `GET {baseUrl}{modelsPath}`, cached ten minutes per provider. A failure is remembered for a minute and yields nothing, so the static models still list. */
  const cache = new Map<string, { at: number; ok: boolean; models: Discovered[] }>();
  async function discover(pid: string, profile: ProviderProfile, workspaceId?: string): Promise<Discovered[]> {
    if (profile.discover === false) return [];
    // The workspace is part of the cache key: two workspaces defining the same provider id must not
    // share one discovery result, or its key.
    const key = `${workspaceId ?? ''}|${pid}|${profile.baseUrl}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < (hit.ok ? DISCOVERY_TTL_MS : DISCOVERY_FAILURE_TTL_MS)) return hit.models;
    let models: Discovered[] = []; let ok = false;
    try {
      const { compat, params } = resolveProvider({ preset: presetOf(profile), profile });
      const apiKey = host?.providerKey?.(pid, workspaceId);
      const headers = requestHeaders({ id: pid, baseUrl: profile.baseUrl, auth: profile.auth, headers: headersWithExtras(profile.headers, params.extraHeaders).headers, ...(apiKey ? { apiKey } : {}) });
      const qs = new URLSearchParams(profile.query ?? {}).toString();
      const res = await doFetch(`${profile.baseUrl.replace(/\/+$/, '')}${compat.modelsPath}${qs ? `?${qs}` : ''}`, { headers: { ...headers, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { data?: unknown };
      const list = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json as unknown[] : [];
      const field = compat.contextField;
      for (const m of list) {
        if (typeof m !== 'object' || m === null) continue;
        const id = (m as Record<string, unknown>)['id'];
        if (typeof id !== 'string' || !id) continue;
        const w = field ? field.split('.').reduce<unknown>((o, k) => (typeof o === 'object' && o !== null ? (o as Record<string, unknown>)[k] : undefined), m) : undefined;
        models.push({ id, ...(typeof w === 'number' && w > 0 ? { contextWindow: Math.floor(w) } : {}) });
      }
      ok = true;
    } catch { models = []; }
    cache.set(key, { at: now(), ok, models });
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
      if (Object.keys(providers()).length === 0) return { status: 'unsupported', notes: 'No model provider is configured: add one under `providers` in the workspace config.' };
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

    async describeSession(ref: SessionRef) {
      const id = typeof ref['id'] === 'string' ? ref['id'] : 'unknown';
      return { displayId: id, exists: typeof ref['path'] === 'string' && existsSync(ref['path']) };
    },

    async runTurn(input: TurnInput, sink: TurnSink, onHandle?: (h: TurnHandle) => void): Promise<TurnResult> {
      const parts = splitModel(input.model);
      if (!parts) return failure(sink, 'model_not_configured', 'tooling', 'The weave runtime needs a model written as providerId/modelId.');
      const profile = providers(input.workspaceId)[parts.providerId];
      if (!profile) return failure(sink, 'provider_not_configured', 'tooling', `No provider "${parts.providerId}" in the workspace config.`);
      const keyVar = profile.apiKeySecret;
      // The run's own environment first (a role that carries the secret still wins, and the host
      // environment keeps its VS-92 precedence), then the secret store of the run's own workspace.
      const apiKey = (keyVar ? input.env[keyVar] : undefined) ?? (keyVar ? host?.providerKey?.(parts.providerId, input.workspaceId) : undefined);
      if (profile.auth !== 'none' && keyVar && !apiKey) return failure(sink, 'key_missing', 'auth', `The provider key ${keyVar} is not set: add it under Settings > Providers, or attach the secret to the role.`);

      const preset = presetOf(profile);
      if (!preset) return failure(sink, 'preset_unknown', 'tooling', `Provider "${parts.providerId}" names preset "${profile.preset}", which does not exist.`);
      const resolved = resolveProvider({ preset, profile, model: profile.models[parts.modelId], options: input.options });
      const extra = headersWithExtras(profile.headers, resolved.params.extraHeaders);
      const optionErrors = [...resolved.errors, ...extra.errors];
      if (optionErrors.length > 0) return failure(sink, 'invalid_option', 'tooling', `The model options are not valid: ${optionErrors.join('; ')}`);

      const layout = layoutFor(input);
      const prior = input.session.ref && typeof input.session.ref['id'] === 'string' && typeof input.session.ref['path'] === 'string' ? input.session.ref : null;
      const session = prior ? { id: String(prior['id']), path: String(prior['path']) } : (() => { const id = randomUUID(); return { id, path: join(layout.sessionsDir, `${id}.jsonl`) }; })();
      const base = childEnv();
      const init = buildInit(input, { ...parts, profile, apiKey, session, layout, toolEnv: toolEnvFor(input, base, keyVar), resolved, headers: extra.headers });

      // At most `maxConcurrentRuns` children per provider; a run cancelled while it waits never takes a slot.
      const wait = new AbortController();
      let live: ReturnType<typeof spawnLines> | null = null;
      onHandle?.({ get pid() { return live?.child.pid ?? null; }, cancel: async (mode) => { wait.abort(); await live?.cancel(mode); } });
      let release = (): void => undefined;
      if (profile.maxConcurrentRuns) {
        const gate = gates.get(parts.providerId) ?? new Semaphore(profile.maxConcurrentRuns);
        gates.set(parts.providerId, gate);
        gate.setLimit(profile.maxConcurrentRuns);
        try { release = await gate.acquire(wait.signal); }
        catch { return { exitCode: 143, signal: 'SIGTERM', timedOut: false, session: input.session.ref, finalText: null, provider: parts.providerId }; }
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
            else if (m.kind === 'result') result = m.result;
            else sink.onRaw('stdout', m.text);
          },
        });
        live = run;
        const outcome = await run.done;
        return finish(result, outcome, lastStderr, input, parts.providerId);
      } finally { release(); }
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
