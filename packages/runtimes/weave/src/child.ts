import { agentEntryPath, type InitMessage, type Resolved } from '@weave-ai/agent';
import { AC_ENV, type ProviderProfile } from '@weave-ai/shared';
import type { TurnInput } from '@weave-ai/runtime-sdk';
import { join } from 'node:path';

/** `providerId/modelId` → the two halves. The model id may itself contain slashes (`z-ai/glm-5`). */
export function splitModel(model: string | null | undefined): { providerId: string; modelId: string } | null {
  if (!model) return null;
  const i = model.indexOf('/');
  if (i <= 0 || i === model.length - 1) return null;
  return { providerId: model.slice(0, i), modelId: model.slice(i + 1) };
}

export interface ChildLayout { sessionsDir: string; spillDir: string }
export function layoutFor(input: Pick<TurnInput, 'cwd' | 'configHome' | 'runId'>): ChildLayout {
  const base = input.configHome ? join(input.configHome, 'weave-agent') : join(input.cwd, '.weave-agent');
  return { sessionsDir: join(base, 'sessions'), spillDir: join(base, 'tool-output', input.runId) };
}

/**
 * The environment a shell tool runs in: the run's environment without the run token (the token is
 * only the MCP client's header) and without the provider key, on top of a plain base.
 */
export function toolEnvFor(input: Pick<TurnInput, 'env'>, base: Record<string, string>, keyVar: string | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of ['PATH', 'HOME', 'LANG', 'TMPDIR', 'USER']) if (base[k] !== undefined) env[k] = base[k]!;
  env['LANG'] ??= 'C.UTF-8';
  env['TERM'] = 'dumb';
  for (const [k, v] of Object.entries(input.env)) if (k !== AC_ENV.RUN_TOKEN && k !== keyVar) env[k] = v;
  return env;
}

/** The child's own environment: no daemon secrets, no run environment, nothing but what Node needs to start. */
export function childBaseEnv(base: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of ['PATH', 'HOME', 'LANG', 'TMPDIR']) if (base[k] !== undefined) env[k] = base[k]!;
  return env;
}

export function buildInit(input: TurnInput, p: { providerId: string; modelId: string; profile: ProviderProfile; apiKey: string | undefined; session: { id: string; path: string }; layout: ChildLayout; toolEnv: Record<string, string>; resolved: Resolved; headers: Record<string, string> }): InitMessage {
  const mcpServers: InitMessage['mcpServers'] = {};
  for (const [name, cfg] of Object.entries(input.mcpServers)) if (cfg.type === 'http' && cfg.url) mcpServers[name] = { url: cfg.url, ...(cfg.headers ? { headers: cfg.headers } : {}) };
  return {
    type: 'init', v: 1,
    run: {
      runId: input.runId, turnEpoch: input.turnEpoch, cwd: input.cwd, worktree: input.worktree,
      limits: { timeoutMs: input.limits.timeoutMs, ...(input.limits.maxTurns !== undefined ? { maxTurns: input.limits.maxTurns } : {}) },
      permission: { mode: input.permission.mode, ...(input.permission.allowedTools ? { allowedTools: input.permission.allowedTools } : {}), ...(input.permission.deniedTools ? { deniedTools: input.permission.deniedTools } : {}), ...(input.permission.bashDeny ? { bashDeny: input.permission.bashDeny } : {}), ...(input.permission.firstTurn ? { firstTurn: true } : {}) },
      model: p.modelId, effort: input.effort ?? null, options: input.options, spillDir: p.layout.spillDir,
      ...(input.configHome ? { configHome: input.configHome } : {}),
    },
    provider: {
      id: p.providerId, baseUrl: p.profile.baseUrl, auth: p.profile.auth, headers: p.headers, ...(p.profile.query ? { query: p.profile.query } : {}), ...(p.apiKey ? { apiKey: p.apiKey } : {}),
      // Resolved here so the child never sees the layers; JSON round-trip drops the undefined fields.
      compat: JSON.parse(JSON.stringify(p.resolved.compat)) as NonNullable<InitMessage['provider']['compat']>, params: JSON.parse(JSON.stringify(p.resolved.params)) as NonNullable<InitMessage['provider']['params']>,
      ...(p.profile.timeouts && Object.keys(p.profile.timeouts).length > 0 ? { timeouts: { ...p.profile.timeouts } } : {}),
    },
    prompt: input.prompt, systemPrompt: input.systemPrompt, session: p.session, mcpServers, toolEnv: p.toolEnv,
  };
}

export { agentEntryPath };
