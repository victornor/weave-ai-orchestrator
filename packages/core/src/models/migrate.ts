/**
 * Bringing a workspace configured under the old layered scheme onto the two model settings
 * (VS-77, ADR 0011).
 *
 * The derivation is pure and reads the **raw** YAML document, not a parsed `WorkspaceConfig`: Zod
 * strips unknown keys, so `defaults.runtime`, `conductor.model` and the rest are already gone by the
 * time a parsed config exists. The loader does the I/O; this decides.
 */
import type { ModelSetting, WorkspaceModels } from '@weave-ai/shared';
import { ModelSettingSchema } from '@weave-ai/shared';

/** A role as the derivation needs it: what that role was actually running on. */
export interface RoleRuntimeRow { runtimeId: string | null; model: string | null; effort: string | null }

/** Which rule produced the workers setting, for the log line and for the card. */
export type WorkersRule = 'roles' | 'roles_mixed' | 'defaults' | 'weaver';

export interface ModelMigration {
  models: WorkspaceModels;
  /** How many roles were on each runtime, most first. Empty when the workspace has hired none. */
  counts: Array<{ runtime: string; roles: number }>;
  rule: WorkersRule;
  /** True when the roles disagreed: the workers runtime was picked, not settled. */
  ambiguous: boolean;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

/** `model` is nullable and `null` means "the runtime chooses", which is different from "not set". */
function modelOf(block: Record<string, unknown> | undefined): string | null | undefined {
  if (!block || !('model' in block)) return undefined;
  const v = block['model'];
  if (v === null) return null;
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function blockOf(raw: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = raw[key];
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function setting(runtime: string | undefined, model: string | null | undefined, effort: string | undefined): ModelSetting {
  return ModelSettingSchema.parse({ ...(runtime ? { runtime } : {}), ...(model === undefined ? {} : { model }), ...(effort ? { effort } : {}) });
}

/**
 * Derive the two settings from a raw `workspace.yaml` and the workspace's roles.
 *
 * - weaver ← the raw `conductor` block, then the raw `defaults`, then the schema defaults.
 * - workers ← the runtime and model the roles actually used (the live value; `defaults.runtime` was
 *   only what a *new* project inherited), then the raw `defaults`, then the weaver's runtime with
 *   no model.
 *
 * Roles are counted by runtime. A tie or a disagreement is `ambiguous`: the most used runtime is
 * still written, because the daemon has to be able to run a turn, and the caller raises a card.
 */
export function deriveModelSettings(raw: Record<string, unknown>, roles: RoleRuntimeRow[]): ModelMigration {
  const rawDefaults = blockOf(raw, 'defaults');
  const rawConductor = blockOf(raw, 'conductor');

  const weaver = setting(
    str(rawConductor?.['runtime']) ?? str(rawDefaults?.['runtime']),
    modelOf(rawConductor) ?? modelOf(rawDefaults),
    str(rawConductor?.['effort']),
  );

  const byRuntime = new Map<string, RoleRuntimeRow[]>();
  for (const r of roles) {
    if (!r.runtimeId) continue;
    const list = byRuntime.get(r.runtimeId) ?? [];
    list.push(r);
    byRuntime.set(r.runtimeId, list);
  }
  // Most roles first, then alphabetically, so a tie resolves the same way on every load.
  const counts = [...byRuntime.entries()]
    .map(([runtime, rows]) => ({ runtime, roles: rows.length }))
    .sort((a, b) => b.roles - a.roles || a.runtime.localeCompare(b.runtime));

  let workers: ModelSetting;
  let rule: WorkersRule;
  const top = counts[0];
  if (top) {
    // The model and effort of the roles on the winning runtime, when they agree; otherwise the
    // runtime's own choice, which is what a role with no model override already got.
    const rows = byRuntime.get(top.runtime)!;
    const models = new Set(rows.map((r) => r.model ?? null));
    const efforts = new Set(rows.map((r) => r.effort ?? null));
    workers = setting(
      top.runtime,
      models.size === 1 ? [...models][0] : null,
      efforts.size === 1 ? ([...efforts][0] ?? undefined) : undefined,
    );
    rule = counts.length > 1 ? 'roles_mixed' : 'roles';
  } else if (str(rawDefaults?.['runtime']) || modelOf(rawDefaults) !== undefined) {
    workers = setting(str(rawDefaults?.['runtime']), modelOf(rawDefaults), undefined);
    rule = 'defaults';
  } else {
    workers = setting(weaver.runtime, null, undefined);
    rule = 'weaver';
  }

  return { models: { weaver, workers, workerOptions: [] }, counts, rule, ambiguous: rule === 'roles_mixed' };
}

/** Whether this document has already been migrated. A `models` block is the marker. */
export function hasModelSettings(raw: Record<string, unknown>): boolean {
  return blockOf(raw, 'models') !== undefined;
}

/** One line for the log, saying what was chosen and why. */
export function migrationSummary(m: ModelMigration): string {
  const why = {
    roles: 'every role used it',
    roles_mixed: 'the most of its roles used it, and the rest disagreed',
    defaults: 'the workspace default said so and no role had been hired',
    weaver: 'nothing else named one, so it follows the weaver',
  }[m.rule];
  return `workers on ${m.models.workers.runtime} because ${why}`;
}
