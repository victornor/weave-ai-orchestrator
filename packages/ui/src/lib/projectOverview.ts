/**
 * The project overview's folding (VS-95). Everything here is pure: the page gathers the same
 * queries the board, the merge queue, the changelog and the knowledge area already use, and these
 * narrow them to one project. Kept out of the components so each rule has a test of its own.
 */
import type { ChangelogEntry, Decision, Project, Run, Ticket } from '@weave-ai/shared';

/**
 * The project an address names. `GET /projects/:id` resolves `id = ? OR slug = ?`, so both forms
 * are legitimate and the page resolves them the same way — against the list the shell has already
 * loaded, so opening the overview costs no request of its own.
 */
export function resolveProject(projects: readonly Project[], param: string | undefined): Project | null {
  if (!param) return null;
  return projects.find((p) => p.id === param) ?? projects.find((p) => p.slug === param) ?? null;
}

/**
 * The open decisions belonging to a project, found through the ticket each one is about. A decision
 * with no ticket is a workspace-level one and belongs to no project, so it is never listed here.
 */
export function decisionsForProject(
  decisions: readonly Decision[],
  tickets: readonly Pick<Ticket, 'id' | 'projectId'>[],
  projectId: string,
): Decision[] {
  const projectOf = new Map(tickets.map((t) => [t.id, t.projectId]));
  return decisions.filter((d) => d.ticketId !== null && projectOf.get(d.ticketId) === projectId);
}

/**
 * Each agent's most recent run summary — the line a worker last reported. `WorkerDetail` declares a
 * `lastStatusLine` no route sends and `/runs/traces` takes one agent at a time, so this reads the
 * runs list, which covers every worker in one request and is already invalidated by run events.
 */
export function lastLinesByAgent(runs: readonly Run[]): Map<string, string> {
  const newest = new Map<string, Run>();
  for (const r of runs) {
    if (!r.summary) continue;
    const seen = newest.get(r.agentId);
    if (!seen || runOrder(r) > runOrder(seen)) newest.set(r.agentId, r);
  }
  return new Map([...newest].map(([id, r]) => [id, r.summary!]));
}

/** When a run happened, for "most recent": a finished run by its end, a live one by its start. */
function runOrder(r: Run): string {
  return r.finishedAt ?? r.startedAt ?? r.createdAt;
}

/** One ticket that reached the repository, with the pull request it went in through if there was one. */
export interface Landing {
  ticketId: string | null;
  identifier: string | null;
  summary: string;
  at: string;
  /** The forge URL recorded for this ticket, or null when none was. */
  prUrl: string | null;
}

export const LANDING_WINDOW_DAYS = 14;

/**
 * What landed in the window, newest first. The pull request comes from the same ticket's `pr_opened`
 * entry: a landing whose PR entry falls outside the fetched page is listed without a link rather
 * than held back.
 */
export function recentLandings(
  entries: readonly ChangelogEntry[],
  now: Date = new Date(),
  days: number = LANDING_WINDOW_DAYS,
): Landing[] {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const prByTicket = new Map<string, string>();
  for (const e of entries) {
    if (e.kind !== 'pr_opened' || !e.ticketId || e.link?.kind !== 'url') continue;
    if (!prByTicket.has(e.ticketId)) prByTicket.set(e.ticketId, e.link.target);
  }
  return entries
    .filter((e) => e.kind === 'landed' && e.at >= since)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((e) => ({
      ticketId: e.ticketId,
      identifier: e.ticketIdentifier,
      summary: e.summary,
      at: e.at,
      prUrl: (e.ticketId && prByTicket.get(e.ticketId)) ?? null,
    }));
}

/** The delivery mode in force for a project, and whether it is the project's own or the workspace's. */
export function deliveryModeOf(
  project: Pick<Project, 'policies'> | null | undefined,
  config: Record<string, unknown> | undefined,
): { mode: string; inherited: boolean } {
  const own = (project?.policies as { deliveryMode?: unknown } | null | undefined)?.deliveryMode;
  if (typeof own === 'string' && own) return { mode: own, inherited: false };
  const defaults = (config?.['defaults'] ?? {}) as { deliveryMode?: unknown };
  const fallback = typeof defaults.deliveryMode === 'string' && defaults.deliveryMode ? defaults.deliveryMode : 'pr';
  return { mode: fallback, inherited: true };
}

/** One `## ` section of a knowledge hub file. */
export interface KnowledgeSection {
  name: string;
  body: string;
}

/**
 * The `## ` sections of a knowledge hub file, by the same rule core writes them with. HTML comments
 * are dropped: every hub file opens with the budget comment, which is bookkeeping, not content.
 */
export function knowledgeSections(markdown: string | null | undefined): KnowledgeSection[] {
  if (!markdown) return [];
  const found: Array<{ name: string; lines: string[] }> = [];
  for (const line of markdown.split('\n')) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) found.push({ name: m[1]!, lines: [] });
    else found[found.length - 1]?.lines.push(line);
  }
  return found.map((s) => ({ name: s.name, body: joinBody(s.lines) }));
}

function joinBody(lines: readonly string[]): string {
  return lines
    .filter((l) => !/^\s*<!--/.test(l))
    .join('\n')
    .trim();
}

/**
 * The project's Current focus, as its knowledge file states it. Absent — or an empty section — is
 * null: the overview omits it rather than standing something in for it.
 */
export function currentFocus(markdown: string | null | undefined): string | null {
  const section = knowledgeSections(markdown).find((s) => s.name.toLowerCase() === 'current focus');
  return section && section.body ? section.body : null;
}
