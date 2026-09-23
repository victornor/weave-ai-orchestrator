/**
 * The one derivation behind every count a V2 header or rail row can show (HANDOFF §15), extracted
 * from `useV2Counts` (VS-667) so the two counting rules can be asserted with plain data rather than
 * through a mocked hook tree:
 *
 * - **Needs you** counts the open human decisions the array `V2NeedsScreen` renders, excluding a
 *   card the weaver has not reviewed (`countsAsNeeds`); until a read answers, the workspace list's
 *   own `needsYou` stands in.
 * - **Live** is the shared working set `liveCounts` derives — an in-flight run, or a worker inside
 *   the between-turns handover grace — over the same lists the Live floor renders.
 *
 * Pure: the hook calls live in `useV2Counts`, and this receives their data.
 */
import type { Agent, Decision } from '@weave-ai/shared';
import { liveCounts } from '../lib/liveOrder';
import { countsAsNeeds } from './needsCount';
import type { V2Scope } from './nav';

/** The fields the per-workspace fan-out needs: its id and the daemon's fallback count. */
export interface CountableWorkspace {
  id: string;
  needsYou: number;
}

export interface V2Counts {
  /** The current scope's Needs-you figure — what the header's pill shows. */
  needs: number;
  /** Every workspace's own Needs-you count, keyed by workspace id. */
  needsByWs: Record<string, number>;
  /** The daemon-wide Needs-you total. */
  needsGlobal: number;
  /** Workers whose card reads working across every workspace — an in-flight run, or one inside the
   *  handover grace the Live floor applies (VS-415). */
  live: number;
  /** Each workspace's own working count, keyed by workspace id. */
  liveByWs: Record<string, number>;
  incidents: number;
}

export interface V2CountsInputs {
  scope: V2Scope;
  /** The listed workspaces, in order; every per-list array below is aligned with this. */
  listed: readonly CountableWorkspace[];
  /** Per listed workspace: the open human decisions read, or undefined until it answers. */
  decisions: readonly (readonly Decision[] | undefined)[];
  /** Per listed workspace: the worker read, or undefined until it answers. */
  workers: readonly (readonly Pick<Agent, 'id' | 'status'>[] | undefined)[];
  /** Ids that count as running: an in-flight run, or a worker inside the handover grace. */
  workingIds: ReadonlySet<string>;
  incidents: number;
}

export function deriveV2Counts({ scope, listed, decisions, workers, workingIds, incidents }: V2CountsInputs): V2Counts {
  const needsByWs: Record<string, number> = {};
  let needsGlobal = 0;
  listed.forEach((w, i) => {
    const read = decisions[i];
    const needs = read ? read.filter(countsAsNeeds).length : w.needsYou;
    needsByWs[w.id] = needs;
    needsGlobal += needs;
  });
  const needs = scope.kind === 'workspace' ? (needsByWs[scope.ws] ?? 0) : needsGlobal;

  // The same `liveCounts` the Live floor's roster figure uses, so a badge and the floor it points to
  // count one working set through one function.
  const lists = workers.map((list) => list ?? []);
  const { total: live, perList } = liveCounts(lists, workingIds);
  const liveByWs: Record<string, number> = {};
  listed.forEach((w, i) => {
    liveByWs[w.id] = perList[i] ?? 0;
  });

  return { needs, needsByWs, needsGlobal, live, liveByWs, incidents };
}
