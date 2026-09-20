import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId } from '@weave-ai/db';
import type { Decision, Project } from '@weave-ai/shared';
import { makeHarness, fakeWake, type TestHarness } from '../testing/context.js';
import { createTicketsService } from '../tickets/service.js';
import { createPromotionService } from './index.js';
import { git } from '../util/git.js';
import type { Actor, PromotionService, TicketsService } from '../api.js';

const HUMAN: Actor = { kind: 'human', id: 'victor' };
const SYSTEM: Actor = { kind: 'system', id: 'daemon' };

/** VS-568: land-then-promote's second half, against real git repositories with a bare remote. */
describe('promotion', () => {
  let h: TestHarness;
  let dir: string;
  let remote: string;
  let clone: string;
  let promotion: PromotionService;
  let tickets: TicketsService;
  let created: Array<Record<string, unknown>>;

  const run = async (repo: string, ...args: string[]) => (await git(args, repo)).stdout.trim();
  const commit = async (repo: string, file: string, msg: string): Promise<string> => {
    writeFileSync(join(repo, file), msg);
    await git(['add', '.'], repo);
    await git(['commit', '-m', msg], repo);
    return run(repo, 'rev-parse', 'HEAD');
  };
  /** A commit made on `branch` and pushed, as another clone would after a merge on the forge. */
  const landOn = async (branch: string, file: string): Promise<string> => {
    const other = join(dir, `other-${newId()}`);
    await git(['clone', remote, other], dir);
    await git(['config', 'user.email', 't@example.com'], other);
    await git(['config', 'user.name', 'T'], other);
    await git(['checkout', branch], other);
    const sha = await commit(other, file, `land ${file}`);
    await git(['push', 'origin', branch], other);
    return sha;
  };
  const doneTicket = (title: string, landedSha: string): string => {
    const t = tickets.create(HUMAN, { projectId: h.projectId, title, description: '', kind: 'task' } as never);
    h.db.update('tickets', t.id, { status: 'done', deliveryJson: { merged: true, landedOn: 'edge', landedSha } });
    return t.id;
  };
  const card = (over: Partial<Decision> = {}): Decision => ({ id: 'd1', projectId: h.projectId, kind: 'promotion_approval', weaverReviewedHeadSha: null, ...over }) as Decision;

  /** A commit on `main` whose tree equals `edge`'s — a squash promotion, with no back-merge. */
  const squashPromote = async (): Promise<string> => {
    const other = join(dir, `other-${newId()}`);
    await git(['clone', remote, other], dir);
    await git(['config', 'user.email', 't@example.com'], other);
    await git(['config', 'user.name', 'T'], other);
    await git(['checkout', 'main'], other);
    await git(['merge', '--squash', 'origin/edge'], other);
    await git(['commit', '-m', 'squash edge'], other);
    await git(['push', 'origin', 'main'], other);
    return run(other, 'rev-parse', 'HEAD');
  };

  interface FakeForgeOpts {
    existing?: { url: string; number: number } | null;
    ciState?: 'pending' | 'success' | 'failure' | 'none';
    repoState?: 'open' | 'merged' | 'closed';
    mergeCommit?: string;
    mergeSettings?: { merge: boolean; squash: boolean; rebase: boolean } | null;
    hasCi?: boolean | null;
    failMerge?: boolean;
  }
  /** A forge that records what it was asked to do, mutable between calls so a sweep can see a new state. */
  const fakeForge = (opts: FakeForgeOpts = {}) => {
    const calls = { created: [] as Array<Record<string, unknown>>, merged: [] as Array<{ url: string; method: string }> };
    const pr = { url: 'https://forge.example/pr/1', number: 1 };
    let state: 'open' | 'merged' | 'closed' = opts.repoState ?? 'open';
    const forge = {
      id: 'github',
      detect: async () => true,
      pullRequestForBranch: async () => opts.existing ?? null,
      createPullRequest: async (_cwd: string, o: Record<string, unknown>) => { calls.created.push(o); return pr; },
      prState: async () => ({
        state, mergeCommit: state === 'merged' ? (opts.mergeCommit ?? 'm'.repeat(40)) : undefined,
        ciState: opts.ciState ?? 'success', checkDetails: [], headSha: 'h'.repeat(40), isDraft: false,
      }),
      mergePr: async (_cwd: string, url: string, method: string) => {
        calls.merged.push({ url, method });
        if (opts.failMerge) throw new Error('merge refused by a repository rule');
        state = 'merged';
        return { mergeCommit: opts.mergeCommit ?? 'm'.repeat(40) };
      },
      repoMergeSettings: async () => (opts.mergeSettings === undefined ? { merge: true, squash: true, rebase: true } : opts.mergeSettings),
      hasCiWorkflows: async () => (opts.hasCi === undefined ? false : opts.hasCi),
    };
    h.ctx.registries.forges.set('github', forge as never);
    return { forge, calls };
  };

  /** A real decision row, so `execute`'s progress writes and `advance`'s query have something to land on. */
  const openPromotionDecision = (target: Record<string, unknown>): string => {
    h.db.insert('decisions', {
      id: 'd1', workspaceId: h.workspaceId, ticketId: null, projectId: h.projectId, kind: 'promotion_approval',
      owner: 'human', title: 'Promote edge to main', context: '', optionsJson: [{ key: 'approve', label: 'Promote' }],
      inputsJson: [], allowFreeText: true, status: 'answered', answerKey: 'approve', answeredByKind: 'human', answeredById: 'victor',
      answeredAt: '2026-09-19T00:00:01.000Z', targetJson: target, correlationKey: `promotion_approval:${h.projectId}`, createdAt: '2026-09-19T00:00:00.000Z',
    });
    return 'd1';
  };
  /** VS-632: an open card row, the shape `refresh` reads and rewrites. */
  const openCardRow = (promotion: Record<string, unknown>, over: Record<string, unknown> = {}): string => {
    h.db.insert('decisions', {
      id: 'd1', workspaceId: h.workspaceId, ticketId: null, projectId: h.projectId, kind: 'promotion_approval',
      owner: 'human', title: 'Promote edge to main', context: '', optionsJson: [{ key: 'approve', label: 'Promote edge to main' }, { key: 'decline', label: 'Not now' }],
      inputsJson: [], allowFreeText: true, status: 'open', answerKey: null,
      answeredByKind: null, answeredById: null, answeredAt: null,
      targetJson: { promotion }, correlationKey: `promotion_approval:${h.projectId}`, createdAt: '2026-09-19T00:00:00.000Z',
      weaverReviewStatus: 'looked', weaverReviewedAt: '2026-09-19T00:00:00.000Z', weaverReviewNote: 'clean', weaverReviewedByAgentId: h.conductorId,
      weaverReviewWaitingOn: null, weaverReviewedHeadSha: null,
      ...over,
    });
    return 'd1';
  };
  const cardRecordOf = (): Record<string, unknown> => h.db.get<{ target: Record<string, unknown> }>('SELECT target_json FROM decisions WHERE id = ?', ['d1'])!.target['promotion'] as Record<string, unknown>;
  const recordOf = (): Record<string, unknown> | null => {
    const row = h.db.get<{ target: Record<string, unknown> | null }>('SELECT target_json FROM decisions WHERE id = ?', ['d1']);
    return (row?.target?.['promotion'] as Record<string, unknown>) ?? null;
  };
  const setPolicies = (policies: Record<string, unknown>): void => {
    const base = (h.services.projects as unknown as { get: () => Project }).get();
    h.services.projects = { get: () => ({ ...base, policies: { ...(base.policies ?? {}), ...policies } }) } as never;
  };

  beforeEach(async () => {
    h = makeHarness();
    created = [];
    h.services.wake = fakeWake() as never;
    // VS-632: `refresh` wakes the weaver through the workers service; the harness does not build one.
    h.services.workers = { conductor: () => ({ id: h.conductorId }) } as never;
    h.services.decisions = { create: vi.fn((_a: Actor, input: Record<string, unknown>) => { created.push(input); return { id: 'd1', ...input }; }) } as never;
    dir = mkdtempSync(join(tmpdir(), 'ac-promotion-'));
    remote = join(dir, 'remote');
    clone = join(dir, 'clone');
    await git(['init', '-b', 'main', remote], dir);
    await git(['config', 'user.email', 't@example.com'], remote);
    await git(['config', 'user.name', 'T'], remote);
    await git(['config', 'receive.denyCurrentBranch', 'ignore'], remote);
    await commit(remote, 'README.md', 'init');
    await git(['branch', 'edge'], remote);
    await git(['clone', remote, clone], dir);
    await git(['config', 'user.email', 't@example.com'], clone);
    await git(['config', 'user.name', 'T'], clone);
    const project = (): Project => ({
      id: h.projectId, workspaceId: h.workspaceId, slug: 'api', name: 'API', gitUrl: 'x', defaultBranch: 'main', landingBranch: 'edge', clonePath: clone,
      maxWorkers: 4, setupCommand: null, worktreeProvider: 'git', openspecEnabled: false, openspecVersion: null, knowledgeRepoEnabled: false, knowledgeSwitch: null,
      policies: { promotionNotes: ['push to main deploys prod'] }, status: 'ready', syncState: 'in_sync', lastFetchedAt: null, errorText: null,
    } as Project);
    h.services.projects = { get: project } as never;
    tickets = createTicketsService(h.ctx, h.deps);
    h.services.tickets = tickets;
    promotion = createPromotionService(h.ctx, h.deps);
    h.services.promotion = promotion;
  });

  afterEach(async () => {
    await tickets.stop();
    h.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports how far landing is ahead and which tickets wait', async () => {
    const sha = await landOn('edge', 'a.txt');
    const id = doneTicket('Add a', sha);
    const s = await promotion.status(h.projectId);
    expect(s).toMatchObject({ applicable: true, landing: 'edge', defaultBranch: 'main', ahead: 1, behind: 0, canPromote: true, heldReason: null, notes: ['push to main deploys prod'] });
    expect(s.tickets.map((t) => t.id)).toEqual([id]);
    expect(s.commits[0]!.sha).toBe(sha);
  });

  it('is not applicable when landing is the default branch', async () => {
    const base = (h.services.projects as never as { get: () => Project }).get();
    h.services.projects = { get: () => ({ ...base, landingBranch: null }) } as never;
    expect((await promotion.status(h.projectId)).applicable).toBe(false);
    await expect(promotion.request(HUMAN, h.projectId)).rejects.toThrow(/nothing to promote/);
  });

  it('raises one card carrying the range, the tickets and the go-live notes', async () => {
    const sha = await landOn('edge', 'a.txt');
    doneTicket('Add a', sha);
    await promotion.request(HUMAN, h.projectId);
    const input = created[0]!;
    expect(input).toMatchObject({ kind: 'promotion_approval', owner: 'human', projectId: h.projectId, correlationKey: `promotion_approval:${h.projectId}` });
    expect(String(input['context'])).toContain('push to main deploys prod');
    expect(String(input['context'])).toContain('Add a');
    expect((input['options'] as Array<{ key: string }>).map((o) => o.key)).toEqual(['approve', 'decline']);
  });

  it('refuses to raise a card when there is nothing to promote', async () => {
    await expect(promotion.request(HUMAN, h.projectId)).rejects.toThrow(/nothing to promote/);
    expect(created).toHaveLength(0);
  });

  it('fast-forwards main to the reviewed edge head and flips included tickets to promoted', async () => {
    const sha = await landOn('edge', 'a.txt');
    const id = doneTicket('Add a', sha);
    const res = await promotion.execute(HUMAN, card({ weaverReviewedHeadSha: sha }));
    expect(res.promotedHead).toBe(sha);
    expect(await run(remote, 'rev-parse', 'main')).toBe(sha);
    const delivery = h.db.get<{ delivery: Record<string, unknown> }>('SELECT delivery_json FROM tickets WHERE id = ?', [id])!.delivery;
    expect(typeof delivery['promotedAt']).toBe('string');
    expect(tickets.get(id).status).toBe('done');
    expect((await promotion.status(h.projectId)).ahead).toBe(0);
  });

  it('never promotes for a non-human actor', async () => {
    const sha = await landOn('edge', 'a.txt');
    await expect(promotion.execute(SYSTEM, card({ weaverReviewedHeadSha: sha }))).rejects.toMatchObject({ code: 'forbidden' });
    expect(await run(remote, 'rev-parse', 'main')).not.toBe(sha);
  });

  it('holds when landing moved after the review, and promotes nothing', async () => {
    const reviewed = await landOn('edge', 'a.txt');
    const moved = await landOn('edge', 'b.txt');
    await expect(promotion.execute(HUMAN, card({ weaverReviewedHeadSha: reviewed }))).rejects.toMatchObject({ code: 'revision_pending' });
    expect(await run(remote, 'rev-parse', 'main')).not.toBe(moved);
  });

  it('holds a non-fast-forward, naming the hotfix, and offers no Promote', async () => {
    const sha = await landOn('edge', 'a.txt');
    const hotfix = await landOn('main', 'hotfix.txt');
    const s = await promotion.status(h.projectId);
    expect(s).toMatchObject({ ahead: 1, behind: 1, canPromote: false });
    expect(s.heldReason).toMatch(/edge is behind main by 1 commit/);
    expect(s.heldReason).toContain(hotfix.slice(0, 8));
    await promotion.request(HUMAN, h.projectId);
    expect((created[0]!['options'] as Array<{ key: string }>).map((o) => o.key)).toEqual(['decline']);
    await expect(promotion.execute(HUMAN, card({ weaverReviewedHeadSha: sha }))).rejects.toMatchObject({ code: 'conflict' });
    expect(await run(remote, 'rev-parse', 'main')).toBe(hotfix);
  });

  it('leaves the card open with the remote reason when the push is rejected', async () => {
    const sha = await landOn('edge', 'a.txt');
    mkdirSync(join(remote, '.git', 'hooks'), { recursive: true });
    writeFileSync(join(remote, '.git', 'hooks', 'pre-receive'), '#!/bin/sh\necho "main-source-guard: only edge may update main" >&2\nexit 1\n', { mode: 0o755 });
    const failure = promotion.execute(HUMAN, card({ weaverReviewedHeadSha: sha }));
    await expect(failure).rejects.toThrow(/main-source-guard/);
    // VS-584: a rejected direct push names the pull-request route rather than dead-ending.
    await expect(promotion.execute(HUMAN, card({ weaverReviewedHeadSha: sha }))).rejects.toThrow(/pull request/i);
  });

  it('reports the tree diff as the honest content, and nothing to promote after a squash', async () => {
    const sha = await landOn('edge', 'a.txt');
    doneTicket('Add a', sha);
    const before = await promotion.status(h.projectId);
    expect(before).toMatchObject({ changedFiles: 1, canPromote: true });
    expect(before.additions).toBeGreaterThan(0);
    await squashPromote();
    const after = await promotion.status(h.projectId);
    expect(after.changedFiles).toBe(0);
    expect(after.canPromote).toBe(false);
    await expect(promotion.request(HUMAN, h.projectId)).rejects.toThrow(/nothing to promote/);
  });

  it('promotes through a pull request: opens it, merges it, and stamps the tickets', async () => {
    const sha = await landOn('edge', 'a.txt');
    const id = doneTicket('Add a', sha);
    const { calls } = fakeForge({ ciState: 'success' });
    const res = await promotion.execute(HUMAN, card({ weaverReviewedHeadSha: sha }));
    expect(res.promotedHead).toBe(sha);
    expect(res.pending).toBeFalsy();
    expect(calls.created).toHaveLength(1);
    expect(calls.created[0]).toMatchObject({ branch: 'edge', base: 'main' });
    expect(String(calls.created[0]!['title'])).toContain('Promote edge to main');
    expect(String(calls.created[0]!['body'])).toContain('Add a');
    expect(calls.merged).toEqual([{ url: 'https://forge.example/pr/1', method: 'squash' }]);
    const delivery = h.db.get<{ delivery: Record<string, unknown> }>('SELECT delivery_json FROM tickets WHERE id = ?', [id])!.delivery;
    expect(typeof delivery['promotedAt']).toBe('string');
  });

  it('reuses the open promotion pull request instead of opening another', async () => {
    const sha = await landOn('edge', 'a.txt');
    doneTicket('Add a', sha);
    const { calls } = fakeForge({ existing: { url: 'https://forge.example/pr/9', number: 9 }, ciState: 'success' });
    await promotion.execute(HUMAN, card({ weaverReviewedHeadSha: sha }));
    expect(calls.created).toHaveLength(0);
    expect(calls.merged).toEqual([{ url: 'https://forge.example/pr/9', method: 'squash' }]);
  });

  it('records an in-flight promotion when checks are pending, and advance merges it once they resolve', async () => {
    const sha = await landOn('edge', 'a.txt');
    const id = doneTicket('Add a', sha);
    openPromotionDecision({ promotion: { state: 'open', landingHead: sha } });
    const opts: FakeForgeOpts = { ciState: 'pending' };
    const { calls } = fakeForge(opts);
    const res = await promotion.execute(HUMAN, card({ weaverReviewedHeadSha: sha }));
    expect(res.pending).toBe(true);
    expect(calls.merged).toHaveLength(0);
    expect(recordOf()).toMatchObject({ state: 'pending', prUrl: 'https://forge.example/pr/1' });
    // The checks resolve; the supervisor's sweep completes it without a second human answer.
    opts.ciState = 'success';
    await promotion.advance();
    expect(calls.merged).toHaveLength(1);
    expect(recordOf()).toMatchObject({ state: 'merged' });
    const delivery = h.db.get<{ delivery: Record<string, unknown> }>('SELECT delivery_json FROM tickets WHERE id = ?', [id])!.delivery;
    expect(typeof delivery['promotedAt']).toBe('string');
  });

  it('holds and leaves the card open when a required check failed', async () => {
    const sha = await landOn('edge', 'a.txt');
    doneTicket('Add a', sha);
    openPromotionDecision({ promotion: { state: 'open', landingHead: sha } });
    const { calls } = fakeForge({ ciState: 'failure' });
    await expect(promotion.execute(HUMAN, card({ weaverReviewedHeadSha: sha }))).rejects.toMatchObject({ code: 'conflict' });
    expect(calls.merged).toHaveLength(0);
    expect(recordOf()).toMatchObject({ state: 'held' });
    expect(String(recordOf()!['heldReason'])).toMatch(/checks failed/);
  });

  it('holds a pull request the repository refuses to merge, and never forces it', async () => {
    const sha = await landOn('edge', 'a.txt');
    doneTicket('Add a', sha);
    openPromotionDecision({ promotion: { state: 'open', landingHead: sha } });
    const { calls } = fakeForge({ ciState: 'success', failMerge: true });
    await expect(promotion.execute(HUMAN, card({ weaverReviewedHeadSha: sha }))).rejects.toMatchObject({ code: 'conflict' });
    expect(calls.merged).toHaveLength(1);
    expect(recordOf()).toMatchObject({ state: 'held' });
  });

  it('uses the direct push when the policy says so even with a forge available', async () => {
    const sha = await landOn('edge', 'a.txt');
    doneTicket('Add a', sha);
    setPolicies({ promotionMode: 'direct-push' });
    const { calls } = fakeForge({ ciState: 'success' });
    const res = await promotion.execute(HUMAN, card({ weaverReviewedHeadSha: sha }));
    expect(res.promotedHead).toBe(sha);
    expect(calls.created).toHaveLength(0);
    expect(calls.merged).toHaveLength(0);
    expect(await run(remote, 'rev-parse', 'main')).toBe(sha);
  });

  it('advance holds an in-flight promotion whose landing moved past the reviewed head', async () => {
    const sha = await landOn('edge', 'a.txt');
    doneTicket('Add a', sha);
    openPromotionDecision({ promotion: { state: 'pending', prUrl: 'https://forge.example/pr/1', mergeMethod: 'squash', landingHead: sha, updatedAt: '2026-09-19T00:00:00.000Z' } });
    await landOn('edge', 'b.txt');
    const { calls } = fakeForge({ ciState: 'success' });
    await promotion.advance();
    expect(calls.merged).toHaveLength(0);
    expect(recordOf()).toMatchObject({ state: 'held' });
    expect(String(recordOf()!['heldReason'])).toMatch(/moved/);
  });

  it('lists only content the default branch lacks after a squash, and counts only those commits (VS-632)', async () => {
    const shippedSha = await landOn('edge', 'a.txt');
    const shipped = doneTicket('Add a', shippedSha);
    // A squash promotion ships the first commit's content to main without leaving its history behind.
    await squashPromote();
    const pendingSha = await landOn('edge', 'b.txt');
    const pending = doneTicket('Add b', pendingSha);
    const s = await promotion.status(h.projectId);
    expect(s.changedFiles).toBeGreaterThan(0);
    expect(s.tickets.map((t) => t.id)).toContain(pending);
    expect(s.tickets.map((t) => t.id)).not.toContain(shipped);
    expect(s.ahead).toBe(1);
    expect(s.commits.map((c) => c.sha)).toContain(pendingSha);
    expect(s.commits.map((c) => c.sha)).not.toContain(shippedSha);
  });

  it('refreshes an open card at the moved head, wakes the weaver, and holds then allows Approve (VS-632)', async () => {
    const A = await landOn('edge', 'a.txt');
    const ticketA = doneTicket('Add a', A);
    fakeForge({ ciState: 'success' });
    const wake = h.services.wake as unknown as ReturnType<typeof fakeWake>;
    openCardRow(
      { state: 'open', strategy: 'pull-request', prUrl: null, mergeMethod: 'squash', landing: 'edge', defaultBranch: 'main', landingHead: A, defaultHead: null, changedFiles: 1, additions: 1, deletions: 0, ahead: 1, behind: 0, tickets: [{ id: ticketA, identifier: 'TST-1', title: 'Add a' }], notes: [], heldReason: null, reviewStale: false, updatedAt: '2026-09-19T00:00:00.000Z' },
      { weaverReviewedHeadSha: A },
    );

    const B = await landOn('edge', 'b.txt');
    const ticketB = doneTicket('Add b', B);
    expect(await promotion.refresh()).toBe(1);
    const row = h.db.get<{ context: string; target: Record<string, unknown> }>('SELECT context, target_json FROM decisions WHERE id = ?', ['d1'])!;
    expect(cardRecordOf()).toMatchObject({ landingHead: B, reviewStale: true });
    expect(row.context).toContain('land b.txt');
    const waiting = (cardRecordOf()['tickets'] as Array<{ id: string }>).map((t) => t.id).sort();
    expect(waiting).toEqual([ticketA, ticketB].sort());

    // The weaver is asked to re-review at the new head, exactly once.
    expect(wake.calls).toHaveLength(1);
    expect(wake.calls[0]!.agentId).toBe(h.conductorId);
    expect(wake.calls[0]!.input).toMatchObject({ payload: { kind: 'promotion_refresh', decisionId: 'd1', landingHead: B } });
    expect(await promotion.refresh()).toBe(0);
    expect(wake.calls).toHaveLength(1);

    // Approve before the re-review is refused, carrying the detail the card reads.
    await expect(promotion.execute(HUMAN, card({ weaverReviewedHeadSha: A }))).rejects.toMatchObject({
      code: 'revision_pending',
      details: { weaverReviewHeadMismatch: true, landingHead: B },
    });

    // The weaver marks the card at B; the next refresh clears the stale flag without a second wake.
    h.db.update('decisions', 'd1', { weaverReviewedHeadSha: B, weaverReviewedAt: '2026-09-20T00:00:00.000Z' });
    expect(await promotion.refresh()).toBe(1);
    expect(cardRecordOf()['reviewStale']).toBe(false);
    expect(wake.calls).toHaveLength(1);

    // Approve now succeeds at the reviewed head.
    const res = await promotion.execute(HUMAN, card({ weaverReviewedHeadSha: B }));
    expect(res.promotedHead).toBe(B);
    expect(typeof h.db.get<{ delivery: Record<string, unknown> }>('SELECT delivery_json FROM tickets WHERE id = ?', [ticketB])!.delivery['promotedAt']).toBe('string');
  });

  it('keeps a concerns mark holding while refreshing a moved card (VS-632)', async () => {
    const A = await landOn('edge', 'a.txt');
    const B = await landOn('edge', 'b.txt');
    openCardRow(
      { state: 'open', strategy: 'pull-request', prUrl: null, mergeMethod: 'squash', landing: 'edge', defaultBranch: 'main', landingHead: A, defaultHead: null, changedFiles: 1, additions: 1, deletions: 0, ahead: 1, behind: 0, tickets: [], notes: [], heldReason: null, reviewStale: false, updatedAt: '2026-09-19T00:00:00.000Z' },
      { weaverReviewStatus: 'concerns', weaverReviewNote: 'split the migration', weaverReviewedHeadSha: A },
    );
    expect(await promotion.refresh()).toBe(1);
    const row = h.db.get<{ weaverReviewStatus: string; weaverReviewNote: string }>('SELECT weaver_review_status, weaver_review_note FROM decisions WHERE id = ?', ['d1'])!;
    expect(row.weaverReviewStatus).toBe('concerns');
    expect(row.weaverReviewNote).toBe('split the migration');
    expect(cardRecordOf()).toMatchObject({ landingHead: B, reviewStale: false });
  });
});
