/**
 * Retained worker copies (VS-955, `worker-retained-copies`): the scan's counts, sizes, classes and
 * reasons, from real worktrees in a real project clone with a bare remote; and the reclaim gate — no
 * path removes a copy holding unlanded work without captain's approval, solo or in a batch.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, nowIso } from '@weave-ai/db';
import { FakeRuntime } from '@weave-ai/runtime-sdk';
import type { Agent, Ticket, TicketStatus } from '@weave-ai/shared';
import { makeHarness, fakeWake, type TestHarness } from '../testing/context.js';
import { createWorkersService } from './index.js';
import { createDecisionsService } from '../decisions/service.js';
import { createRolesService } from '../roles/index.js';
import { GitWorktreeProvider } from '../worktrees/git.js';
import { git } from '../util/git.js';
import type { Actor, WorkersService } from '../api.js';

const SYSTEM: Actor = { kind: 'system', id: null };
const HUMAN: Actor = { kind: 'human', id: 'victor' };
const DAY = 86_400_000;
const ago = (days: number): string => new Date(Date.now() - days * DAY).toISOString();

describe('retained worker copies (VS-955)', () => {
  let h: TestHarness;
  let workers: WorkersService;
  let clonePath: string;
  let remotePath: string;
  let posted: string[];
  let n = 200;

  async function seedRepo(): Promise<void> {
    clonePath = h.db.get<{ clonePath: string }>('SELECT clone_path FROM projects WHERE id = ?', [h.projectId])!.clonePath;
    remotePath = `${clonePath}-remote.git`;
    mkdirSync(clonePath, { recursive: true });
    await git(['init', '--bare', '-b', 'main', remotePath], h.ctx.paths.projects);
    await git(['init', '-b', 'main'], clonePath);
    await git(['config', 'user.email', 'test@example.com'], clonePath);
    await git(['config', 'user.name', 'Test'], clonePath);
    writeFileSync(join(clonePath, 'README.md'), '# api\n', 'utf8');
    writeFileSync(join(clonePath, 'a.txt'), 'a\n', 'utf8');
    await git(['add', '.'], clonePath);
    await git(['commit', '-m', 'init'], clonePath);
    await git(['remote', 'add', 'origin', remotePath], clonePath);
    await git(['push', '-u', 'origin', 'main'], clonePath);
  }

  function seedTicket(status: TicketStatus, over: Record<string, unknown> = {}): Ticket {
    const id = newId();
    const num = n++;
    h.db.insert('tickets', {
      id, workspaceId: h.workspaceId, projectId: h.projectId, number: num, identifier: `TST-${num}`, kind: 'change',
      title: `Ticket ${num}`, description: '', status, priority: 'medium', assigneeRoleId: h.roleId, createdByKind: 'agent',
      createdAt: nowIso(), updatedAt: nowIso(), ...over,
    });
    return h.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [id])!;
  }

  /** A worker with a real checkout, finished (`done`) unless told otherwise, on a ticket in `status`. */
  async function copy(status: TicketStatus, opts: { agentStatus?: string; terminalDaysAgo?: number } = {}) {
    const ticket = seedTicket('todo');
    const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
    const terminalAt = ago(opts.terminalDaysAgo ?? 60);
    h.db.update('tickets', ticket.id, { status, ...(status === 'done' ? { completedAt: terminalAt } : status === 'cancelled' ? { cancelledAt: terminalAt } : {}) });
    h.db.update('agents', worker.id, { status: opts.agentStatus ?? 'done', lastRunAt: terminalAt, updatedAt: terminalAt });
    await git(['config', 'user.email', 'test@example.com'], worker.worktreePath!);
    await git(['config', 'user.name', 'Test'], worker.worktreePath!);
    return { ticket, worker, home: worker.homePath, wt: worker.worktreePath!, branch: worker.branch! };
  }

  async function commit(wt: string, file: string): Promise<void> {
    writeFileSync(join(wt, file), `${file}\n`, 'utf8');
    await git(['add', file], wt);
    await git(['commit', '-m', `add ${file}`], wt);
  }

  /** Every file under the workspace root and every ref in the clone, hashed: what "changed nothing" means. */
  async function fingerprint(): Promise<string> {
    const lines: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile() && !p.includes(`${join('.git', 'index')}`) && !/db\.sqlite/.test(p)) {
          lines.push(`${relative(h.ctx.paths.workers, p)} ${createHash('sha1').update(readFileSync(p)).digest('hex')}`);
        }
      }
    };
    walk(h.ctx.paths.workers);
    lines.push((await git(['for-each-ref', '--format=%(refname) %(objectname)'], clonePath)).stdout);
    lines.push((await git(['worktree', 'list', '--porcelain'], clonePath)).stdout);
    return lines.sort().join('\n');
  }

  beforeEach(async () => {
    h = makeHarness();
    posted = [];
    h.services.wake = fakeWake() as never;
    h.services.roles = createRolesService(h.ctx, h.deps);
    h.services.tickets = { comment: vi.fn(() => ({ id: 'c1' })), transition: vi.fn(async () => ({})) } as never;
    h.services.runs = { cancel: vi.fn(async () => undefined) } as never;
    h.services.threads = { notifyHuman: vi.fn(async (_a: unknown, m: { text: string }) => { posted.push(m.text); }) } as never;
    h.ctx.registries.worktreeProviders.set('git', new GitWorktreeProvider());
    h.ctx.registries.runtimes.set('claude', new FakeRuntime());
    workers = createWorkersService(h.ctx, h.deps);
    h.services.workers = workers;
    h.services.decisions = createDecisionsService(h.ctx, h.deps);
    await seedRepo();
  });
  afterEach(() => { h.cleanup(); });

  describe('the scan', () => {
    it('reports both kinds of unlanded work with counts, sizes, classes and totals, and changes nothing', async () => {
      // Uncommitted: 2 modified tracked files and 3 untracked files.
      const dirty = await copy('done');
      writeFileSync(join(dirty.wt, 'README.md'), '# changed\n', 'utf8');
      writeFileSync(join(dirty.wt, 'a.txt'), 'changed\n', 'utf8');
      for (const f of ['x.png', 'y.png', 'notes.md']) writeFileSync(join(dirty.wt, f), f, 'utf8');
      // Commits not on the landing branch: 4, of which 1 is on no remote.
      const ahead = await copy('cancelled');
      for (const f of ['c1', 'c2', 'c3']) await commit(ahead.wt, f);
      await git(['push', 'origin', ahead.branch], ahead.wt);
      await commit(ahead.wt, 'c4');
      // Branch gone from the clone.
      const gone = await copy('done');
      await git(['update-ref', '-d', `refs/heads/${gone.branch}`], clonePath);
      // Still open; and a running worker, which is not a retained copy at all.
      const open = await copy('in_review');
      writeFileSync(join(open.wt, 'wip.txt'), 'wip', 'utf8');
      const running = await copy('in_progress', { agentStatus: 'running' });
      writeFileSync(join(running.wt, 'live.txt'), 'live', 'utf8');
      // A directory no agent owns.
      mkdirSync(join(h.ctx.paths.workers, 'stray', 'work'), { recursive: true });
      writeFileSync(join(h.ctx.paths.workers, 'stray', 'work', 'f'), 'x', 'utf8');

      const before = await fingerprint();
      const report = await workers.scanRetainedCopies();
      expect(await fingerprint()).toBe(before);

      const by = new Map(report.copies.map((c) => [c.directory, c]));
      expect(by.has(running.worker.id)).toBe(false);

      expect(by.get(dirty.worker.id)).toMatchObject({
        class: 'finished_unlanded', ticketIdentifier: dirty.ticket.identifier, ticketStatus: 'done', workerStatus: 'done',
        uncommitted: { tracked: 2, untracked: 3 }, commitsNotOnLandingBranch: 0, commitsOnlyHere: 0, reasons: ['uncommitted'],
        needsOwnApproval: false, offerable: true,
      });
      expect(by.get(ahead.worker.id)).toMatchObject({
        class: 'finished_unlanded', ticketStatus: 'cancelled', uncommitted: { tracked: 0, untracked: 0 },
        commitsNotOnLandingBranch: 4, commitsOnNoRemote: 1, reasons: ['commits_not_on_landing_branch'], needsOwnApproval: true,
      });
      expect(by.get(gone.worker.id)).toMatchObject({ class: 'branch_gone', commitsOnlyHere: null, needsOwnApproval: true });
      expect(by.get(gone.worker.id)!.reasons).toContain('branch_gone');
      expect(by.get(open.worker.id)).toMatchObject({ class: 'open', offerable: false, reasons: ['uncommitted'] });
      expect(by.get('stray')).toMatchObject({ class: 'orphan', workerId: null });

      for (const c of report.copies) expect(c.bytes).toBeGreaterThan(0);
      expect(report.totals.count).toBe(5);
      expect(report.totals.bytes).toBe(report.copies.reduce((s, c) => s + c.bytes!, 0));
      expect(report.totals.byClass.finished_unlanded.count).toBe(2);
      expect(report.totals.byClass.open.count).toBe(1);
      // Largest first, and the stored report is what a later read serves.
      expect(report.copies.map((c) => c.bytes)).toEqual([...report.copies.map((c) => c.bytes)].sort((a, b) => b! - a!));
      expect(workers.retainedCopies().copies.map((c) => c.directory)).toEqual(report.copies.map((c) => c.directory));
      expect(workers.retainedCopies().scannedAt).toBeTruthy();
    });

    it('treats a merged pull request as landed and leaves a clean landed copy to the VS-859 sweep', async () => {
      const merged = await copy('done');
      await commit(merged.wt, 'squashed');
      h.db.insert('ticket_work_products', {
        id: newId(), ticketId: merged.ticket.id, type: 'pull_request', provider: 'github', url: 'https://github.com/acme/api/pull/9',
        title: 'PR 9', state: 'merged', isPrimary: 1, createdAt: nowIso(), updatedAt: nowIso(),
      });
      await git(['push', 'origin', merged.branch], merged.wt);
      expect((await workers.scanRetainedCopies()).copies).toEqual([]);
    });

    it('keeps a checkout whose HEAD holds commits no branch, remote or tag reaches, and gives it its own card', async () => {
      const detached = await copy('done');
      await git(['checkout', '--detach'], detached.wt);
      await commit(detached.wt, 'orphaned');
      const c = (await workers.scanRetainedCopies()).copies.find((x) => x.directory === detached.worker.id);
      expect(c).toMatchObject({ commitsOnlyHere: 1, commitsOnNoRemote: 0, reasons: ['commits_not_on_landing_branch'], needsOwnApproval: true });
      const offer = await workers.offerRetainedReclaim(HUMAN, [detached.worker.id]);
      expect(offer.cards).toMatchObject([{ own: true, directories: [detached.worker.id] }]);
      expect(h.services.decisions.get(offer.cards[0]!.decisionId).context).toContain('1 commit(s) only this copy holds are lost');
    });

    it('marks a copy offerable only once its ticket has been terminal for the window', async () => {
      const recent = await copy('done', { terminalDaysAgo: 2 });
      writeFileSync(join(recent.wt, 'u.txt'), 'u', 'utf8');
      const r = await workers.scanRetainedCopies();
      expect(r.copies[0]).toMatchObject({ class: 'finished_unlanded', offerable: false });
      expect(r.totals.offerable.count).toBe(0);
    });

    it('runs one scan at a time: a second call joins the first', async () => {
      const a = workers.scanRetainedCopies();
      expect(workers.startRetainedScan()).toBe(false);
      expect(workers.retainedCopies().scanning).toBe(true);
      await a;
      expect(workers.retainedCopies().scanning).toBe(false);
    });
  });

  describe('the reclaim offer and the approval gate', () => {
    async function threeCopies() {
      const unpushed = await copy('done');
      await commit(unpushed.wt, 'u1');
      await commit(unpushed.wt, 'u2');
      const uncommittedA = await copy('cancelled');
      writeFileSync(join(uncommittedA.wt, 'shot.png'), 'png', 'utf8');
      const uncommittedB = await copy('done');
      writeFileSync(join(uncommittedB.wt, 'README.md'), '# edited\n', 'utf8');
      await workers.scanRetainedCopies();
      return { unpushed, uncommittedA, uncommittedB };
    }
    const openReclaimCards = () => h.services.decisions.list({ status: ['open'] }).filter((d) => d.kind === 'discard_approval');

    it('an offer raises one card for the copy with unpushed commits and one shared card for the rest, and removes nothing', async () => {
      const { unpushed, uncommittedA, uncommittedB } = await threeCopies();
      const before = await fingerprint();
      const offer = await workers.offerRetainedReclaim(HUMAN, [unpushed.worker.id, uncommittedA.worker.id, uncommittedB.worker.id]);
      expect(await fingerprint()).toBe(before);

      expect(offer.cards).toHaveLength(2);
      const own = offer.cards.find((c) => c.own)!;
      const shared = offer.cards.find((c) => !c.own)!;
      expect(own.directories).toEqual([unpushed.worker.id]);
      expect(shared.directories.sort()).toEqual([uncommittedA.worker.id, uncommittedB.worker.id].sort());
      const ownCard = h.services.decisions.get(own.decisionId);
      expect(ownCard).toMatchObject({ kind: 'discard_approval', owner: 'human', status: 'open' });
      expect(ownCard.context).toContain('2 commit(s) on no remote');
      expect(ownCard.context).toContain('stays in the project clone');
      const sharedCard = h.services.decisions.get(shared.decisionId);
      expect(sharedCard.context).toContain('0 modified and 1 untracked file(s) are lost');
      expect(sharedCard.context).toContain('1 modified and 0 untracked file(s) are lost');
      expect(sharedCard.title).toMatch(/^Reclaim 2 worker copies \(/);

      // Offering the same copies again raises nothing new.
      const again = await workers.offerRetainedReclaim(HUMAN, [unpushed.worker.id]);
      expect(again.cards).toEqual([]);
      expect(again.skipped[0]!.reason).toBe('already on an open reclaim card');
    });

    it('never offers an open copy or a live worker', async () => {
      const open = await copy('in_review');
      writeFileSync(join(open.wt, 'wip'), 'w', 'utf8');
      const live = await copy('in_progress', { agentStatus: 'active' });
      const offer = await workers.offerRetainedReclaim(HUMAN, [open.worker.id, live.worker.id]);
      expect(offer.cards).toEqual([]);
      expect(offer.skipped.map((s) => s.directory).sort()).toEqual([open.worker.id, live.worker.id].sort());
      expect(openReclaimCards()).toEqual([]);
    });

    it('approve removes the checkout and home and keeps the branch with its commits', async () => {
      const { unpushed } = await threeCopies();
      const head = (await git(['rev-parse', unpushed.branch], clonePath)).stdout.trim();
      const offer = await workers.offerRetainedReclaim(HUMAN, [unpushed.worker.id]);
      await h.services.decisions.answer(HUMAN, offer.cards[0]!.decisionId, { key: 'approve' });

      expect(existsSync(unpushed.home)).toBe(false);
      expect((await git(['rev-parse', unpushed.branch], clonePath)).stdout.trim()).toBe(head);
      expect((await git(['worktree', 'list'], clonePath)).stdout).not.toContain(unpushed.wt);
      const activity = h.db.get<{ details: { bytes: number } }>("SELECT details_json FROM activity WHERE action = 'worker.retained_copy_reclaimed'");
      expect(activity?.details.bytes).toBeGreaterThan(0);
      expect(posted.at(-1)).toMatch(/^Reclaimed 1 worker copy, about .+ freed\.$/);
      expect(workers.retainedCopies().copies.some((c) => c.directory === unpushed.worker.id)).toBe(false);
    });

    it('reject changes nothing', async () => {
      const { uncommittedA, uncommittedB } = await threeCopies();
      const offer = await workers.offerRetainedReclaim(HUMAN, [uncommittedA.worker.id, uncommittedB.worker.id]);
      const before = await fingerprint();
      await h.services.decisions.answer(HUMAN, offer.cards[0]!.decisionId, { key: 'reject' });
      expect(await fingerprint()).toBe(before);
    });

    it('refuses a copy whose head moved after the card, and still reclaims its batch sibling', async () => {
      const { uncommittedA, uncommittedB } = await threeCopies();
      const offer = await workers.offerRetainedReclaim(HUMAN, [uncommittedA.worker.id, uncommittedB.worker.id]);
      await commit(uncommittedA.wt, 'late');
      await h.services.decisions.answer(HUMAN, offer.cards[0]!.decisionId, { key: 'approve' });

      expect(existsSync(uncommittedA.wt)).toBe(true);
      expect(statSync(join(uncommittedA.wt, 'late')).isFile()).toBe(true);
      expect(existsSync(uncommittedB.home)).toBe(false);
      expect(posted.at(-1)).toContain(`Kept \`${uncommittedA.worker.id}\`: its head moved since the card was raised.`);
    });

    it('refuses a copy whose worker was relaunched after the card', async () => {
      const { unpushed } = await threeCopies();
      const offer = await workers.offerRetainedReclaim(HUMAN, [unpushed.worker.id]);
      h.db.update('agents', unpushed.worker.id, { status: 'active' });
      await h.services.decisions.answer(HUMAN, offer.cards[0]!.decisionId, { key: 'approve' });
      expect(existsSync(unpushed.wt)).toBe(true);
      expect(posted.at(-1)).toContain('its worker is active again');
    });

    it('no automatic path removes unlanded work: the retention sweep, the scan, the weaver and the daemon all leave it', async () => {
      const { unpushed, uncommittedA, uncommittedB } = await threeCopies();
      const offer = await workers.offerRetainedReclaim(HUMAN, [unpushed.worker.id, uncommittedA.worker.id, uncommittedB.worker.id]);
      const before = await fingerprint();

      await workers.reclaimFinishedHomes(SYSTEM, { dryRun: false, ignoreAge: true });
      await workers.scanRetainedCopies();
      const weaver = h.db.get<Agent>("SELECT * FROM agents WHERE kind = 'weaver'")!;
      for (const card of offer.cards) {
        await expect(h.services.decisions.answer({ kind: 'agent', id: weaver.id, runId: 'r1' }, card.decisionId, { key: 'approve' }))
          .rejects.toMatchObject({ code: 'forbidden' });
        await expect(h.services.decisions.answer(SYSTEM, card.decisionId, { key: 'approve' })).rejects.toMatchObject({ code: 'forbidden' });
        expect(h.services.decisions.get(card.decisionId).status).toBe('open');
      }
      expect(await fingerprint()).toBe(before);
    });
  });
});
