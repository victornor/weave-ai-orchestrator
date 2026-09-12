/**
 * VS-249: what changed in a worker's worktree and session while a human held it — shared by
 * `WorkersService.endHandover` (a human's own handback) and the supervisor's abandonment sweep
 * (`session-handover/lease`), so a held session's two possible endings compute the same facts the
 * same way and differ only in what note and status they record.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Agent } from '@weave-ai/shared';
import type { WorkspaceContext } from '../context.js';
import type { HandoverReconciliation } from '../api.js';
import { git } from '../util/git.js';
import { sessionActivitySignal } from './activity-signal.js';

export interface HandoverSnapshot {
  worktreeHead: string | null;
  runtimeId: string;
  lastActivitySignal: string | null;
  startedAt: string;
}

export async function reconcileHandover(ctx: WorkspaceContext, agent: Agent, hold: HandoverSnapshot): Promise<HandoverReconciliation> {
  let headAfter: string | null = null;
  let dirty = false;
  let changedFiles = 0;
  let newCommits = 0;
  if (agent.worktreePath && existsSync(agent.worktreePath)) {
    const head = await git(['rev-parse', 'HEAD'], agent.worktreePath, 15_000);
    headAfter = head.ok ? head.stdout.trim() : null;
    const status = await git(['status', '--porcelain'], agent.worktreePath, 20_000);
    if (status.ok) {
      const lines = status.stdout.split('\n').filter((l) => l.trim().length > 0);
      dirty = lines.length > 0;
      changedFiles = lines.length;
    }
    if (hold.worktreeHead && headAfter && hold.worktreeHead !== headAfter) {
      const count = await git(['rev-list', '--count', `${hold.worktreeHead}..${headAfter}`], agent.worktreePath, 20_000);
      newCommits = count.ok ? (Number(count.stdout.trim()) || 0) : 0;
    }
  }

  const configHome = join(ctx.paths.runtimesHome, hold.runtimeId);
  const signalNow = sessionActivitySignal(configHome);
  const sessionActivityDetected = hold.lastActivitySignal !== null ? signalNow !== hold.lastActivitySignal : signalNow !== null;

  return {
    worktree: { headBefore: hold.worktreeHead, headAfter, newCommits, dirty, changedFiles },
    sessionActivityDetected,
    durationMs: Date.now() - Date.parse(hold.startedAt),
  };
}

/** The ticket comment body a handback (human or automatic) leaves — one shared formatter for both endings. */
export function handoverCommentBody(agent: Agent, reconciliation: HandoverReconciliation, note: string, autoClosed: boolean): string {
  const { worktree, sessionActivityDetected, durationMs } = reconciliation;
  const minutes = Math.round(durationMs / 60_000);
  const lines = [
    autoClosed
      ? `${agent.name}'s session, held by a human, was returned automatically after being abandoned (${minutes} min).`
      : `${agent.name}'s session was handed back after ${minutes} min held by a human.`,
    worktree.newCommits > 0
      ? `Worktree: ${worktree.newCommits} new commit(s) landed while it was held${worktree.dirty ? `, ${worktree.changedFiles} file(s) left uncommitted` : ''}.`
      : worktree.dirty
        ? `Worktree: no new commits, but ${worktree.changedFiles} file(s) are left uncommitted.`
        : 'Worktree: unchanged.',
    sessionActivityDetected ? 'Session: activity was recorded outside the daemon.' : 'Session: no activity detected.',
    `Note: ${note}`,
  ];
  return lines.join('\n');
}
