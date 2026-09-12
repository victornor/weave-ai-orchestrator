/**
 * A project's pull requests, joined to what the daemon already knows about them (VS-97).
 *
 * Four facts that had never met: the forge has the pull requests, `ticket_work_products` says which
 * one is a ticket's, `tickets.openspec_change_name` says which change that ticket implements, and
 * the merge queue says what is landing. The join happens here, where the rows are, so no client has
 * to re-derive which pull request is whose from a page of tickets it may not have.
 *
 * Every forge call is a `gh` process on the daemon host, so a project's answer is cached for a few
 * minutes and dropped the moment one of that project's tickets records a work product or changes its
 * merge state — freshness comes from the events, not from a short window. Read-only throughout:
 * there is no member here that writes anything, to the forge or to the database.
 */
import { existsSync } from 'node:fs';
import type { ForgeAdapter, ForgePullRequest, ForgePullRequestDetail } from '@weave-ai/plugin-sdk';
import { nowIso } from '@weave-ai/db';
import type { EventType, Project, TicketStatus, WorkspaceEvent } from '@weave-ai/shared';
import { parseUnifiedDiff, type ParsedDiffFile } from '@weave-ai/render';
import type {
  CoreServices, DiffFileSummary, ProjectPullRequest, ProjectPullRequestDetail, ProjectPullRequests,
  PullRequestDetailResult, PullRequestDiffContextResult, PullRequestDiffFileResult,
  PullRequestDiffFilesResult, PullRequestTicket, PullRequestsService, PullRequestUnavailable,
} from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { branchExists, resolveBaseRef } from '../util/git.js';
import { computeCloneDiff, readFileAtRef } from './diff.js';

/** Long enough that opening, closing and re-opening an overview is one `gh` call; short enough to be a number, not a snapshot. */
export const PR_CACHE_TTL_MS = 180_000;
/** How far back a merged or closed pull request is still worth listing. */
export const PR_WINDOW_DAYS = 30;
/** `gh` has no "updated since" filter, so this is the ceiling on what the window can contain. */
export const PR_LIST_LIMIT = 60;

/** The events that can make a cached list wrong. Anything else leaves it alone. */
const INVALIDATING: readonly EventType[] = ['ticket.work_product', 'ticket.merged', 'ticket.status'];

interface CacheEntry {
  at: number;
  /** Absent when the last attempt could not produce a list; `reason` says why. */
  prs: ForgePullRequest[] | null;
  reason: PullRequestUnavailable | null;
  message: string | null;
  capturedAt: string;
  details: Map<number, ForgePullRequestDetail | null>;
  /** One PR's diff, parsed once and sliced per file from then on (VS-107). */
  diffs: Map<number, DiffCacheEntry>;
  /** A base-revision file's content, for the collapsed-region expand control — same clone read, whichever file asks. */
  baseFiles: Map<string, string[] | null>;
}

type DiffCacheEntry = { ok: true; parsed: ParsedDiffFile[] } | { ok: false; reason: PullRequestUnavailable; message: string | null };

interface WorkProductRow { url: string; ticketId: string; identifier: string; title: string; status: TicketStatus; changeName: string | null }
interface TicketRow { id: string; identifier: string; title: string; status: TicketStatus; changeName: string | null }
/** A pull request's ticket and the change that ticket implements, resolved together. */
interface Match { ticket: PullRequestTicket; changeName: string | null }
type QueuePlace = { state: 'landing' | 'waiting'; position: number | null };

/**
 * A worker branch is `ac/<identifier>-<slug>` (`ticketBranch`). The identifier is matched, never the
 * whole branch: a title edit changes the slug and the branch keeps the old one, so comparing the
 * whole string would silently lose the link it is supposed to find.
 */
const BRANCH_TICKET = /^ac\/([a-z][a-z0-9]*-\d+)-/i;

function identifierFromBranch(branch: string): string | null {
  const m = BRANCH_TICKET.exec(branch);
  return m?.[1] ? m[1].toUpperCase() : null;
}

