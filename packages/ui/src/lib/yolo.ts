/**
 * YOLO mode (PLAN §15, VS-382) as the web app sees it. It is a per-project setting: the daemon
 * resolves it from a project's `policies.yolo` alone, and so does this, so a card can never claim a
 * decision will be auto-approved when the daemon would not grant it.
 */
import { yoloEnabled, type Decision, type Project } from '@weave-ai/shared';

/** Whether the mode is on for one project; a project that has not set it is off. */
export function projectYolo(project: Pick<Project, 'policies'> | null | undefined): boolean {
  return yoloEnabled(project?.policies ?? null);
}

/** Only these two kinds are ever granted by the daemon; everything else still needs the human. */
const AUTO_APPROVED_KINDS = new Set<Decision['kind']>(['plan_approval', 'merge_approval']);

/**
 * Whether this open decision is one the daemon will grant, so no approve action should be offered
 * for it. `project` is the project of the decision's ticket; a decision with no ticket, or whose
 * project has not loaded yet, is not auto-approving.
 */
export function isAutoApproving(
  decision: Pick<Decision, 'kind' | 'status'>,
  project?: Pick<Project, 'policies'> | null,
): boolean {
  if (decision.status !== 'open') return false;
  if (!AUTO_APPROVED_KINDS.has(decision.kind)) return false;
  return projectYolo(project);
}
