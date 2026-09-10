/**
 * Which runtime, model and effort a turn runs on (VS-77, ADR 0011; VS-162, ADR 0012).
 *
 * There is one answer and one place it comes from: the workspace's model settings. The
 * conductor runs on `models.conductor`. A worker runs on the catalog option its ticket
 * names, when that option still exists, otherwise on `models.workers`. This function is
 * the only reader — everything that used to layer `agent.model ?? role.model ??
 * config.defaults.model` goes through it instead, so there is no chain left for a stale
 * row to enter.
 */
import type { AgentKind, ModelSetting, WorkspaceConfig } from '@agent-conductor/shared';
import { DEFAULT_WORKSPACE_MODELS } from '@agent-conductor/shared';

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
    if (opt) return { runtime: opt.runtime, model: opt.model, ...(opt.effort !== undefined ? { effort: opt.effort } : {}) };
  }
  return models.workers;
}

/** Runtimes named only by the worker-options catalog, used by the account probe and credential homes. */
export function workerOptionRuntimes(config: Pick<WorkspaceConfig, 'models'>): string[] {
  return (config.models?.workerOptions ?? []).map((o) => o.runtime).filter(Boolean);
}
