/**
 * VS-667: does a workspace's live-only `worker.activity` frame mean its mounted worker read is
 * stale? The frame names one worker and whether it currently holds a live turn; when the cached
 * row's own status already agrees — or the read does not know the worker — nothing needs re-reading.
 * Pure, so the reconciliation's decision is testable without a stream or a query client.
 */
import type { AgentStatus } from '@weave-ai/shared';
import { agentIsWorking } from './liveOrder';

export interface CachedWorkerLive {
  id: string;
  status: AgentStatus;
}

export interface WorkerActivityFrame {
  agentId?: string | undefined;
  live?: { state: string } | null | undefined;
}

export function workerFrameNeedsResync(frame: WorkerActivityFrame, cached: readonly CachedWorkerLive[] | undefined): boolean {
  if (!cached || !frame.agentId) return false;
  const row = cached.find((w) => w.id === frame.agentId);
  if (!row) return false;
  return Boolean(frame.live) !== agentIsWorking(row.status);
}
