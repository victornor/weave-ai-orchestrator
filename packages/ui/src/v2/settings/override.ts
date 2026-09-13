/**
 * The workspace-override model (VS-348, HANDOFF §9): compare a workspace's effective setting for an
 * agent or worker option against the daemon's baseline for that control, and name the difference.
 *
 * The comparison is value-based, not a stored inherit flag: the API has no endpoint that clears one
 * workspace field back to inherit (`PUT /models` requires both agents), so "reset to daemon" writes
 * the baseline value and a control reads `inherited` again once it equals the baseline. See the
 * change's design.md, Decision 4.
 */
import { DEFAULT_MODEL_SETTING } from '@weave-ai/shared';
import type { DaemonModels, ModelSetting, WorkerModelOption } from '../../api/types';

export type AgentKind = 'weaver' | 'workers';
export type OverrideState = 'inherited' | 'overridden';
export type ModelLike = { runtime: string | null; model: string | null; effort?: string };

function norm(v: string | null | undefined): string {
  return v ?? '';
}

/** Structural equality of the three fields that decide which model a turn runs on. */
export function sameSetting(a: ModelLike, b: ModelLike): boolean {
  return norm(a.runtime) === norm(b.runtime) && norm(a.model) === norm(b.model) && norm(a.effort) === norm(b.effort);
}

/** The daemon's value for an agent: its overlay, else the built-in default. */
export function baselineAgent(daemon: DaemonModels | undefined, kind: AgentKind): ModelSetting {
  return daemon?.[kind] ?? DEFAULT_MODEL_SETTING;
}

export function agentOverrideState(effective: ModelSetting, baseline: ModelSetting): OverrideState {
  return sameSetting(effective, baseline) ? 'inherited' : 'overridden';
}

/** The fields that differ, as "runtime: a → b" lines; empty when the values are equal. */
export function diffSetting(effective: ModelLike, baseline: ModelLike): string[] {
  const out: string[] = [];
  if (norm(effective.runtime) !== norm(baseline.runtime)) out.push(`runtime ${baseline.runtime ?? 'not chosen'} → ${effective.runtime ?? 'not chosen'}`);
  if (norm(effective.model) !== norm(baseline.model)) out.push(`model ${baseline.model ?? 'default'} → ${effective.model ?? 'default'}`);
  if (norm(effective.effort) !== norm(baseline.effort)) out.push(`thinking ${baseline.effort ?? 'default'} → ${effective.effort ?? 'default'}`);
  return out;
}

/** The daemon option a workspace option overrides, matched by id; undefined when the daemon has none. */
export function baselineOption(daemon: DaemonModels | undefined, id: string): WorkerModelOption | undefined {
  return daemon?.workerOptions?.find((o) => o.id === id);
}

export function optionOverrideState(effective: WorkerModelOption, baseline: WorkerModelOption | undefined): OverrideState {
  if (!baseline) return 'inherited';
  return sameSetting(effective, baseline) ? 'inherited' : 'overridden';
}

export function diffOption(effective: WorkerModelOption, baseline: WorkerModelOption | undefined): string[] {
  return baseline ? diffSetting(effective, baseline) : [];
}

export interface OverrideCounts {
  agents: number;
  options: number;
}

/** One source for the banner count, derived from the same comparison the tags and footers use. */
export function countOverrides(
  effective: { weaver: ModelSetting; workers: ModelSetting; workerOptions?: WorkerModelOption[] },
  daemon: DaemonModels | undefined,
): OverrideCounts {
  let agents = 0;
  if (agentOverrideState(effective.weaver, baselineAgent(daemon, 'weaver')) === 'overridden') agents += 1;
  if (agentOverrideState(effective.workers, baselineAgent(daemon, 'workers')) === 'overridden') agents += 1;
  const options = (effective.workerOptions ?? []).filter((o) => optionOverrideState(o, baselineOption(daemon, o.id)) === 'overridden').length;
  return { agents, options };
}
