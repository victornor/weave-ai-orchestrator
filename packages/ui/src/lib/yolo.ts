/**
 * YOLO mode (PLAN §15) as the web app sees it. The daemon resolves the same setting the same way
 * from `defaults.yolo` and a project's `policies.yolo`; both surfaces read it, neither stores it,
 * so a card can never claim a decision will be auto-approved when the daemon would not grant it.
 */
import { yoloEnabled, type Decision, type Project } from '@weave-ai/shared';

/** The workspace default, from the config `GET /api/w/:ws` already returns. */
export function workspaceYolo(config: Record<string, unknown> | undefined): boolean {
  const defaults = (config?.['defaults'] ?? {}) as { yolo?: unknown };
  return defaults.yolo === true;
}

/** Whether the mode is on for one project, which may override the workspace either way. */
export function projectYolo(config: Record<string, unknown> | undefined, project: Pick<Project, 'policies'> | null | undefined): boolean {
  return yoloEnabled(project?.policies ?? null, workspaceYolo(config));
}

/** Only these two kinds are ever granted by the daemon; everything else still needs the human. */
const AUTO_APPROVED_KINDS = new Set<Decision['kind']>(['plan_approval', 'merge_approval']);

/**
 * Whether this open decision is one the daemon will grant, so no approve action should be offered
 * for it. `project` is the project of the decision's ticket; a decision with no ticket, or whose
 * project has not loaded yet, falls back to the workspace setting.
 */
export function isAutoApproving(
  decision: Pick<Decision, 'kind' | 'status'>,
  config: Record<string, unknown> | undefined,
  project?: Pick<Project, 'policies'> | null,
): boolean {
  if (decision.status !== 'open') return false;
  if (!AUTO_APPROVED_KINDS.has(decision.kind)) return false;
  return projectYolo(config, project);
}
