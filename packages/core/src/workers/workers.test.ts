import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, nowIso } from '@openconductor/db';
import { FakeRuntime } from '@openconductor/runtime-sdk';
import type { WorktreeProvider } from '@openconductor/plugin-sdk';
import type { Agent, Ticket } from '@openconductor/shared';
import { makeHarness, fakeWake, type TestHarness } from '../testing/context.js';
import { createWorkersService, ticketBranch, branchSlug } from './index.js';
import { createRolesService } from '../roles/index.js';
import { GitWorktreeProvider } from '../worktrees/git.js';
import { git } from '../util/git.js';
import type { Actor, WorkersService } from '../api.js';

const SYSTEM: Actor = { kind: 'system', id: null };
const HUMAN: Actor = { kind: 'human', id: 'victor' };

describe('workers', () => {
  let h: TestHarness;
  let workers: WorkersService;
  let wake: ReturnType<typeof fakeWake>;
  let clonePath: string;

  async function seedRepo(): Promise<void> {
    clonePath = h.db.get<{ clonePath: string }>('SELECT clone_path FROM projects WHERE id = ?', [h.projectId])!.clonePath;
    mkdirSync(clonePath, { recursive: true });
    await git(['init', '-b', 'main'], clonePath);
    await git(['config', 'user.email', 'test@example.com'], clonePath);
    await git(['config', 'user.name', 'Test'], clonePath);
    writeFileSync(join(clonePath, 'README.md'), '# api\n', 'utf8');
    await git(['add', '.'], clonePath);
    await git(['commit', '-m', 'init'], clonePath);
  }

  function seedTicket(over: Record<string, unknown> = {}): Ticket {
    const id = newId();
    const now = nowIso();
    h.db.insert('tickets', {
      id, workspaceId: h.workspaceId, projectId: h.projectId, number: 1, identifier: 'TST-1', kind: 'change',
      title: 'Add dark mode', description: 'Make it dark.', status: 'todo', priority: 'medium',
      assigneeRoleId: h.roleId, createdByKind: 'agent', createdAt: now, updatedAt: now, ...over,
    });
    return h.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [id])!;
  }

  beforeEach(async () => {
    h = makeHarness();
    wake = fakeWake();
    h.services.wake = wake as never;
    h.services.roles = createRolesService(h.ctx, h.deps);
    h.services.tickets = {
      comment: vi.fn(() => ({ id: 'c1' })),
      create: vi.fn(() => seedTicket({ number: 9, identifier: 'TST-9', kind: 'task', title: 'Curate project knowledge (api)' })),
      transition: vi.fn(async () => ({})),
    } as never;
    h.services.runs = { cancel: vi.fn(async () => undefined) } as never;
    h.ctx.registries.worktreeProviders.set('git', new GitWorktreeProvider());
    h.ctx.registries.runtimes.set('claude', new FakeRuntime());
    workers = createWorkersService(h.ctx, h.deps);
    await seedRepo();
  });
  afterEach(() => h.cleanup());

  it('derives the ticket branch and change name from the identifier and title', () => {
    const t = { identifier: 'TST-42', title: 'Add dark mode to the dashboard!' } as Ticket;
    expect(ticketBranch(t)).toBe('oc/tst-42-add-dark-mode-to-the-dashboard');
    expect(branchSlug('///')).toBe('work');
  });

  it('spawns a worker: home, worktree, ticket binding and the first wake', async () => {
    const ticket = seedTicket();
    const worker = await workers.spawnForTicket(HUMAN, ticket.id);

    expect(worker.status).toBe('active');
    expect(worker.name).toBe('Backend Engineer #1');
    expect(worker.homePath).toBe(join(h.ctx.paths.workers, worker.id));
    expect(worker.worktreePath).toBe(join(worker.homePath, 'work'));
    expect(worker.branch).toBe('oc/tst-1-add-dark-mode');
    expect(existsSync(join(worker.homePath, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(worker.homePath, 'brief.md'))).toBe(true);
    expect(existsSync(join(worker.homePath, 'notes.md'))).toBe(true);
    expect(existsSync(join(worker.worktreePath!, 'README.md'))).toBe(true);
    expect(readFileSync(join(worker.homePath, 'brief.md'), 'utf8')).toContain('TST-1 — Add dark mode');

    const wt = h.db.get<{ branch: string; status: string; provider: string }>('SELECT * FROM worktrees WHERE agent_id = ?', [worker.id])!;
    expect(wt).toMatchObject({ branch: 'oc/tst-1-add-dark-mode', status: 'active', provider: 'git' });

    const bound = h.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [ticket.id])!;
    expect(bound.workerId).toBe(worker.id);
    expect(bound.openspecChangeName).toBe('tst-1-add-dark-mode');

    expect(wake.calls).toHaveLength(1);
    expect(wake.calls[0]).toMatchObject({ agentId: worker.id, input: expect.objectContaining({ source: 'ticket_assigned' }) });
    expect(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM agent_sessions WHERE agent_id = ?', [worker.id])!.n).toBe(1);
  });

  it('returns the existing worker instead of spawning twice for a ticket', async () => {
    const ticket = seedTicket();
    const a = await workers.spawnForTicket(SYSTEM, ticket.id);
    const b = await workers.spawnForTicket(SYSTEM, ticket.id);
    expect(b.id).toBe(a.id);
  });

  it('refuses to spawn when the role has no free slot', async () => {
    h.db.update('roles', h.roleId, { maxWorkers: 1 });
    await workers.spawnForTicket(SYSTEM, seedTicket().id);
    const second = seedTicket({ number: 2, identifier: 'TST-2', title: 'Second thing' });
    await expect(workers.spawnForTicket(SYSTEM, second.id)).rejects.toMatchObject({ code: 'role_full' });
  });

  it('refuses to spawn when the project is at its worker limit', async () => {
    h.db.update('projects', h.projectId, { maxWorkers: 1 });
    await workers.spawnForTicket(SYSTEM, seedTicket().id);
    const second = seedTicket({ number: 2, identifier: 'TST-2', title: 'Second thing' });
    await expect(workers.spawnForTicket(SYSTEM, second.id)).rejects.toMatchObject({ code: 'role_full' });
  });

  it('rolls back the agent row, the home and the ticket binding when the worktree fails', async () => {
    const failing: WorktreeProvider = {
      id: 'git',
      detect: async () => ({ available: true }),
      create: async () => { throw new Error('disk on fire'); },
      list: async () => [],
      remove: async () => undefined,
    };
    h.ctx.registries.worktreeProviders.set('git', failing);
    const ticket = seedTicket();
    await expect(workers.spawnForTicket(SYSTEM, ticket.id)).rejects.toThrow(/disk on fire/);
    expect(h.db.all("SELECT * FROM agents WHERE kind = 'worker'")).toHaveLength(0);
    expect(h.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [ticket.id])!.workerId).toBeNull();
    expect(h.db.all('SELECT * FROM worktrees')).toHaveLength(0);
  });

  it('keeps an unlanded worker and marks its worktree dirty', async () => {
    const ticket = seedTicket();
    const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
    writeFileSync(join(worker.worktreePath!, 'wip.txt'), 'not committed', 'utf8');
    const result = await workers.retireIfLanded(SYSTEM, worker.id);
    expect(result.retired).toBe(false);
    expect(result.reason).toMatch(/uncommitted/);
    expect(h.db.get<{ status: string }>('SELECT status FROM worktrees WHERE agent_id = ?', [worker.id])!.status).toBe('dirty');
    expect(h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [worker.id])!.status).toBe('active');
  });

  it('retires a worker whose work landed on the default branch: worktree removed, home archived', async () => {
    h.db.update('projects', h.projectId, { policiesJson: { deliveryMode: 'local-branch' } });
    const ticket = seedTicket();
    const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
    const wtPath = worker.worktreePath!;
    writeFileSync(join(wtPath, 'dark.css', ), 'body{}', 'utf8');
    await git(['add', '.'], wtPath);
    await git(['commit', '-m', 'feat: dark mode'], wtPath);
    await git(['merge', '--ff-only', worker.branch!], clonePath);

    const result = await workers.retireIfLanded(SYSTEM, worker.id);
    expect(result.retired).toBe(true);
    expect(existsSync(wtPath)).toBe(false);
    expect(existsSync(join(h.ctx.paths.archive, worker.id, 'brief.md'))).toBe(true);
    const after = h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [worker.id])!;
    expect(after.status).toBe('retired');
    expect(after.retiredAt).toBeTruthy();
    expect(h.db.get<{ status: string }>('SELECT status FROM worktrees WHERE agent_id = ?', [worker.id])!.status).toBe('removed');
    expect(h.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [ticket.id])!.workerId).toBeNull();
  });

  it('relaunches with a progress note derived from the ticket and worktree', async () => {
    const ticket = seedTicket({ status: 'in_progress' });
    const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
    h.db.insert('ticket_comments', { id: newId(), ticketId: ticket.id, authorKind: 'agent', authorId: worker.id, body: 'working: wrote the plan', kind: 'status', sourceTrust: 'agent', createdAt: nowIso() });
    wake.calls.length = 0;

    const relaunched = await workers.relaunch(HUMAN, worker.id, 'you stopped responding');
    expect(relaunched.briefRevision).toBe(worker.briefRevision + 1);
    const brief = readFileSync(join(worker.homePath, 'brief.md'), 'utf8');
    expect(brief).toContain('you stopped responding');
    expect(brief).toContain('Ticket TST-1 is in_progress');
    expect(brief).toContain('working: wrote the plan');
    expect(wake.calls[0]).toMatchObject({ agentId: worker.id, input: expect.objectContaining({ source: 'system', reason: 'relaunch' }) });
  });

  it('messages a worker as a ticket comment plus a conductor_request wake', async () => {
    const ticket = seedTicket();
    const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
    wake.calls.length = 0;
    await workers.message({ kind: 'agent', id: 'conductor' }, worker.id, 'use CSS variables');
    expect(h.services.tickets!.comment).toHaveBeenCalledWith(expect.anything(), ticket.id, 'use CSS variables', 'relay', 'agent');
    expect(wake.calls[0]!.input).toMatchObject({ source: 'conductor_request' });
  });

  it('cancel keeps the worktree and marks it dirty', async () => {
    const ticket = seedTicket();
    const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
    const after = await workers.cancel(HUMAN, worker.id, 'no longer needed');
    expect(after.status).toBe('done');
    expect(existsSync(worker.worktreePath!)).toBe(true);
    expect(h.db.get<{ status: string }>('SELECT status FROM worktrees WHERE agent_id = ?', [worker.id])!.status).toBe('dirty');
  });

  it('spawns a curator with no worktree', async () => {
    const curator = await workers.spawnCurator(SYSTEM, h.projectId);
    expect(curator.worktreePath).toBeNull();
    expect(curator.spawnReason).toBe('knowledge curation');
    expect(existsSync(join(curator.homePath, 'AGENTS.md'))).toBe(true);
  });

  it('ensureConductor is idempotent and renders the conductor home', async () => {
    const a = await workers.ensureConductor();
    const b = await workers.ensureConductor();
    expect(b.id).toBe(a.id);
    expect(a.kind).toBe('conductor');
    expect(readFileSync(join(h.ctx.paths.conductor, 'AGENTS.md'), 'utf8')).toContain('conductor');
  });

  it('pauses and resumes a worker', async () => {
    const worker = await workers.spawnForTicket(SYSTEM, seedTicket().id);
    expect(workers.pause(HUMAN, worker.id, 'lunch').status).toBe('paused');
    expect(workers.resume(HUMAN, worker.id).status).toBe('active');
  });
});
