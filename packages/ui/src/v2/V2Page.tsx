/**
 * The V2 page frame — the 38px header (HANDOFF §3) every destination renders, and the one-source
 * counts behind it. Screen tickets fill the body; this ticket ships the frame with a placeholder.
 */
import { useMemo, type ReactNode } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { useDecisionsMany, useIncidents, useWorkersMany, useWorkspaces } from '../api/hooks';
import { OPEN_HUMAN_DECISIONS } from '../api/events';
import { liveWorkingAgents } from '../lib/board';
import { agentIsWorking, useRunningWorkerIds } from '../lib/liveOrder';
import { deriveV2Counts, type V2Counts } from './v2Counts';
import { workspaceFromV2Path, type V2Scope } from './nav';

export type { V2Counts } from './v2Counts';

export function useV2Scope(): V2Scope {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const ws = workspaceFromV2Path(path);
  return ws ? { kind: 'workspace', ws } : { kind: 'everywhere' };
}

export function useV2WorkspaceName(scope: V2Scope): string {
  const workspaces = useWorkspaces();
  if (scope.kind !== 'workspace') return 'Everywhere';
  const found = (workspaces.data ?? []).find((w) => w.id === scope.ws);
  return found?.name ?? scope.ws;
}

/**
 * Every count a V2 header or rail row can show, derived from the same hooks the screens use
 * (HANDOFF §15). The shell's rail sits above `V2Workspace`'s `WorkspaceProvider`, so nothing here
 * may resolve a workspace from that provider: the workspace list is read at the root and each
 * per-workspace figure fans out explicitly.
 *
 * This wrapper exists only to make the hook calls; the counting rules are the pure
 * `deriveV2Counts` (VS-667), so they can be tested with plain data.
 */
export function useV2Counts(scope: V2Scope): V2Counts {
  const workspaces = useWorkspaces();
  const listed = workspaces.data ?? [];
  const ids = useMemo(() => listed.map((w) => w.id), [listed]);

  // Live is the daemon-wide roster — the same predicate the Live screen renders.
  const workerQueries = useWorkersMany(ids);
  // Needs you is the open human decisions captain can act on, the array `V2NeedsScreen` renders. A
  // plan, merge or action card the weaver has not reviewed yet is left out: its answer is refused
  // until the weaver marks it, so counting it would promise an action captain cannot take (VS-411).
  // Until a query answers, the listed `needsYou` (the daemon's own per-workspace count) stands in, so
  // the badge is present on first paint rather than flashing to zero.
  const decisionQueries = useDecisionsMany(ids, OPEN_HUMAN_DECISIONS);
  const incidents = useIncidents();

  // VS-415: the same working set the Live floor renders — an in-flight run, plus the handover grace.
  // One hook call over the union of every workspace's working workers; the grace is per worker id, so
  // the per-workspace breakdown comes from the same set.
  const workerLists = useMemo(() => workerQueries.map((q) => q.data ?? []), [workerQueries]);
  const activeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const list of workerLists) for (const a of liveWorkingAgents(list)) if (agentIsWorking(a.status)) ids.add(a.id);
    return ids;
  }, [workerLists]);
  const workingIds = useRunningWorkerIds(activeIds);
  const decisions = useMemo(() => decisionQueries.map((q) => q.data), [decisionQueries]);

  return useMemo(
    () =>
      deriveV2Counts({
        scope,
        listed,
        decisions,
        workers: workerLists,
        workingIds,
        incidents: (incidents.data?.items ?? []).filter((i) => i.resolvedAt === null).length,
      }),
    [scope, listed, decisions, workerLists, workingIds, incidents.data],
  );
}

function Pill({ tone, label }: { tone: 'working' | 'needs-you' | 'blocked'; label: string }): React.ReactElement {
  const dot = tone === 'working' ? 'bg-working' : tone === 'needs-you' ? 'bg-needs-you' : 'bg-blocked';
  return (
    <span className="flex flex-none items-center gap-1.5 rounded-r4 border border-line-1 bg-bg-2 px-2 py-1">
      <span className={`size-1.5 flex-none rounded-pill ${dot}`} aria-hidden />
      <span className="ac-mono whitespace-nowrap text-micro text-text-2">{label}</span>
    </span>
  );
}

export interface V2PageProps {
  title: string;
  subtitle?: string;
  /** A screen's own controls for the 38px header (e.g. Usage's window and grain picker). They sit
   *  beside the label and the one-source counts; supplying them does not change either. */
  actions?: ReactNode;
  /** A fixed sub-navigation row under the header (e.g. Knowledge's tab row). It does not scroll with
   *  the body, so a tab stays visible however long the body is. */
  subnav?: ReactNode;
  /**
   * Whether this page's body is the single scroll container (default). A screen that fills the
   * frame and scrolls its own region — chips pinned, list scrolling (HANDOFF §8), or an iframe
   * filling the body (the V2 plugin page, VS-385) — passes `false`, so the shell bounds the frame
   * and there is exactly one scroll container, never two nested.
   */
  scroll?: boolean;
  children?: ReactNode;
}

export function V2Page({ title, subtitle, actions, subnav, scroll = true, children }: V2PageProps): React.ReactElement {
  const scope = useV2Scope();
  const root = useV2WorkspaceName(scope);
  const counts = useV2Counts(scope);
  // A workspace page shows its own working count; a global page the daemon-wide one (VS-415).
  const live = scope.kind === 'workspace' ? (counts.liveByWs[scope.ws] ?? 0) : counts.live;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-[38px] flex-none items-center gap-3 border-b border-line-1 bg-bg-0 px-4">
        <span className="text-ui text-text-3">{root}</span>
        <span className="text-ui text-text-4" aria-hidden>
          ›
        </span>
        <h1 className="text-ui font-medium tracking-[-0.005em] text-text-1">{title}</h1>
        {subtitle ? <span className="truncate text-meta text-text-3">{subtitle}</span> : null}
        <div className="ml-auto flex flex-none items-center gap-2">
          {actions}
          {live > 0 ? <Pill tone="working" label={`${live} running`} /> : null}
          {counts.needs > 0 ? <Pill tone="needs-you" label={`${counts.needs} need you`} /> : null}
        </div>
      </header>
      {subnav ? <div className="flex-none border-b border-line-1 bg-bg-0">{subnav}</div> : null}
      <div
        data-v2-page-body={scroll ? 'scroll' : 'fill'}
        className={scroll ? 'min-h-0 flex-1 overflow-y-auto' : 'flex min-h-0 flex-1 flex-col overflow-hidden'}
      >
        {children ?? <V2Placeholder title={title} />}
      </div>
    </div>
  );
}

/** What a destination shows until its screen ticket fills it. */
export function V2Placeholder({ title }: { title: string }): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <p className="max-w-md text-center text-ui text-text-3">
        {title} — the V2 shell is in place. This screen is filled by its own ticket.
      </p>
    </div>
  );
}
