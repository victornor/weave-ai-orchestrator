import { existsSync } from 'node:fs';
import { nowIso } from '@weave-ai/db';
import {
  OcError, landingBranchOf, NAMED_CARD_OPTION_KEYS, promotionPrTitleOf, promotionStrategyOf,
  type Decision, type Project,
} from '@weave-ai/shared';
import type { ForgeAdapter } from '@weave-ai/plugin-sdk';
import type {
  Actor, CoreServices, PromotionRecord, PromotionService, PromotionStatus, PromotionStrategy, PromotionTicket,
} from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { recordActivity } from '../events.js';
import { git } from '../util/git.js';
import { landLock } from '../util/land-lock.js';
import { buildPromotionBody, readPullRequestTemplate } from './pr-body.js';
import { resolveMergeMethod } from './merge-method.js';

const RANGE_LIMIT = 200;
/**
 * VS-584: how long a promotion pull request may sit with no check rollup before the daemon stops
 * waiting — the same ten minutes the ticket landing path uses. A repository the forge says has no CI
 * merges immediately; one it cannot classify merges past this bound as before, while a repository it
 * says has CI is held rather than merged without a run.
 */
const NO_CI_GRACE_MS = 10 * 60_000;

/**
 * Land-then-promote (VS-568, VS-584): the second half. The daemon's only path that lands a project's
 * default branch, reached only through an approved, weaver-reviewed, human-answered
 * `promotion_approval`. It promotes by pull request wherever a forge can open one, and by direct
 * fast-forward only when no forge can — never bypassing a repository rule.
 */
