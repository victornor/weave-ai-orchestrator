/**
 * The workspace-override model (VS-348, VS-356): an agent setting or the worker-options catalog is
 * `inherited` or `overridden` from the per-control source the API reports, not by comparing values.
 * `diffSetting`/`diffOption` still name the values that differ, which needs the daemon baseline.
 */
import { DEFAULT_MODEL_SETTING } from '@weave-ai/shared';
import type { DaemonModels, ModelSetting, WorkspaceModelsSource, WorkerModelOption } from '../../api/types';

export type AgentKind = 'weaver' | 'workers';
export type OverrideState = 'inherited' | 'overridden';
export type ModelLike = { runtime: string | null; model: string | null; effort?: string; compaction?: { mode: string; value?: number } };

function norm(v: string | null | undefined): string {
  return v ?? '';
}

/** The daemon's value for an agent: its overlay, else the built-in default. Used for the diff footer. */
export function baselineAgent(daemon: DaemonModels | undefined, kind: AgentKind): ModelSetting {
  return daemon?.[kind] ?? DEFAULT_MODEL_SETTING;
}

/** An agent control is overridden when the API says the workspace stores its own value for it. */
export function agentOverrideState(source: WorkspaceModelsSource | undefined, kind: AgentKind): OverrideState {
  return source?.[kind] === 'workspace' ? 'overridden' : 'inherited';
}

/** The catalog overrides as a whole: overridden when the workspace stores its own non-empty catalog. */
export function optionOverrideState(source: WorkspaceModelsSource | undefined): OverrideState {
  return source?.workerOptions === 'workspace' ? 'overridden' : 'inherited';
}

/** The fields that differ, as "runtime: a → b" lines; empty when the values are equal. */
export function diffSetting(effective: ModelLike, baseline: ModelLike): string[] {
  const out: string[] = [];
  if (norm(effective.runtime) !== norm(baseline.runtime)) out.push(`runtime ${baseline.runtime ?? 'not chosen'} → ${effective.runtime ?? 'not chosen'}`);
  if (norm(effective.model) !== norm(baseline.model)) out.push(`model ${baseline.model ?? 'default'} → ${effective.model ?? 'default'}`);
  if (norm(effective.effort) !== norm(baseline.effort)) out.push(`thinking ${baseline.effort ?? 'default'} → ${effective.effort ?? 'default'}`);
  if (describeCompaction(effective.compaction) !== describeCompaction(baseline.compaction)) out.push(`auto-compact ${describeCompaction(baseline.compaction)} → ${describeCompaction(effective.compaction)}`);
  return out;
}

function describeCompaction(c: { mode: string; value?: number } | undefined): string {
  if (!c || c.mode === 'off') return 'off';
  return `${c.value ?? '?'}${c.mode === 'percent' ? '%' : ' tok'}`;
}

/** The daemon option a workspace option is compared against, matched by id; undefined when the daemon has none. */
export function baselineOption(daemon: DaemonModels | undefined, id: string): WorkerModelOption | undefined {
  return daemon?.workerOptions?.find((o) => o.id === id);
}

export function diffOption(effective: WorkerModelOption, baseline: WorkerModelOption | undefined): string[] {
  return baseline ? diffSetting(effective, baseline) : [];
}

export interface OverrideCounts {
  agents: number;
  options: number;
}

/** One source for the banner count: the controls the same source map the tags use marks overridden. */
export function countOverrides(source: WorkspaceModelsSource | undefined): OverrideCounts {
  let agents = 0;
  if (source?.weaver === 'workspace') agents += 1;
  if (source?.workers === 'workspace') agents += 1;
  return { agents, options: source?.workerOptions === 'workspace' ? 1 : 0 };
}
