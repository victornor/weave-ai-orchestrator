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

  beforeEach(async () => {
    h = makeHarness();
    created = [];
    h.services.wake = fakeWake() as never;
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
  });
});
