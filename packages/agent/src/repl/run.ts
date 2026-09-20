import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ProviderProfile } from '@weave-ai/shared';
import { runAgentTurn, type LoopDeps, type LoopIO } from '../loop.js';
import type { ChildResult, InitMessage } from '../protocol.js';
import { headersWithExtras, loadPreset, resolveProvider } from '../resolve.js';
import type { SteeringSource } from '../steering.js';
import { agentConfigPath, resolveApiKey, resolveMcpRefs, type ReplConfig, type ReplPermission, type ResolvedKey } from './config.js';
import { recordTurn, spillDirFor } from './sessions.js';

/** What `/model`, `/permissions`, `/new` and resume change; each turn is built from it, so a change applies to the next request. */
export interface ReplState {
  providerId: string;
  model: string;
  permission: ReplPermission;
  /** Reasoning effort as the person typed it; mapped to a wire parameter by the provider's compat. */
  effort: string | null;
  /** Parameters the person set (option keys: `temperature`, `topP`, `maxOutputTokens`, `contextWindowTokens`, …). A key not here is never sent. */
  params: Record<string, unknown>;
  sessionId: string;
  sessionPath: string;
}

export interface TurnEnv { cwd: string; homeDir: string; env: NodeJS.ProcessEnv; userHome?: string }

/** The directories skills are read from, project first (an earlier root wins a name collision). */
export function skillRootsFor(cwd: string, userHome: string = homedir(), env: NodeJS.ProcessEnv = process.env): Array<{ dir: string; source: string }> {
  return [
    { dir: join(cwd, '.agents', 'skills'), source: 'project (.agents/skills)' },
    { dir: join(userHome, '.agents', 'skills'), source: 'user (~/.agents/skills)' },
    { dir: join(env['XDG_CONFIG_HOME'] || join(userHome, '.config'), 'weave', 'skills'), source: 'user (~/.config/weave/skills)' },
  ];
}

export type BuiltInit = { ok: true; init: InitMessage; key: ResolvedKey } | { ok: false; error: string };

/** Assemble the loop's `init` for one turn. Refuses, naming the reason, when the provider, key or an option is not usable. */
export function buildReplInit(state: ReplState, cfg: ReplConfig, prompt: string, t: TurnEnv, keyOverride?: string): BuiltInit {
  const profile: ProviderProfile | undefined = cfg.providers[state.providerId];
  if (!profile) return { ok: false, error: `no provider "${state.providerId}" is configured` };
  if (!state.model) return { ok: false, error: 'no model is chosen: pass --model, or use /model <id>' };
  const preset = loadPreset(profile.preset ?? 'openai-compatible');
  if (!preset) return { ok: false, error: `provider "${state.providerId}" names preset "${profile.preset}", which does not exist` };
  const key = keyOverride ? { key: keyOverride, source: 'env' as const, name: 'entered' } : resolveApiKey({ providerId: state.providerId, profile, env: t.env, workspace: cfg.workspace });
  if (profile.auth !== 'none' && !key.key) return { ok: false, error: `no API key for "${state.providerId}": set ${key.name} in the environment` };
  const resolved = resolveProvider({ preset, profile, model: profile.models[state.model], options: state.params });
  if (resolved.params.contextWindowTokens === undefined) { const w = profile.models[state.model]?.contextWindow; if (w) resolved.params.contextWindowTokens = w; }
  const extra = headersWithExtras(profile.headers, resolved.params.extraHeaders);
  const errors = [...resolved.errors, ...extra.errors];
  if (errors.length > 0) return { ok: false, error: `the model options are not valid: ${errors.join('; ')}` };

  const mcpServers: InitMessage['mcpServers'] = {};
  for (const [name, raw] of Object.entries(cfg.mcpServers)) {
    const { server: s } = resolveMcpRefs(raw, { env: t.env, workspace: cfg.workspace });
    const bounds = { listTimeoutMs: s.listTimeoutMs, callTimeoutMs: s.callTimeoutMs, readOnly: s.readOnly };
    if (s.type === 'stdio' && s.command) mcpServers[name] = { type: 'stdio', command: s.command, args: s.args, env: s.env, ...bounds };
    else if (s.url) mcpServers[name] = { type: 'http', url: s.url, headers: s.headers, ...bounds };
  }
  const agentsFile = join(t.cwd, 'AGENTS.md');
  const toolEnv: Record<string, string> = {};
  for (const k of ['PATH', 'HOME', 'LANG', 'TMPDIR', 'USER']) { const v = t.env[k]; if (v !== undefined) toolEnv[k] = v; }
  const init: InitMessage = {
    type: 'init', v: 1,
    run: {
      runId: state.sessionId, turnEpoch: 1, cwd: t.cwd, worktree: null, limits: { timeoutMs: 0 },
      permission: { mode: state.permission }, model: state.model, effort: state.effort, options: {}, spillDir: spillDirFor(t.homeDir, state.sessionId),
    },
    provider: {
      id: state.providerId, baseUrl: profile.baseUrl, auth: profile.auth, headers: extra.headers, ...(profile.query ? { query: profile.query } : {}), ...(key.key ? { apiKey: key.key } : {}),
      compat: JSON.parse(JSON.stringify(resolved.compat)) as NonNullable<InitMessage['provider']['compat']>,
      params: JSON.parse(JSON.stringify(resolved.params)) as NonNullable<InitMessage['provider']['params']>,
      ...(profile.timeouts && Object.keys(profile.timeouts).length > 0 ? { timeouts: { ...profile.timeouts } } : {}),
    },
    prompt,
    systemPrompt: existsSync(agentsFile) ? { text: readFileSync(agentsFile, 'utf8'), mode: 'inject' } : { text: '', mode: 'skip' },
    session: { path: state.sessionPath, id: state.sessionId, origin: 'repl' },
    skillRoots: skillRootsFor(t.cwd, t.userHome, t.env),
    mcpServers, toolEnv,
  };
  return { ok: true, init, key };
}

