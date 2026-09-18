import { existsSync } from 'node:fs';
import { nowIso } from '@weave-ai/db';
import { OcError, landingBranchOf, NAMED_CARD_OPTION_KEYS, type Decision, type Project } from '@weave-ai/shared';
import type { Actor, CoreServices, PromotionService, PromotionStatus, PromotionTicket } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { recordActivity } from '../events.js';
import { git } from '../util/git.js';
import { landLock } from '../util/land-lock.js';

const RANGE_LIMIT = 200;

/**
 * Land-then-promote (VS-568): the second half. The daemon's only path that pushes a project's default
 * branch, reached only through an approved, weaver-reviewed, human-answered `promotion_approval`.
 */
export function createPromotionService(ctx: WorkspaceContext, deps: () => CoreServices): PromotionService {
  const db = ctx.db;
  const ws = ctx.workspaceId;
  const log = ctx.log('decision');

  function projectOf(id: string): Project {
    return deps().projects.get(id);
  }

  async function rev(clone: string, ref: string): Promise<string | null> {
    const r = await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], clone, 15_000);
    return r.ok && r.stdout.trim() ? r.stdout.trim() : null;
  }

  /** Done tickets of the project whose landed work is on landing, not yet in the default branch. */
  async function waitingTickets(project: Project, clone: string, landingRef: string, defaultRef: string): Promise<PromotionTicket[]> {
    const rows = db.all<{ id: string; identifier: string; title: string; delivery: Record<string, unknown> | null; landingBranch: string | null }>(
      "SELECT id, identifier, title, delivery_json, landing_branch FROM tickets WHERE workspace_id = ? AND project_id = ? AND status = 'done' ORDER BY completed_at ASC",
      [ws, project.id],
    );
    const out: PromotionTicket[] = [];
    for (const r of rows) {
      const d = (r.delivery ?? {}) as { landedSha?: unknown; landedOn?: unknown; promotedAt?: unknown };
      if (typeof d.landedSha !== 'string' || typeof d.promotedAt === 'string') continue;
      if (typeof d.landedOn === 'string' && d.landedOn !== landingBranchOf(project)) continue;
      const onLanding = (await git(['merge-base', '--is-ancestor', d.landedSha, landingRef], clone, 15_000)).ok;
      if (!onLanding) continue;
      if ((await git(['merge-base', '--is-ancestor', d.landedSha, defaultRef], clone, 15_000)).ok) continue;
      out.push({ id: r.id, identifier: r.identifier, title: r.title });
      if (out.length >= RANGE_LIMIT) break;
    }
    return out;
  }

  async function status(projectId: string, opts: { fetch?: boolean } = {}): Promise<PromotionStatus> {
    const project = projectOf(projectId);
    const landing = landingBranchOf(project);
    const def = project.defaultBranch;
    const base: PromotionStatus = {
      applicable: landing !== def, landing, defaultBranch: def, landingHead: null, defaultHead: null, ahead: 0, behind: 0,
      commits: [], behindCommits: [], tickets: [], canPromote: false, heldReason: null,
      notes: ((project.policies as { promotionNotes?: string[] } | null)?.promotionNotes ?? []).filter((n) => typeof n === 'string'),
    };
    if (!base.applicable) return base;
    const clone = project.clonePath;
    if (!existsSync(clone)) return { ...base, heldReason: 'the project has no local clone' };
    if (opts.fetch !== false) await git(['fetch', 'origin'], clone, 300_000);
    const landingRef = `origin/${landing}`;
    const defaultRef = `origin/${def}`;
    const [landingHead, defaultHead] = [await rev(clone, landingRef), await rev(clone, defaultRef)];
    if (!landingHead || !defaultHead) {
      return { ...base, landingHead, defaultHead, heldReason: `${!landingHead ? landingRef : defaultRef} was not found on origin` };
    }
    const count = async (range: string) => Number((await git(['rev-list', '--count', range], clone, 30_000)).stdout.trim()) || 0;
    const list = async (range: string) => (await git(['log', '--format=%H%x1f%s', `-n${RANGE_LIMIT}`, range], clone, 30_000)).stdout
      .split('\n').filter(Boolean).map((l) => { const [sha, subject] = l.split('\x1f'); return { sha: sha!, subject: subject ?? '' }; });
    const ahead = await count(`${defaultRef}..${landingRef}`);
    const behind = await count(`${landingRef}..${defaultRef}`);
    const commits = ahead ? await list(`${defaultRef}..${landingRef}`) : [];
    const behindCommits = behind ? await list(`${landingRef}..${defaultRef}`) : [];
    const tickets = ahead ? await waitingTickets(project, clone, landingRef, defaultRef) : [];
    let heldReason: string | null = null;
    if (behind > 0) {
      heldReason = `${landing} is behind ${def} by ${behind} commit${behind === 1 ? '' : 's'} and cannot fast-forward it (a hotfix landed on ${def}): ${behindCommits.slice(0, 5).map((c) => `${c.sha.slice(0, 8)} ${c.subject}`).join('; ')}. Merge ${def} into ${landing} first.`;
    }
    return { ...base, landingHead, defaultHead, ahead, behind, commits, behindCommits, tickets, canPromote: ahead > 0 && behind === 0, heldReason };
  }

  function render(s: PromotionStatus): string {
    const lines = [
      `Promote **${s.landing}** to **${s.defaultBranch}**: ${s.ahead} commit${s.ahead === 1 ? '' : 's'} ahead (${s.defaultHead?.slice(0, 8)}..${s.landingHead?.slice(0, 8)}).`,
      '',
      s.tickets.length ? `Tickets waiting (${s.tickets.length}):\n${s.tickets.map((t) => `- ${t.identifier} ${t.title}`).join('\n')}` : 'No finished tickets are recorded in this range.',
      '',
      `Commits:\n${s.commits.slice(0, 50).map((c) => `- ${c.sha.slice(0, 8)} ${c.subject}`).join('\n')}${s.commits.length > 50 ? `\n- … and ${s.commits.length - 50} more` : ''}`,
    ];
    if (s.notes.length) lines.push('', `What going live does:\n${s.notes.map((n) => `- ${n}`).join('\n')}`);
    if (s.heldReason) lines.push('', `**Held:** ${s.heldReason}`);
    return lines.join('\n');
  }

  return {
    status: (projectId) => status(projectId),

    async request(actor: Actor, projectId: string): Promise<Decision> {
      const s = await status(projectId);
      const project = projectOf(projectId);
      if (!s.applicable) throw new OcError('validation', `${project.slug} lands on ${s.defaultBranch}; there is nothing to promote`);
      if (s.ahead === 0 && !s.heldReason) throw new OcError('validation', `${s.landing} has no commits ${s.defaultBranch} lacks; nothing to promote`);
      if (!s.landingHead || !s.defaultHead) throw new OcError('validation', s.heldReason ?? 'cannot resolve landing and default heads');
      const key = `promotion_approval:${projectId}`;
      // At most one open per project: the card's contents are recomputed by superseding, not duplicated.
      return deps().decisions.create(actor, {
        projectId, kind: 'promotion_approval', owner: 'human',
        title: `Promote ${s.landing} to ${s.defaultBranch} for ${project.slug}`,
        context: render(s),
        options: s.canPromote
          ? [
            { key: NAMED_CARD_OPTION_KEYS.promotion_approval.approve, label: `Promote ${s.landing} to ${s.defaultBranch}`, recommended: true },
            { key: NAMED_CARD_OPTION_KEYS.promotion_approval.decline, label: 'Not now' },
          ]
          : [{ key: NAMED_CARD_OPTION_KEYS.promotion_approval.decline, label: 'Dismiss' }],
        allowFreeText: true,
        correlationKey: key,
        target: { promotion: { landing: s.landing, defaultBranch: s.defaultBranch, landingHead: s.landingHead, defaultHead: s.defaultHead, ahead: s.ahead, behind: s.behind, tickets: s.tickets, notes: s.notes, heldReason: s.heldReason } },
      });
    },

    async currentHead(d: Decision): Promise<string | null> {
      if (!d.projectId) return null;
      const s = await status(d.projectId).catch(() => null);
      return s?.landingHead ?? null;
    },

    async execute(actor: Actor, d: Decision): Promise<{ promotedHead: string }> {
      if (actor.kind !== 'human') throw new OcError('forbidden', 'only a human can promote; YOLO and the daemon never do');
      if (!d.projectId) throw new OcError('validation', 'a promotion approval belongs to a project');
      const projectId = d.projectId;
      const project = projectOf(projectId);
      return landLock(projectId, async () => {
        const s = await status(projectId);
        if (!s.applicable || !s.landingHead || !s.defaultHead) throw new OcError('validation', s.heldReason ?? 'nothing to promote');
        if (s.behind > 0) throw new OcError('conflict', s.heldReason ?? `${s.landing} cannot fast-forward ${s.defaultBranch}`, { behind: s.behind, commits: s.behindCommits });
        if (s.ahead === 0) throw new OcError('validation', `${s.landing} has no commits ${s.defaultBranch} lacks`);
        const reviewed = d.weaverReviewedHeadSha;
        if (!reviewed || !(s.landingHead.startsWith(reviewed) || reviewed.startsWith(s.landingHead))) {
          throw new OcError('revision_pending', `decision ${d.id} is held: ${s.landing} moved since the weaver reviewed it; review and re-raise the card`, { weaverReviewedHeadSha: reviewed, landingHead: s.landingHead });
        }
        const push = await git(['push', 'origin', `${s.landingHead}:refs/heads/${s.defaultBranch}`], project.clonePath, 300_000);
        if (!push.ok) throw new OcError('conflict', `pushing ${s.landing} to ${s.defaultBranch} was rejected: ${(push.stderr || push.stdout).trim().slice(0, 400)}`, { stderr: push.stderr.trim().slice(0, 600) });
        await git(['fetch', 'origin'], project.clonePath, 300_000);
        const promotedAt = nowIso();
        for (const t of s.tickets) {
          const row = db.get<{ delivery: Record<string, unknown> | null }>('SELECT delivery_json FROM tickets WHERE id = ?', [t.id]);
          db.update('tickets', t.id, { deliveryJson: { ...(row?.delivery ?? {}), promotedAt, promotedSha: s.landingHead } });
          // A system status note, never the human's comment: a human's words on a finished ticket reopen it, and a promotion must not.
          deps().tickets.comment({ kind: 'system', id: 'promotion' }, t.id, `Promoted: ${s.landing} was promoted to ${s.defaultBranch} (${s.landingHead.slice(0, 12)}). This ticket is in production.`, 'status', 'trusted');
          ctx.events.emit('ticket.updated', 'ticket', t.id, deps().tickets.get(t.id));
        }
        recordActivity(db, ws, actor, 'project.promoted', 'project', projectId, { landing: s.landing, defaultBranch: s.defaultBranch, head: s.landingHead, tickets: s.tickets.map((t) => t.identifier) }, null, projectId);
        log.info({ projectId, head: s.landingHead, tickets: s.tickets.length }, 'promoted landing to default');
        return { promotedHead: s.landingHead };
      });
    },
  };
}
