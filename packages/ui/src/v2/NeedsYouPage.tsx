/**
 * The global V2 Needs you screen (web-v2/needs-you).
 *
 * Every open human decision across the workspaces, each rendered as the complete V2 decision card.
 * Scope filters lead (`Everywhere` then each workspace), decision-kind chips follow, and the count
 * shown is the length of the one filtered array the list renders — never a second figure.
 *
 * The screen at `/w/:ws/needs` and the one at `/needs` are the same page: the scope starts
 * from the route (`useV2Scope`), which is how VS-343's workspace shortcut pre-applies it. It also
 * follows the route afterwards (VS-459): switching workspace reuses this mounted screen, so the chip
 * resets to whatever the new route names.
 */
import { useMemo, useState } from 'react';
import { projectLabel, type Decision, type DecisionAnswerInputs, type Ticket } from '@weave-ai/shared';
import { useAnswerDecision, useDecisionsMany, useTicketsMany, useWeaverMany, useWorkersMany, useWorkspaceProjects, useWorkspaces } from '../api/hooks';
import { NetworkError } from '../api/client';
import { enqueue } from '../lib/queue';
import { decisionCarriesSecret } from '../lib/decisionSecrets';
import { isClosedRefusal, staleAnswerCopy } from '../lib/decisionStaleness';
import { SkeletonCards } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { useV2Scope, V2Page } from './V2Page';
import { V2DecisionCard, type V2Answer } from './DecisionCard';
import { presentItems, useExitPresence } from './motion';
import { cx } from '../lib/cx';

interface ChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
  tone?: 'scope' | 'kind';
}

function Chip({ label, active, onClick, tone = 'kind' }: ChipProps): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'h-7 rounded-r4 border px-2.5 text-micro',
        active
          ? tone === 'scope'
            ? 'border-accent-edge bg-accent-tint text-text-1'
            : 'border-accent-edge text-text-1'
          : 'border-line-2 text-text-3 hover:text-text-1',
      )}
    >
      {label}
    </button>
  );
}

const KIND_LABEL: Record<string, string> = {
  plan_approval: 'Plans',
  merge_approval: 'Merges',
  action_approval: 'Actions',
  hire_approval: 'Hires',
  discard_approval: 'Discards',
  retry_approval: 'Retries',
  question: 'Questions',
  concern: 'Concerns',
  gate_finding: 'Gate findings',
  approval: 'Approvals',
};

/** A stable, kind-ordered list of the kinds actually present, so every chip filters real data. */
function kindsPresent(decisions: readonly Decision[]): string[] {
  const order = Object.keys(KIND_LABEL);
  const present = new Set<string>(decisions.map((d) => d.kind));
  return order.filter((k) => present.has(k));
}

/** The screen as a V2 destination: the standard header over the Needs you body. */
export function V2NeedsPage(): React.ReactElement {
  return (
    <V2Page title="Needs you">
      <V2NeedsScreen />
    </V2Page>
  );
}