export interface TurnOutcome { result: ChildResult; built: BuiltInit }

/**
 * Run one turn on the shared loop, in this process. Cancel is `signal`, live input is `steering`; the result
 * is the loop's own, so `-p` can exit with its `exitCode`. A refusal to build is a result with exit code 2.
 */
export async function runReplTurn(state: ReplState, cfg: ReplConfig, prompt: string, t: TurnEnv, io: LoopIO, signal: AbortSignal, o: { steering?: SteeringSource; deps?: LoopDeps; keyOverride?: string } = {}): Promise<ChildResult> {
  const built = buildReplInit(state, cfg, prompt, t, o.keyOverride);
  if (!built.ok) return { exitCode: 2, signal: null, timedOut: false, session: null, finalText: null, error: { code: 'repl_config', family: 'tooling', message: built.error } };
  const result = await runAgentTurn(built.init, io, signal, { ...(o.steering ? { steering: o.steering } : {}), ...(o.deps ?? {}) });
  if (existsSync(state.sessionPath)) recordTurn(state.sessionPath, { prompt, provider: state.providerId, model: state.model });
  return result;
}

/** `/compact`: summarise the older part of the session now, on the same loop (its `compact` mode: no prompt, no tools). */
export async function compactReplSession(state: ReplState, cfg: ReplConfig, t: TurnEnv, io: LoopIO, signal: AbortSignal, o: { keyOverride?: string; deps?: LoopDeps } = {}): Promise<ChildResult> {
  const built = buildReplInit(state, cfg, '', t, o.keyOverride);
  if (!built.ok) return { exitCode: 2, signal: null, timedOut: false, session: null, finalText: null, error: { code: 'repl_config', family: 'tooling', message: built.error } };
  if (!existsSync(state.sessionPath)) return { exitCode: 0, signal: null, timedOut: false, session: null, finalText: null, compaction: { ok: false, reason: 'there is nothing to compact yet' } };
  return runAgentTurn({ ...built.init, mode: 'compact' }, io, signal, o.deps ?? {});
}

export { agentConfigPath };