/** A forge and a client can disagree about a trailing slash; nothing else about a PR URL varies. */
function normaliseUrl(url: string): string { return url.trim().replace(/\/+$/, ''); }

/** When a pull request stopped being open, for the 30-day window. Open ones are never windowed out. */
function closedInstant(pr: ForgePullRequest): number | null {
  const at = pr.mergedAt ?? pr.closedAt ?? pr.updatedAt;
  const t = at ? Date.parse(at) : NaN;
  return Number.isNaN(t) ? null : t;
}

function byUpdatedDesc(a: ForgePullRequest, b: ForgePullRequest): number {
  return (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);
}

export function createPullRequestsService(ctx: WorkspaceContext, deps: () => CoreServices): PullRequestsService {
  const log = ctx.log('ticket');
  const cache = new Map<string, CacheEntry>();

  // Freshness is event-driven: a shorter window would still be wrong for the three seconds that
  // matter, and this is exact. An event for a ticket in another project leaves that project alone.
  ctx.events.on((ev: WorkspaceEvent) => {
    if (!INVALIDATING.includes(ev.type) || ev.entityType !== 'ticket') return;
    const row = ctx.db.get<{ projectId: string | null }>('SELECT project_id FROM tickets WHERE id = ?', [ev.entityId]);
    if (row?.projectId) cache.delete(row.projectId);
  });

  function project(idOrSlug: string): Project { return deps().projects.get(idOrSlug); }

  /** Why this project cannot be asked, or `null` when it can. Ordered cheapest first. */
  async function unavailable(p: Project, forge: ForgeAdapter | undefined): Promise<PullRequestUnavailable | null> {
    if (!forge) return 'no_forge';
    if (!forge.listPullRequests) return 'unsupported';
    if (!existsSync(p.clonePath)) return 'no_clone';
    const authed = await forge.detect(p.clonePath).catch(() => false);
    return authed ? null : 'not_authenticated';
  }

  /** Read the forge, or say why not. Never throws: an unreachable forge is a reason, not an error. */
  async function fetchEntry(p: Project): Promise<CacheEntry> {
    const capturedAt = nowIso();
    const base = {
      at: Date.now(), capturedAt, details: new Map<number, ForgePullRequestDetail | null>(),
      diffs: new Map<number, DiffCacheEntry>(), baseFiles: new Map<string, string[] | null>(),
    };
    const forge = ctx.registries.forges.get('github');
    const why = await unavailable(p, forge);
    if (why) return { ...base, prs: null, reason: why, message: null };
    try {
      const prs = await forge!.listPullRequests!(p.clonePath, { limit: PR_LIST_LIMIT });
      return { ...base, prs, reason: null, message: null };
    } catch (e) {
      log.warn({ project: p.slug, err: String(e) }, 'listing pull requests failed');
      return { ...base, prs: null, reason: 'unreachable', message: String(e instanceof Error ? e.message : e).slice(0, 300) };
    }
  }

  /**
   * The cached forge answer, refreshed when the window has passed. A refresh that fails to produce a
   * list does not evict one that succeeded: a few minutes stale with a visible capture time beats an
   * error where a list used to be, which is the rule `accounts.refresh()` already follows for probes.
   */
  async function entryFor(p: Project): Promise<{ entry: CacheEntry; stale: boolean }> {
    const held = cache.get(p.id);
    if (held && Date.now() - held.at < PR_CACHE_TTL_MS) return { entry: held, stale: false };
    const fresh = await fetchEntry(p);
    if (!fresh.prs && held?.prs) {
      // Keep the good answer and let it age; only the reason for the failed refresh is discarded.
      return { entry: held, stale: true };
    }
    cache.set(p.id, fresh);
    return { entry: fresh, stale: false };
  }

  /** Everything the daemon can say about the tickets behind one page of pull requests. */
  function joinTickets(p: Project, prs: ForgePullRequest[]): Map<number, Match> {
    const out = new Map<number, Match>();
    if (!prs.length) return out;

    const byUrl = new Map<string, TicketRow>();
    for (const r of ctx.db.all<WorkProductRow>(
      `SELECT wp.url AS url, t.id AS ticket_id, t.identifier AS identifier, t.title AS title, t.status AS status,
              t.openspec_change_name AS change_name
         FROM ticket_work_products wp JOIN tickets t ON t.id = wp.ticket_id
        WHERE t.workspace_id = ? AND t.project_id = ? AND wp.type = 'pull_request' AND wp.url IS NOT NULL`,
      [ctx.workspaceId, p.id],
    )) {
      byUrl.set(normaliseUrl(r.url), { id: r.ticketId, identifier: r.identifier, title: r.title, status: r.status, changeName: r.changeName });
    }

    // Only the identifiers the branches actually name, so the fallback is one bounded query and not
    // a scan of every ticket the project has ever had.
    const wanted = [...new Set(prs.map((pr) => identifierFromBranch(pr.headRefName)).filter((v): v is string => v !== null))];
    const byIdentifier = new Map<string, TicketRow>();
    if (wanted.length) {
      const rows = ctx.db.all<TicketRow>(
        `SELECT id, identifier, title, status, openspec_change_name AS change_name
           FROM tickets WHERE workspace_id = ? AND project_id = ? AND identifier IN (${wanted.map(() => '?').join(',')})`,
        [ctx.workspaceId, p.id, ...wanted],
      );
      for (const r of rows) byIdentifier.set(r.identifier, r);
    }

    const matched = new Map<number, TicketRow>();
    for (const pr of prs) {
      const t = byUrl.get(normaliseUrl(pr.url)) ?? byIdentifier.get(identifierFromBranch(pr.headRefName) ?? '');
      if (t) matched.set(pr.number, t);
    }
    if (!matched.size) return out;

    // Which of those tickets has a plan, in one query: the detail links to it rather than rendering
    // a second plan viewer, so all it needs to know is whether the link should be there at all.
    const ids = [...new Set([...matched.values()].map((t) => t.id))];
    const planned = new Set(
      ctx.db.all<{ ticketId: string }>(
        `SELECT ticket_id FROM ticket_documents WHERE key = 'plan' AND ticket_id IN (${ids.map(() => '?').join(',')})`,
        ids,
      ).map((r) => r.ticketId),
    );

    for (const [number, t] of matched) {
      out.set(number, { ticket: { id: t.id, identifier: t.identifier, title: t.title, status: t.status, hasPlan: planned.has(t.id) }, changeName: t.changeName });
    }
    return out;
  }

  /** Where each ticket stands in this project's merge queue, by ticket id. */
  function joinQueue(projectId: string): Map<string, QueuePlace> {
    const out = new Map<string, QueuePlace>();
    try {
      const view = deps().tickets.mergeQueue.forProject(projectId);
      for (const e of view.active) out.set(e.ticketId, { state: 'landing', position: e.position });
      for (const e of view.waiting) out.set(e.ticketId, { state: 'waiting', position: e.position });
    } catch (e) {
      // A queue that cannot be read costs a badge, not the section.
      log.warn({ projectId, err: String(e) }, 'merge queue unavailable for the pull request list');
    }
    return out;
  }

  function decorate(pr: ForgePullRequest, matches: Map<number, Match>, queue: Map<string, QueuePlace>): ProjectPullRequest {
    const m = matches.get(pr.number) ?? null;
    return { ...pr, ticket: m?.ticket ?? null, changeName: m?.changeName ?? null, queue: m ? queue.get(m.ticket.id) ?? null : null };
  }

  async function list(projectIdOrSlug: string): Promise<ProjectPullRequests> {
    const p = project(projectIdOrSlug);
    const { entry, stale } = await entryFor(p);
    const shell = {
      projectId: p.id, windowDays: PR_WINDOW_DAYS, capturedAt: entry.capturedAt, stale,
      open: [] as ProjectPullRequest[], recent: [] as ProjectPullRequest[],
    };
    if (!entry.prs) return { ...shell, available: false, reason: entry.reason, message: entry.message };

    const { open, recent } = windowed(entry.prs);
    const matches = joinTickets(p, [...open, ...recent]);
    const queue = joinQueue(p.id);
    return {
      ...shell, available: true, reason: null, message: null,
      open: open.map((pr) => decorate(pr, matches, queue)),
      recent: recent.map((pr) => decorate(pr, matches, queue)),
    };
  }

  /** Open first, then whatever closed inside the window, each group most recently updated first. */
  function windowed(prs: ForgePullRequest[]): { open: ForgePullRequest[]; recent: ForgePullRequest[] } {
    const cutoff = Date.now() - PR_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const open = prs.filter((pr) => pr.state === 'open').sort(byUpdatedDesc);
    const recent = prs
      .filter((pr) => pr.state !== 'open')
      .filter((pr) => { const t = closedInstant(pr); return t !== null && t >= cutoff; })
      .sort(byUpdatedDesc);
    return { open, recent };
  }

  async function get(projectIdOrSlug: string, number: number): Promise<PullRequestDetailResult> {
    const p = project(projectIdOrSlug);
    const { entry, stale } = await entryFor(p);
    if (!entry.prs) return { projectId: p.id, available: false, reason: entry.reason, message: entry.message, stale, pullRequest: null };

    const forge = ctx.registries.forges.get('github');
    if (!forge?.pullRequest) return { projectId: p.id, available: false, reason: 'unsupported', message: null, stale, pullRequest: null };

    let detail = entry.details.get(number);
    if (detail === undefined) {
      try {
        detail = await forge.pullRequest(p.clonePath, number);
        entry.details.set(number, detail);
      } catch (e) {
        log.warn({ project: p.slug, number, err: String(e) }, 'reading a pull request failed');
        return { projectId: p.id, available: false, reason: 'unreachable', message: String(e instanceof Error ? e.message : e).slice(0, 300), stale, pullRequest: null };
      }
    }
    if (!detail) return { projectId: p.id, available: true, reason: null, message: null, stale, pullRequest: null };

    const decorated = decorate(detail, joinTickets(p, [detail]), joinQueue(p.id));
    const full: ProjectPullRequestDetail = { ...decorated, body: detail.body, files: detail.files, checkRuns: detail.checkRuns };
    return { projectId: p.id, available: true, reason: null, message: null, stale, pullRequest: full };
  }

  function toSummary(f: ParsedDiffFile): DiffFileSummary {
    return { path: f.path, previousPath: f.previousPath, status: f.status, additions: f.additions, deletions: f.deletions, binary: f.binary, tooLarge: f.tooLarge };
  }

  /**
   * The forge first, when it can supply a diff at all; the daemon's own clone otherwise, and only
   * when the pull request's head branch actually lives there — true for every worker branch, false
   * for a fork we never fetched. Neither source answering is `no_local_branch`, not an error: it is a
   * settled statement about this particular pull request, the same rule `unavailable()` follows for
   * the list as a whole.
   */
  async function diffTextFor(p: Project, pr: ForgePullRequest): Promise<{ ok: true; text: string } | { ok: false; reason: PullRequestUnavailable; message: string | null }> {
    const forge = ctx.registries.forges.get('github');
    if (forge?.pullRequestDiff) {
      try {
        const text = await forge.pullRequestDiff(p.clonePath, pr.number);
        if (text !== null) return { ok: true, text };
      } catch (e) {
        log.warn({ project: p.slug, number: pr.number, err: String(e) }, 'reading a pull request diff from the forge failed');
      }
    }
    if (existsSync(p.clonePath) && await branchExists(p.clonePath, pr.headRefName)) {
      const base = (await resolveBaseRef(p.clonePath, pr.baseRefName)) ?? pr.baseRefName;
      try {
        const text = await computeCloneDiff(p.clonePath, base, pr.headRefName);
        return { ok: true, text };
      } catch (e) {
        return { ok: false, reason: 'unreachable', message: String(e instanceof Error ? e.message : e).slice(0, 300) };
      }
    }
    return { ok: false, reason: 'no_local_branch', message: null };
  }

  /** Fetched and parsed once per pull request per cache window; every file comes out of this one parse. */
  async function diffEntryFor(p: Project, entry: CacheEntry, pr: ForgePullRequest): Promise<DiffCacheEntry> {
    const held = entry.diffs.get(pr.number);
    if (held) return held;
    const result = await diffTextFor(p, pr);
    const computed: DiffCacheEntry = result.ok ? { ok: true, parsed: parseUnifiedDiff(result.text) } : { ok: false, reason: result.reason, message: result.message };
    entry.diffs.set(pr.number, computed);
    return computed;
  }

  async function diffFiles(projectIdOrSlug: string, number: number): Promise<PullRequestDiffFilesResult> {
    const p = project(projectIdOrSlug);
    const { entry, stale } = await entryFor(p);
    const shell = { projectId: p.id, number, stale };
    if (!entry.prs) return { ...shell, available: false, reason: entry.reason, message: entry.message, files: [] };
    const pr = entry.prs.find((x) => x.number === number);
    if (!pr) return { ...shell, available: true, reason: null, message: null, files: [] };
    const diff = await diffEntryFor(p, entry, pr);
    if (!diff.ok) return { ...shell, available: false, reason: diff.reason, message: diff.message, files: [] };
    return { ...shell, available: true, reason: null, message: null, files: diff.parsed.map(toSummary) };
  }

  async function diffFile(projectIdOrSlug: string, number: number, path: string): Promise<PullRequestDiffFileResult> {
    const p = project(projectIdOrSlug);
    const { entry } = await entryFor(p);
    const shell = { projectId: p.id, number };
    if (!entry.prs) return { ...shell, available: false, reason: entry.reason, message: entry.message, file: null };
    const pr = entry.prs.find((x) => x.number === number);
    if (!pr) return { ...shell, available: true, reason: null, message: null, file: null };
    const diff = await diffEntryFor(p, entry, pr);
    if (!diff.ok) return { ...shell, available: false, reason: diff.reason, message: diff.message, file: null };
    const found = diff.parsed.find((f) => f.path === path);
    if (!found) return { ...shell, available: true, reason: null, message: null, file: null };
    return { ...shell, available: true, reason: null, message: null, file: { ...toSummary(found), hunks: found.hunks } };
  }

  async function diffContext(projectIdOrSlug: string, number: number, path: string, startLine: number, endLine: number): Promise<PullRequestDiffContextResult> {
    const p = project(projectIdOrSlug);
    const { entry } = await entryFor(p);
    const shell = { projectId: p.id, number };
    if (!entry.prs) return { ...shell, available: false, reason: entry.reason, lines: [] };
    const pr = entry.prs.find((x) => x.number === number);
    if (!pr) return { ...shell, available: true, reason: null, lines: [] };
    if (!existsSync(p.clonePath)) return { ...shell, available: false, reason: 'no_clone', lines: [] };

    const cacheKey = `${number}:${path}`;
    let content = entry.baseFiles.get(cacheKey);
    if (content === undefined) {
      const baseRef = (await resolveBaseRef(p.clonePath, pr.baseRefName)) ?? pr.baseRefName;
      content = await readFileAtRef(p.clonePath, baseRef, path);
      entry.baseFiles.set(cacheKey, content);
    }
    if (!content) return { ...shell, available: true, reason: null, lines: [] };

    const from = Math.max(1, startLine);
    const to = Math.min(content.length, endLine);
    if (from > to) return { ...shell, available: true, reason: null, lines: [] };
    return { ...shell, available: true, reason: null, lines: content.slice(from - 1, to) };
  }

  return { list, get, diffFiles, diffFile, diffContext };
}
