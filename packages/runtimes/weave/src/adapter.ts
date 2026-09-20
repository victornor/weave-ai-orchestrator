import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { agentEntryPath, type ChildResult } from '@weave-ai/agent';
import { childEnv, installBundleFiles, spawnLines, type AgentHome, type InstructionBundle, type JsonSchema, type RuntimeAdapter, type RuntimeCapabilities, type RuntimeDetection, type RuntimeEvent, type RuntimeHost, type RuntimeModel, type SessionRef, type TurnHandle, type TurnInput, type TurnResult, type TurnSink } from '@weave-ai/runtime-sdk';
import type { ProviderProfile } from '@weave-ai/shared';
import { buildInit, childBaseEnv, layoutFor, splitModel, toolEnvFor } from './child.js';
import { parseChildLine } from './events.js';

export const capabilities: RuntimeCapabilities = {
  resumableSessions: true, forkSessions: false, streamingInput: false, systemPromptInjection: 'system_prompt',
  structuredOutput: false, mcp: true, usageReporting: 'per_turn', costReporting: false, permissionModes: ['auto', 'restricted', 'bypass'],
  partialOutput: 'full',
};

const CONFIG_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    temperature: { type: 'number', minimum: 0, maximum: 2, description: 'Sent only when set' },
    topP: { type: 'number', minimum: 0, maximum: 1, description: 'Sent only when set' },
    maxOutputTokens: { type: 'integer', minimum: 1, description: 'Sent as max_tokens only when set' },
    contextWindowTokens: { type: 'integer', minimum: 1, description: 'The model\'s context window when the endpoint does not say' },
  },
};

export interface WeaveAdapterOptions {
  /** The child entry file. Defaults to `@weave-ai/agent`'s. */
  entry?: string;
  /** Arguments before the entry, e.g. a loader for a source checkout. */
  nodeArgs?: string[];
  host?: RuntimeHost;
}

export function createAdapter(opts: WeaveAdapterOptions = {}): RuntimeAdapter {
  let host: RuntimeHost | undefined = opts.host;
  const entry = (): string => opts.entry ?? agentEntryPath();
  const providers = (): Record<string, ProviderProfile> => host?.providers() ?? {};

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

    async listModels(): Promise<RuntimeModel[]> {
      const out: RuntimeModel[] = [];
      for (const [pid, profile] of Object.entries(providers())) {
        for (const [mid, m] of Object.entries(profile.models)) out.push({ id: `${pid}/${mid}`, label: `${mid} (${pid})`, provider: pid, source: 'static', ...(m.contextWindow ? { contextWindowTokens: m.contextWindow } : {}) });
      }
      return out;
    },

    async modelContextWindow(model): Promise<number | undefined> {
      const parts = splitModel(model);
      return parts ? providers()[parts.providerId]?.models[parts.modelId]?.contextWindow : undefined;
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
      const profile = providers()[parts.providerId];
      if (!profile) return failure(sink, 'provider_not_configured', 'tooling', `No provider "${parts.providerId}" in the workspace config.`);
      const keyVar = profile.apiKeySecret;
      const apiKey = keyVar ? input.env[keyVar] : undefined;
      if (profile.auth !== 'none' && keyVar && !apiKey) return failure(sink, 'key_missing', 'auth', `The provider key ${keyVar} is not in this run's environment: attach the secret to the role.`);

      const layout = layoutFor(input);
      const prior = input.session.ref && typeof input.session.ref['id'] === 'string' && typeof input.session.ref['path'] === 'string' ? input.session.ref : null;
      const session = prior ? { id: String(prior['id']), path: String(prior['path']) } : (() => { const id = randomUUID(); return { id, path: join(layout.sessionsDir, `${id}.jsonl`) }; })();
      const base = childEnv();
      const init = buildInit(input, { ...parts, profile, apiKey, session, layout, toolEnv: toolEnvFor(input, base, keyVar) });

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
      onHandle?.({ pid: run.child.pid ?? null, cancel: (mode) => run.cancel(mode) });
      const outcome = await run.done;
      return finish(result, outcome, lastStderr, input, parts.providerId);
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