export function createPromotionService(ctx: WorkspaceContext, deps: () => CoreServices): PromotionService {
  const db = ctx.db;
  const ws = ctx.workspaceId;
  const log = ctx.log('decision');

  function projectOf(id: string): Project {
    return deps().projects.get(id);
  }

  function forge(): ForgeAdapter | null {
    return ctx.registries.forges.get('github') ?? null;
  }

  /** The resolved strategy: a pull request wherever a forge can open one, unless policy pins a push. */
  function strategyFor(project: Project): PromotionStrategy {
    return promotionStrategyOf(project.policies, Boolean(forge()?.createPullRequest));
  }

  function mergeMethodOf(project: Project): string {
    return String((project.policies as { mergeMethod?: string } | null)?.mergeMethod ?? 'squash');
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
      // VS-584: a ticket stamped promoted is shipped even when a squash rewrote its commit, so ancestry
      // alone must never re-list it.
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

  /**
   * VS-584: the content a promotion would carry — the bare tree diff between the default and landing
   * heads (`git diff --numstat <default> <landing>`), not a commit count. It is empty once landing's
   * content is already on the default (a squash), independent of whether the project back-merges, which
   * is exactly what "nothing to promote" must mean.
   */
  async function contentDiff(clone: string, defaultRef: string, landingRef: string): Promise<{ changedFiles: number; additions: number; deletions: number }> {
    const r = await git(['diff', '--numstat', defaultRef, landingRef], clone, 30_000);
    if (!r.ok) return { changedFiles: 0, additions: 0, deletions: 0 };
    let changedFiles = 0;
    let additions = 0;
    let deletions = 0;
    for (const line of r.stdout.split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      if (parts.length < 2) continue;
      changedFiles += 1;
      additions += parts[0] === '-' ? 0 : Number(parts[0]) || 0;
      deletions += parts[1] === '-' ? 0 : Number(parts[1]) || 0;
    }
    return { changedFiles, additions, deletions };
  }

  /** The latest promotion decision's record for a project, whatever state it holds. */
  function promotionRecord(projectId: string): PromotionRecord | null {
    const row = db.get<{ target: Record<string, unknown> | null }>(
      "SELECT target_json FROM decisions WHERE workspace_id = ? AND project_id = ? AND kind = 'promotion_approval' ORDER BY created_at DESC LIMIT 1",
      [ws, projectId],
    );
    const raw = row?.target?.['promotion'];
    return raw && typeof raw === 'object' ? (raw as PromotionRecord) : null;
  }

  /** Merge a progress patch into the decision's stored promotion record, preserving the rest. */
  function persistRecord(decisionId: string, patch: Partial<PromotionRecord>): void {
    const row = db.get<{ target: Record<string, unknown> | null }>('SELECT target_json FROM decisions WHERE id = ?', [decisionId]);
    const target = row?.target ?? {};
    const promotion = { ...((target['promotion'] as Record<string, unknown>) ?? {}), ...patch };
    db.update('decisions', decisionId, { targetJson: { ...target, promotion } });
  }

  async function status(projectId: string, opts: { fetch?: boolean } = {}): Promise<PromotionStatus> {
    const project = projectOf(projectId);
    const landing = landingBranchOf(project);
    const def = project.defaultBranch;
    const strategy = strategyFor(project);
    const base: PromotionStatus = {
      applicable: landing !== def, landing, defaultBranch: def, landingHead: null, defaultHead: null, ahead: 0, behind: 0,
      commits: [], behindCommits: [], tickets: [], canPromote: false, heldReason: null,
      notes: ((project.policies as { promotionNotes?: string[] } | null)?.promotionNotes ?? []).filter((n) => typeof n === 'string'),
      changedFiles: 0, additions: 0, deletions: 0, strategy, promotion: promotionRecord(projectId),
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
    const content = await contentDiff(clone, defaultRef, landingRef);
    const ahead = await count(`${defaultRef}..${landingRef}`);
    const behind = await count(`${landingRef}..${defaultRef}`);
    const commits = ahead ? await list(`${defaultRef}..${landingRef}`) : [];
    const behindCommits = behind ? await list(`${landingRef}..${defaultRef}`) : [];
    // VS-584: the honest content decides "there is something to promote", not the commit count.
    const tickets = content.changedFiles ? await waitingTickets(project, clone, landingRef, defaultRef) : [];
    let heldReason: string | null = null;
    if (behind > 0 && strategy === 'direct-push') {
      heldReason = `${landing} is behind ${def} by ${behind} commit${behind === 1 ? '' : 's'} and cannot fast-forward it (a hotfix landed on ${def}): ${behindCommits.slice(0, 5).map((c) => `${c.sha.slice(0, 8)} ${c.subject}`).join('; ')}. Merge ${def} into ${landing} first.`;
    }
    const canPromote = content.changedFiles > 0 && (strategy === 'pull-request' || behind === 0);
    return { ...base, landingHead, defaultHead, ahead, behind, commits, behindCommits, tickets, ...content, canPromote, heldReason, strategy };
  }

  function render(s: PromotionStatus, mergeMethod: string | null): string {
    const content = `${s.changedFiles} file${s.changedFiles === 1 ? '' : 's'} changed, +${s.additions}/−${s.deletions} (tree diff \`${s.defaultBranch}...${s.landing}\`)`;
    const lines = [
      `Promote **${s.landing}** to **${s.defaultBranch}**${s.strategy === 'pull-request' ? ' through a pull request' : ' by fast-forward push'}${mergeMethod ? ` (merge: ${mergeMethod})` : ''}.`,
      content,
      '',
      s.tickets.length ? `Tickets waiting (${s.tickets.length}):\n${s.tickets.map((t) => `- ${t.identifier} ${t.title}`).join('\n')}` : 'No finished tickets are recorded in this range.',
      '',
      `Commits on ${s.landing} (detail):\n${s.commits.slice(0, 50).map((c) => `- ${c.sha.slice(0, 8)} ${c.subject}`).join('\n')}${s.commits.length > 50 ? `\n- … and ${s.commits.length - 50} more` : ''}`,
    ];
    if (s.notes.length) lines.push('', `What going live does:\n${s.notes.map((n) => `- ${n}`).join('\n')}`);
    if (s.promotion?.state === 'pending') lines.push('', `In flight: pull request ${s.promotion.prUrl ?? ''} — required checks are running.`);
    if (s.promotion?.state === 'held' && s.promotion.heldReason) lines.push('', `**Held:** ${s.promotion.heldReason}`);
    if (s.heldReason) lines.push('', `**Held:** ${s.heldReason}`);
    return lines.join('\n');
  }

  /** The merge method a promotion pull request would use, for the card; null when not a PR strategy. */
  async function mergeMethodFor(project: Project): Promise<string | null> {
    const f = forge();
    if (!f?.createPullRequest) return null;
    const settings = f.repoMergeSettings ? await f.repoMergeSettings(project.clonePath).catch(() => null) : null;
    return resolveMergeMethod(mergeMethodOf(project), settings)?.method ?? null;
  }

  /** Stamp every included ticket promoted (VS-568/VS-584) and record the promotion. */
  async function finalize(actor: Actor, project: Project, s: PromotionStatus, mergeCommit: string | null): Promise<void> {
    const promotedAt = nowIso();
    for (const t of s.tickets) {
      const row = db.get<{ delivery: Record<string, unknown> | null }>('SELECT delivery_json FROM tickets WHERE id = ?', [t.id]);
      db.update('tickets', t.id, {
        deliveryJson: {
          ...(row?.delivery ?? {}), promotedAt, promotedSha: s.landingHead,
          ...(mergeCommit ? { promotedMergeCommit: mergeCommit } : {}),
        },
      });
      deps().tickets.comment({ kind: 'system', id: 'promotion' }, t.id, `Promoted: ${s.landing} was promoted to ${s.defaultBranch} (${s.landingHead?.slice(0, 12) ?? ''}). This ticket is in production.`, 'status', 'trusted');
      ctx.events.emit('ticket.updated', 'ticket', t.id, deps().tickets.get(t.id));
    }
    recordActivity(db, ws, actor, 'project.promoted', 'project', project.id, {
      landing: s.landing, defaultBranch: s.defaultBranch, head: s.landingHead, mergeCommit,
      tickets: s.tickets.map((t) => t.identifier),
    }, null, project.id);
    log.info({ projectId: project.id, head: s.landingHead, mergeCommit, tickets: s.tickets.length }, 'promoted landing to default');
  }

  type MergeOutcome = { kind: 'merged'; mergeCommit?: string } | { kind: 'pending' } | { kind: 'held'; reason: string };

  /**
   * VS-584: merge the promotion pull request once the repository's checks allow it. Never forces: a
   * pending check waits, a failed check holds, and a repository that allows no run for a head it has
   * CI for is held rather than merged without one.
   */
  async function checkAndMerge(project: Project, f: ForgeAdapter, prUrl: string, method: string, pendingSince: string | null): Promise<MergeOutcome> {
    const state = await f.prState(project.clonePath, prUrl).catch(() => null);
    if (!state) return { kind: 'pending' };
    if (state.state === 'merged') return { kind: 'merged', mergeCommit: state.mergeCommit };
    if (state.state === 'closed') return { kind: 'held', reason: `the promotion pull request ${prUrl} is closed, not merged` };
    if (state.ciState === 'pending') return { kind: 'pending' };
    if (state.ciState === 'failure') return { kind: 'held', reason: `required checks failed on the promotion pull request ${prUrl}` };
    if (state.ciState === 'none' && (project.policies as { requireCi?: boolean } | null)?.requireCi !== false) {
      const hasWorkflows = f.hasCiWorkflows ? await f.hasCiWorkflows(project.clonePath).catch(() => null) : null;
      const expired = pendingSince != null && Date.now() - Date.parse(pendingSince) >= NO_CI_GRACE_MS;
      if (hasWorkflows === true) {
        return expired ? { kind: 'held', reason: `no required check run appeared for the promotion pull request ${prUrl} within the wait limit` } : { kind: 'pending' };
      }
      if (hasWorkflows === null && !expired) return { kind: 'pending' };
    }
    try {
      const result = await f.mergePr(project.clonePath, prUrl, method);
      return { kind: 'merged', mergeCommit: result.mergeCommit };
    } catch (e) {
      return { kind: 'held', reason: `merging the promotion pull request failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  return {
    status: (projectId) => status(projectId),

    async request(actor: Actor, projectId: string): Promise<Decision> {
      const s = await status(projectId);
      const project = projectOf(projectId);
      if (!s.applicable) throw new OcError('validation', `${project.slug} lands on ${s.defaultBranch}; there is nothing to promote`);
      if (s.changedFiles === 0) throw new OcError('validation', `${s.landing} has no content ${s.defaultBranch} lacks; nothing to promote`);
      if (!s.landingHead || !s.defaultHead) throw new OcError('validation', s.heldReason ?? 'cannot resolve landing and default heads');
      const key = `promotion_approval:${projectId}`;
      const method = s.strategy === 'pull-request' ? await mergeMethodFor(project) : null;
      // At most one open per project: the card's contents are recomputed by superseding, not duplicated.
      return deps().decisions.create(actor, {
        projectId, kind: 'promotion_approval', owner: 'human',
        title: `Promote ${s.landing} to ${s.defaultBranch} for ${project.slug}`,
        context: render(s, method),
        options: s.canPromote
          ? [
            { key: NAMED_CARD_OPTION_KEYS.promotion_approval.approve, label: `Promote ${s.landing} to ${s.defaultBranch}`, recommended: true },
            { key: NAMED_CARD_OPTION_KEYS.promotion_approval.decline, label: 'Not now' },
          ]
          : [{ key: NAMED_CARD_OPTION_KEYS.promotion_approval.decline, label: 'Dismiss' }],
        allowFreeText: true,
        correlationKey: key,
        target: {
          promotion: {
            state: 'open', strategy: s.strategy, prUrl: null, mergeMethod: method,
            landing: s.landing, defaultBranch: s.defaultBranch, landingHead: s.landingHead, defaultHead: s.defaultHead,
            changedFiles: s.changedFiles, additions: s.additions, deletions: s.deletions,
            ahead: s.ahead, behind: s.behind, tickets: s.tickets, notes: s.notes, heldReason: s.heldReason, updatedAt: nowIso(),
          },
        },
      });
    },

    async currentHead(d: Decision): Promise<string | null> {
      if (!d.projectId) return null;
      const s = await status(d.projectId).catch(() => null);
      return s?.landingHead ?? null;
    },

    async execute(actor: Actor, d: Decision): Promise<{ promotedHead: string | null; prUrl?: string; pending?: boolean }> {
      if (actor.kind !== 'human') throw new OcError('forbidden', 'only a human can promote; YOLO and the daemon never do');
      if (!d.projectId) throw new OcError('validation', 'a promotion approval belongs to a project');
      const projectId = d.projectId;
      const project = projectOf(projectId);
      return landLock(projectId, async () => {
        const s = await status(projectId);
        if (!s.applicable || !s.landingHead || !s.defaultHead) throw new OcError('validation', s.heldReason ?? 'nothing to promote');
        if (s.changedFiles === 0) throw new OcError('validation', `${s.landing} has no content ${s.defaultBranch} lacks`);
        if (s.behind > 0 && s.strategy === 'direct-push') throw new OcError('conflict', s.heldReason ?? `${s.landing} cannot fast-forward ${s.defaultBranch}`, { behind: s.behind, commits: s.behindCommits });
        const reviewed = d.weaverReviewedHeadSha;
        if (!reviewed || !(s.landingHead.startsWith(reviewed) || reviewed.startsWith(s.landingHead))) {
          throw new OcError('revision_pending', `decision ${d.id} is held: ${s.landing} moved since the weaver reviewed it; review and re-raise the card`, { weaverReviewedHeadSha: reviewed, landingHead: s.landingHead });
        }
        if (s.strategy === 'direct-push') {
          const push = await git(['push', 'origin', `${s.landingHead}:refs/heads/${s.defaultBranch}`], project.clonePath, 300_000);
          if (!push.ok) {
            const remote = (push.stderr || push.stdout).trim().slice(0, 400);
            throw new OcError('conflict', `pushing ${s.landing} to ${s.defaultBranch} was rejected: ${remote} This repository may require promotion through a pull request; ensure a forge is reachable, or set the project's promotion to a pull request.`, { stderr: push.stderr.trim().slice(0, 600), pullRequestPath: true });
          }
          await git(['fetch', 'origin'], project.clonePath, 300_000);
          await finalize(actor, project, s, null);
          persistRecord(d.id, { state: 'merged', strategy: 'direct-push', heldReason: null, updatedAt: nowIso() });
          return { promotedHead: s.landingHead };
        }
        const f = forge();
        if (!f?.createPullRequest) throw new OcError('validation', `no forge is available to open a promotion pull request for ${project.slug}`);
        const settings = f.repoMergeSettings ? await f.repoMergeSettings(project.clonePath).catch(() => null) : null;
        const choice = resolveMergeMethod(mergeMethodOf(project), settings);
        if (!choice) throw new OcError('conflict', 'the repository allows no merge method for a promotion pull request');
        const existing = f.pullRequestForBranch ? await f.pullRequestForBranch(project.clonePath, s.landing) : null;
        let pr = existing;
        if (!pr) {
          const title = promotionPrTitleOf(project.policies) ?? `Promote ${s.landing} to ${s.defaultBranch}`;
          const body = buildPromotionBody({
            landing: s.landing, defaultBranch: s.defaultBranch, landingHead: s.landingHead, defaultHead: s.defaultHead,
            changedFiles: s.changedFiles, additions: s.additions, deletions: s.deletions,
            tickets: s.tickets, commits: s.commits, notes: s.notes,
          }, readPullRequestTemplate(project.clonePath));
          pr = await f.createPullRequest(project.clonePath, { branch: s.landing, base: s.defaultBranch, title, body });
          recordActivity(db, ws, actor, 'project.promotion_pr_opened', 'project', projectId, { url: pr.url, number: pr.number, reused: false }, null, projectId);
        } else {
          recordActivity(db, ws, actor, 'project.promotion_pr_opened', 'project', projectId, { url: pr.url, number: pr.number, reused: true }, null, projectId);
        }
        const patch = { strategy: 'pull-request' as const, prUrl: pr.url, mergeMethod: choice.method, landingHead: s.landingHead, defaultHead: s.defaultHead };
        const outcome = await checkAndMerge(project, f, pr.url, choice.method, null);
        if (outcome.kind === 'merged') {
          await finalize(actor, project, s, outcome.mergeCommit ?? null);
          persistRecord(d.id, { ...patch, state: 'merged', heldReason: null, updatedAt: nowIso() });
          return { promotedHead: s.landingHead, prUrl: pr.url };
        }
        if (outcome.kind === 'held') {
          persistRecord(d.id, { ...patch, state: 'held', heldReason: outcome.reason, updatedAt: nowIso() });
          throw new OcError('conflict', outcome.reason, { prUrl: pr.url });
        }
        const pendingSince = nowIso();
        persistRecord(d.id, { ...patch, state: 'pending', heldReason: null, pendingSince, updatedAt: pendingSince });
        return { promotedHead: s.landingHead, prUrl: pr.url, pending: true };
      });
    },

    /**
     * VS-584: advance every in-flight promotion — the human's approval is already recorded, so the
     * daemon completes the merge the checks were holding, or holds it with the reason. Called from the
     * supervisor's cadence; a landing that moved past the reviewed head is held, never merged.
     */
    async advance(): Promise<number> {
      const rows = db.all<{ id: string; projectId: string; target: Record<string, unknown> | null }>(
        "SELECT id, project_id, target_json FROM decisions WHERE workspace_id = ? AND kind = 'promotion_approval' AND status = 'answered' AND answer_key = 'approve'",
        [ws],
      );
      let advanced = 0;
      for (const row of rows) {
        const p = (row.target?.['promotion'] ?? null) as PromotionRecord | null;
        if (!p || p.state !== 'pending' || !p.prUrl) continue;
        let project: Project;
        try { project = projectOf(row.projectId); } catch { continue; }
        const s = await status(row.projectId).catch(() => null);
        if (!s?.landingHead) continue;
        if (p.landingHead && s.landingHead !== p.landingHead) {
          persistRecord(row.id, { state: 'held', heldReason: `${s.landing} moved after the approval; review and raise a new promotion`, updatedAt: nowIso() });
          advanced++;
          continue;
        }
        const f = forge();
        if (!f?.mergePr) continue;
        const outcome = await checkAndMerge(project, f, p.prUrl, p.mergeMethod ?? 'squash', (p as { pendingSince?: string | null }).pendingSince ?? p.updatedAt);
        if (outcome.kind === 'merged') {
          await finalize({ kind: 'system', id: null }, project, s, outcome.mergeCommit ?? null);
          persistRecord(row.id, { state: 'merged', heldReason: null, updatedAt: nowIso() });
          advanced++;
        } else if (outcome.kind === 'held') {
          persistRecord(row.id, { state: 'held', heldReason: outcome.reason, updatedAt: nowIso() });
          advanced++;
        }
      }
      return advanced;
    },
  };
}
