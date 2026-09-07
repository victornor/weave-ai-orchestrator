/**
 * Which runtime, model and effort a turn runs on (VS-77, ADR 0011).
 *
 * There is one answer and one place it comes from: the workspace's two model settings. The
 * conductor runs on `models.conductor`, every worker on `models.workers`, whatever its role, its
 * project or what its own row happens to record. This function is the only reader — everything that
 * used to layer `agent.model ?? role.model ?? config.defaults.model` goes through it instead, so
 * there is no chain left for a stale row to enter.
 */
import type { AgentKind, ModelSetting, WorkspaceConfig } from '@agent-conductor/shared';
import { DEFAULT_WORKSPACE_MODELS } from '@agent-conductor/shared';

/** The setting that governs an agent of this kind. */
export function modelSettingFor(config: Pick<WorkspaceConfig, 'models'>, kind: AgentKind): ModelSetting {
  const models = config.models ?? DEFAULT_WORKSPACE_MODELS;
  return kind === 'conductor' ? models.conductor : models.workers;
}
