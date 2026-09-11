/**
 * Which runtime, model and effort a turn runs on (VS-77, ADR 0011; VS-162, ADR 0012; VS-185, ADR 0013).
 *
 * There is one answer and one place it comes from: the effective model settings after a daemon
 * overlay (if filled) is applied to the workspace. The conductor runs on `models.conductor`. A
 * worker runs on the catalog option its ticket names, when that option still exists, otherwise on
 * `models.workers`. This function is the only reader — everything that used to layer
 * `agent.model ?? role.model ?? config.defaults.model` goes through it instead, so there is no
 * chain left for a stale row to enter.
 */
import type { AgentKind, DaemonModels, ModelSetting, ModelsLocked, WorkspaceConfig, WorkspaceModels } from '@agent-conductor/shared';
import { DEFAULT_WORKSPACE_MODELS, OcError, isWorkerOptionConfigured } from '@agent-conductor/shared';

export function catalogOverlayFilled(opts: DaemonModels['workerOptions']): opts is NonNullable<DaemonModels['workerOptions']> {
  return Array.isArray(opts) && opts.length > 0;
}

export function effectiveModels(
  daemon: { models?: DaemonModels } | null | undefined,
  workspace: Pick<WorkspaceConfig, 'models'>,
): WorkspaceModels {
  const stored = workspace.models ?? DEFAULT_WORKSPACE_MODELS;
  const overlay = daemon?.models ?? {};
  return {
    conductor: overlay.conductor ?? stored.conductor,
    workers: overlay.workers ?? stored.workers,
    workerOptions: catalogOverlayFilled(overlay.workerOptions) ? overlay.workerOptions : (stored.workerOptions ?? []),
  };
}

export function modelsLocked(daemon: { models?: DaemonModels } | null | undefined): ModelsLocked {
  const overlay = daemon?.models ?? {};
  return {
    conductor: overlay.conductor != null,
    workers: overlay.workers != null,
    workerOptions: catalogOverlayFilled(overlay.workerOptions),
  };
}

/** Workspace config whose `models` block is already the effective one. Pass this to `modelSettingFor`. */
export function modelsFor(ctx: { daemon?: { models?: DaemonModels }; config: Pick<WorkspaceConfig, 'models'> }): Pick<WorkspaceConfig, 'models'> {
  return { models: effectiveModels(ctx.daemon, ctx.config) };
}

/** The setting that governs an agent of this kind, optionally given a worker's ticket. */
export function modelSettingFor(
  config: Pick<WorkspaceConfig, 'models'>,
  kind: AgentKind,
  ticket?: { workerModelId?: string | null } | null,
): ModelSetting {
  const models = config.models ?? DEFAULT_WORKSPACE_MODELS;
  if (kind === 'conductor') return models.conductor;
  const id = ticket?.workerModelId;
  if (id) {
    const opt = (models.workerOptions ?? []).find((o) => o.id === id);
    if (opt) {
      if (!isWorkerOptionConfigured(opt)) {
        throw new OcError('model_unconfigured', `worker option '${id}' has no runtime chosen`, { optionId: id });
      }
      return { runtime: opt.runtime, model: opt.model, ...(opt.effort !== undefined ? { effort: opt.effort } : {}) };
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
    overlay?.conductor?.runtime,
    overlay?.workers?.runtime,
  ].filter((id): id is string => Boolean(id)))];
}
