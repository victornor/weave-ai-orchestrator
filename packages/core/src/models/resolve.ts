/**
 * Which runtime, model and effort a turn runs on (VS-77, ADR 0011; VS-162, ADR 0012; VS-185, ADR
 * 0013; VS-284).
 *
 * There is one answer and one place it comes from: the effective model settings after the
 * workspace's own configured value (if any) is layered over a daemon overlay (if filled), which is
 * itself the fallback for a workspace that has not configured a control. The weaver runs on
 * `models.weaver`. A worker runs on the catalog option its ticket names, when that option still
 * exists, otherwise on `models.workers`. This function is the only reader — everything that used
 * to layer `agent.model ?? role.model ?? config.defaults.model` goes through it instead, so there
 * is no chain left for a stale row to enter.
 */
import type { AgentKind, DaemonModels, EffectiveModels, ModelSetting, WorkspaceConfig, WorkspaceModelsSource } from '@weave-ai/shared';
import { DEFAULT_WORKSPACE_MODELS, OcError, isWorkerOptionConfigured } from '@weave-ai/shared';

/** A worker-options list that is non-empty — the signal a side of the precedence is "filled". */
export function catalogFilled<T>(opts: readonly T[] | null | undefined): opts is readonly T[] {
  return Array.isArray(opts) && opts.length > 0;
}

export function effectiveModels(
  daemon: { models?: DaemonModels } | null | undefined,
  workspace: Pick<WorkspaceConfig, 'models'>,
): EffectiveModels {
  const stored = workspace.models;
  const overlay = daemon?.models ?? {};
  return {
    weaver: stored?.weaver ?? overlay.weaver ?? DEFAULT_WORKSPACE_MODELS.weaver,
    workers: stored?.workers ?? overlay.workers ?? DEFAULT_WORKSPACE_MODELS.workers,
    workerOptions: catalogFilled(stored?.workerOptions) ? stored.workerOptions : (catalogFilled(overlay.workerOptions) ? overlay.workerOptions : []),
  };
}

/** Workspace config whose `models` block is already the effective one. Pass this to `modelSettingFor`. */
export function modelsFor(ctx: { daemon?: { models?: DaemonModels }; config: Pick<WorkspaceConfig, 'models'> }): { models: EffectiveModels } {
  return { models: effectiveModels(ctx.daemon, ctx.config) };
}

/**
 * Where each effective control comes from (VS-356): `'workspace'` when the workspace stores its own
 * value, `'daemon'` when it does not but the daemon overlay is filled, else `'default'`. Mirrors the
 * precedence in `effectiveModels` exactly, including `catalogFilled` for the worker-options catalog.
 */
export function modelsSource(
  daemon: { models?: DaemonModels } | null | undefined,
  workspace: Pick<WorkspaceConfig, 'models'>,
): WorkspaceModelsSource {
  const stored = workspace.models;
  const overlay = daemon?.models ?? {};
  return {
    weaver: stored?.weaver ? 'workspace' : (overlay.weaver ? 'daemon' : 'default'),
    workers: stored?.workers ? 'workspace' : (overlay.workers ? 'daemon' : 'default'),
    workerOptions: catalogFilled(stored?.workerOptions) ? 'workspace' : (catalogFilled(overlay.workerOptions) ? 'daemon' : 'default'),
  };
}

/**
 * VS-526: validate a caller-supplied worker-options id against the effective catalog — the single
 * resolver both a ticket (create/assign) and a persistent session (open/change) use, so an unknown
 * id is a `validation` error and an option with no runtime chosen is `model_unconfigured`, never a
 * silently-ignored value.
 */
export function resolveWorkerModelId(models: EffectiveModels, id: string | null | undefined): string | null {
  if (id == null || id === '') return null;
  const opts = models.workerOptions ?? [];
  const opt = opts.find((o) => o.id === id);
  if (!opt) {
    const ids = opts.map((o) => `'${o.id}'`);
    throw new OcError('validation', ids.length
      ? `unknown worker model option '${id}'; valid options are ${ids.join(', ')}`
      : `unknown worker model option '${id}'; this workspace has no worker options configured`);
  }
  if (!isWorkerOptionConfigured(opt)) {
    throw new OcError('model_unconfigured', `worker option '${id}' has no runtime chosen`, { optionId: id });
  }
  return id;
}

/** The setting that governs an agent of this kind, optionally given a worker's ticket. VS-398: a planner runs on the weaver's own setting — there is no separate per-workspace planner model. */
export function modelSettingFor(
  config: { models: EffectiveModels },
  kind: AgentKind,
  ticket?: { workerModelId?: string | null } | null,
  /**
   * VS-526: the worker option a persistent session was opened with or last changed to. A ticketless
   * session has no ticket, so its own option is what decides its runtime, model and effort; the
   * session's ticket (once it takes one) still wins when it names an option.
   */
  session?: { workerModelId?: string | null } | null,
): ModelSetting {
  const models = config.models;
  if (kind === 'weaver' || kind === 'planner') return models.weaver;
  const id = ticket?.workerModelId ?? session?.workerModelId;
  if (id) {
    const opt = (models.workerOptions ?? []).find((o) => o.id === id);
    if (opt) {
      if (!isWorkerOptionConfigured(opt)) {
        throw new OcError('model_unconfigured', `worker option '${id}' has no runtime chosen`, { optionId: id });
      }
      return {
        runtime: opt.runtime, model: opt.model,
        ...(opt.effort !== undefined ? { effort: opt.effort } : {}),
        ...(opt.options ? { options: opt.options } : {}),
      };
    }
  }
  return models.workers;
}

/** Runtimes named by the effective catalog and by filled daemon overlays, used by the account probe and credential homes. */
export function workerOptionRuntimes(
  config: Pick<WorkspaceConfig, 'models'>,
  daemon?: { models?: DaemonModels } | null,
): string[] {
  const models = effectiveModels(daemon, config);
  const overlay = daemon?.models;
  return [...new Set([
    ...models.workerOptions.map((o) => o.runtime),
    overlay?.weaver?.runtime,
    overlay?.workers?.runtime,
  ].filter((id): id is string => Boolean(id)))];
}