export function V2NeedsScreen(): React.ReactElement {
  const workspaces = useWorkspaces();
  const listed = workspaces.data ?? [];
  const ids = listed.map((w) => w.id);
  const scope = useV2Scope();
  // VS-459: `/w/$ws/needs` reuses this mounted screen when only `$ws` changes, so the route, not
  // the first mount, owns the scope chip. Reset it whenever the route's scope changes; a chip picked
  // on the page overrides the filter until the next route change.
  const routeScope = scope.kind === 'workspace' ? scope.ws : 'all';

  const [scopeFilter, setScopeFilter] = useState<string>(routeScope);
  const [routeScopeSeen, setRouteScopeSeen] = useState<string>(routeScope);
  if (routeScopeSeen !== routeScope) {
    setRouteScopeSeen(routeScope);
    setScopeFilter(routeScope);
  }
  const [kindFilter, setKindFilter] = useState<string>('all');
  // The design's Held chip: a filter over `weaverReviewStatus === 'concerns'`. It is one selection
  // with the kind chips — `heldOnly` and a non-`all` `kindFilter` never hold at the same time.
  const [heldOnly, setHeldOnly] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);

  const decisionsQueries = useDecisionsMany(ids, { status: 'open', owner: 'human' });
  const ticketQueries = useTicketsMany(ids, { limit: 300 });
  const projectsByWs = useWorkspaceProjects(ids);
  const weaverQueries = useWeaverMany(ids);
  const workerQueries = useWorkersMany(ids, { includeRetired: true });
  const answer = useAnswerDecision();

  // Decisions owned by the human are raised by the weaver (or the system), not a worker — a worker's
  // ask goes to the weaver. So a question here reads as the weaver asking when the asker is that
  // workspace's weaver, and neutral otherwise (a system-raised decision has no agent).
  const weaverByWs = useMemo(() => {
    const map = new Map<string, string>();
    ids.forEach((id, i) => {
      const agentId = weaverQueries[i]?.data?.agent?.id;
      if (agentId) map.set(id, agentId);
    });
    return map;
  }, [ids.join('\0'), weaverQueries]);

  // The asker's display name, so the card's meta line never shows a raw agent id (VS-403). A worker
  // comes from the workspace's worker list, the weaver from its own lookup.
  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const q of workerQueries) for (const w of q.data ?? []) map.set(w.id, w.name);
    for (const q of weaverQueries) {
      const agent = q.data?.agent;
      if (agent) map.set(agent.id, agent.name);
    }
    return map;
  }, [ids.join('\0'), workerQueries, weaverQueries]);

  const ticketsById = useMemo(() => {
    const map = new Map<string, Ticket>();
    for (const q of ticketQueries) for (const t of q.data ?? []) map.set(t.id, t);
    return map;
  }, [ticketQueries]);

  const all = useMemo(() => {
    const out: Decision[] = [];
    for (const q of decisionsQueries) for (const d of q.data ?? []) out.push(d);
    return out;
  }, [decisionsQueries]);
  // VS-427: an answered card is removed from the cache at once (VS-369); hold it for one animation so
  // it can animate out. Presence is taken before the filters, so switching a chip never animates a
  // filter change out — only a decision actually leaving the data does.
  const presence = useExitPresence(all, (d) => d.id);

  const loaded = Boolean(workspaces.data) && decisionsQueries.every((q) => q.data !== undefined || q.isError);
  const errored = decisionsQueries.every((q) => q.isError) && decisionsQueries.length > 0;

  const kinds = kindsPresent(all);
  // A decision carries the workspace's internal id; the route and the scope chips carry the slug.
  // Normalise to the slug before comparing, so the workspace-scoped screen is not silently empty.
  const slugOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of listed) {
      map.set(w.id, w.id);
      map.set(w.internalId, w.id);
    }
    return (workspaceId: string): string => map.get(workspaceId) ?? workspaceId;
  }, [listed]);
  const filtered = useMemo(
    () =>
      presence.filter(
        (e) =>
          (scopeFilter === 'all' || slugOf(e.item.workspaceId) === scopeFilter) &&
          (kindFilter === 'all' || e.item.kind === kindFilter) &&
          (!heldOnly || e.item.weaverReviewStatus === 'concerns'),
      ),
    [presence, scopeFilter, kindFilter, heldOnly, slugOf],
  );

  // Held is mutually exclusive with the kind chips: choosing one clears the other, so the row is a
  // single selection across `{Held, All, kind…}`.
  const chooseKind = (kind: string): void => {
    setKindFilter(kind);
    setHeldOnly(false);
  };
  const toggleHeld = (): void => {
    const next = !heldOnly;
    setHeldOnly(next);
    if (next) setKindFilter('all');
  };

  const onAnswer = (decision: Decision, a: V2Answer): void => {
    setAnswerError(null);
    const payload: { id: string; ws: string; key?: string; text?: string; inputs?: DecisionAnswerInputs; overrideHold?: boolean; overrideReason?: string } = {
      id: decision.id,
      ws: decision.workspaceId,
      ...a,
    };
    answer.mutate(payload, {
      onError: (e) => {
        if (e instanceof NetworkError && !decisionCarriesSecret(decision)) {
          enqueue({ kind: 'decision', path: `/decisions/${decision.id}/answer`, body: a, label: a.key ?? a.text ?? 'decision' });
          return;
        }
        // The decision was already closed elsewhere: the card is gone and any replacement the refetch
        // shows speaks for itself, so this is not an error (VS-369).
        if (isClosedRefusal(e)) return;
        const stale = staleAnswerCopy(e, decision.ticketId);
        setAnswerError(stale ? `${stale.title}: ${stale.detail}` : e.message);
      },
    });
  };

  if (workspaces.isError) {
    return <ErrorState code="WORKSPACES_QUERY_FAILED" message="Could not load workspaces." onRetry={() => void workspaces.refetch()} />;
  }
  if (!workspaces.data || !loaded) return <SkeletonCards count={2} />;
  if (errored) {
    return <ErrorState code="DECISIONS_STALE" message="Could not load what needs you." onRetry={() => void decisionsQueries[0]?.refetch()} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line-1 px-4 py-2">
        <Chip label="Everywhere" tone="scope" active={scopeFilter === 'all'} onClick={() => setScopeFilter('all')} />
        {listed.map((w) => (
          <Chip key={w.id} label={w.name} tone="scope" active={scopeFilter === w.id} onClick={() => setScopeFilter(w.id)} />
        ))}
        {kinds.length ? <span className="mx-1 h-4 w-px bg-line-2" aria-hidden /> : null}
        <Chip label="Held" active={heldOnly} onClick={toggleHeld} />
        <Chip label="All" active={kindFilter === 'all' && !heldOnly} onClick={() => chooseKind('all')} />
        {kinds.map((k) => (
          <Chip key={k} label={KIND_LABEL[k] ?? k} active={kindFilter === k} onClick={() => chooseKind(k)} />
        ))}
        <span className="ml-auto ac-mono text-micro text-text-3" aria-live="polite">
          {presentItems(filtered).length} waiting
        </span>
      </div>
      {answerError ? (
        <p className="border-b border-line-1 px-4 py-2 text-micro text-blocked" role="status">
          {answerError}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {all.length === 0 && !heldOnly ? (
          <EmptyState title="Nothing needs you right now." detail="Open decisions from every workspace show up here." />
        ) : filtered.length === 0 ? (
          heldOnly ? (
            <EmptyState title="Nothing is held." detail="No open decision here is held by the weaver." />
          ) : (
            <EmptyState title="Nothing in this filter." detail="Choose another scope or kind." />
          )
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            {filtered.map((e) => {
              const d = e.item;
              const ticket = d.ticketId ? ticketsById.get(d.ticketId) : undefined;
              const projects = projectsByWs[d.workspaceId]?.projects ?? [];
              const project = projects.find((p) => p.id === (d.projectId ?? undefined));
              return (
                <V2DecisionCard
                  key={d.id}
                  decision={d}
                  exiting={e.exiting}
                  ticketIdentifier={ticket?.identifier ?? d.ticketId}
                  delivery={ticket?.delivery ?? null}
                  projectLabel={project ? projectLabel(project) : null}
                  projectSlug={project?.slug ?? null}
                  ws={d.workspaceId}
                  askedBy={d.askedByAgentId}
                  askedByName={d.askedByAgentId ? agentNameById.get(d.askedByAgentId) ?? null : null}
                  asker={d.askedByAgentId && weaverByWs.get(d.workspaceId) === d.askedByAgentId ? 'weaver' : undefined}
                  busy={answer.isPending}
                  onAnswer={(a) => onAnswer(d, a)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
