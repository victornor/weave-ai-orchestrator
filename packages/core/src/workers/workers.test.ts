import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, nowIso } from '@weave-ai/db';
import { FakeRuntime, type RuntimeAdapter } from '@weave-ai/runtime-sdk';
import type { WorktreeProvider } from '@weave-ai/plugin-sdk';
import type { Agent, Ticket } from '@weave-ai/shared';
import { makeHarness, fakeWake, type TestHarness } from '../testing/context.js';
import { createWorkersService, ticketBranch, branchSlug } from './index.js';
import { createDecisionsService } from '../decisions/service.js';
import { createRolesService } from '../roles/index.js';
import { createPlanningService } from '../planning/index.js';
import { createThreadsService } from '../threads/service.js';
import { createTicketsService } from '../tickets/service.js';
import { GitWorktreeProvider } from '../worktrees/git.js';
import { git } from '../util/git.js';
import { runState } from '../runs/active.js';
import type { Actor, WorkersService } from '../api.js';

const SYSTEM: Actor = { kind: 'system', id: null };
const HUMAN: Actor = { kind: 'human', id: 'victor' };
const CONDUCTOR: Actor = { kind: 'agent', id: 'conductor', runId: 'run-1' };

/** VS-620: the skill sets a home should carry, derived from the shipped manifest's audience. */
const SKILL_MANIFEST = JSON.parse(readFileSync(new URL('../../../../skills/manifest.json', import.meta.url), 'utf8')) as {
  skills: Array<{ name: string; audience: 'worker' | 'weaver' | 'all' }>;
};
const SESSION_SKILL_NAMES = SKILL_MANIFEST.skills.filter((s) => s.audience === 'all').map((s) => s.name).sort();
const WORKER_SKILL_NAMES = SKILL_MANIFEST.skills.filter((s) => s.audience === 'worker' || s.audience === 'all').map((s) => s.name).sort();

/** A `FakeRuntime` whose `installInstructions` records the skill names it was handed (VS-620). */
function fakeRuntimeWithInstallSpy(install: RuntimeAdapter['installInstructions']): RuntimeAdapter {
  const runtime: RuntimeAdapter = new FakeRuntime();
  runtime.installInstructions = install;
  return runtime;
}

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

  /** Seed the harness's skills dir with one directory per shipped skill, so `skillsFor` finds them. */
  function seedSkills(): void {
    mkdirSync(h.ctx.skillsDir, { recursive: true });
    for (const s of SKILL_MANIFEST.skills) {
      const dir = join(h.ctx.skillsDir, s.name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), `# ${s.name}\n`, 'utf8');
    }
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
  afterEach(() => {
    vi.unstubAllEnvs();
    h.cleanup();
  });

  describe('compactSession', () => {
    /** Seed a resumable ref on the worker's active session and swap in an adapter that records the call. */
    function withCompactor(): unknown[] {
      const seen: unknown[] = [];
      const rt = new FakeRuntime();
      (rt as unknown as { compactSession: (i: unknown) => Promise<unknown> }).compactSession = async (i: unknown) => { seen.push(i); return { ok: true, via: 'command' }; };
      h.ctx.registries.runtimes.set('claude', rt);
      return seen;
    }

    it('marks the session compacting, calls the runtime, then clears the mark', async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      h.db.run('UPDATE agent_sessions SET session_ref_json = ?, last_context_tokens = ? WHERE agent_id = ?', [JSON.stringify({ sessionId: 'sess-1' }), 150_000, worker.id]);
      const seen = withCompactor();

      expect(await workers.compactSession(HUMAN, worker.id)).toEqual({ started: true, runtime: 'claude' });
      await new Promise((r) => setImmediate(r));

      expect(seen).toHaveLength(1);
      expect((seen[0] as { ref: unknown; configHome: string }).ref).toEqual({ sessionId: 'sess-1' });
      expect((seen[0] as { configHome: string }).configHome).toContain('claude');
      // VS-615: the session's own workspace scopes the runtime's provider and key.
      expect((seen[0] as { workspaceId: string }).workspaceId).toBe(h.workspaceId);
      const row = h.db.get<{ compactingAt: string | null; compactingError: string | null; lastContextTokens: number | null }>(
        'SELECT compacting_at AS compactingAt, compacting_error AS compactingError, last_context_tokens AS lastContextTokens FROM agent_sessions WHERE agent_id = ?', [worker.id],
      )!;
      expect(row.compactingAt).toBeNull();
      expect(row.compactingError).toBeNull();
      expect(row.lastContextTokens).toBeNull();
    });

    it('compacts a persistent session exactly like a worker — the service is already generic over any agent id (VS-495)', async () => {
      h.services.threads = createThreadsService(h.ctx, h.deps);
      const { agent: session } = await workers.ensureSession(HUMAN, h.projectId, h.roleId);
      h.db.run('UPDATE agent_sessions SET session_ref_json = ? WHERE agent_id = ?', [JSON.stringify({ sessionId: 'sess-2' }), session.id]);
      const seen = withCompactor();

      expect(await workers.compactSession(HUMAN, session.id)).toEqual({ started: true, runtime: 'claude' });
      await new Promise((r) => setImmediate(r));

      expect(seen).toHaveLength(1);
      expect((seen[0] as { ref: unknown }).ref).toEqual({ sessionId: 'sess-2' });
    });

    it('records the failure message when the runtime refuses', async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      h.db.run('UPDATE agent_sessions SET session_ref_json = ?, last_context_tokens = ? WHERE agent_id = ?', [JSON.stringify({ sessionId: 'sess-1' }), 150_000, worker.id]);
      const rt = new FakeRuntime();
      (rt as unknown as { compactSession: () => Promise<unknown> }).compactSession = async () => ({ ok: false, error: { code: 'x', message: 'nope' } });
      h.ctx.registries.runtimes.set('claude', rt);

      await workers.compactSession(HUMAN, worker.id);
      await new Promise((r) => setImmediate(r));
      expect(h.db.get<{ compactingError: string | null; lastContextTokens: number | null }>('SELECT compacting_error AS compactingError, last_context_tokens AS lastContextTokens FROM agent_sessions WHERE agent_id = ?', [worker.id])).toMatchObject({ compactingError: 'nope', lastContextTokens: null });
    });

    it('refuses while a turn is running', async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      h.db.run('UPDATE agent_sessions SET session_ref_json = ? WHERE agent_id = ?', [JSON.stringify({ sessionId: 'sess-1' }), worker.id]);
      h.db.insert('runs', { id: 'r-active', workspaceId: h.workspaceId, agentId: worker.id, runtimeId: 'claude', status: 'running', turnEpoch: 1, cwd: '/tmp', createdAt: nowIso() });
      await expect(workers.compactSession(HUMAN, worker.id)).rejects.toThrow(/turn running/);
    });

    it('refuses when the session has no resumable ref', async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      await expect(workers.compactSession(HUMAN, worker.id)).rejects.toThrow(/no resumable session/);
    });
  });

  it('derives the ticket branch and change name from the identifier and title', () => {
    const t = { identifier: 'TST-42', title: 'Add dark mode to the dashboard!' } as Ticket;
    expect(ticketBranch(t)).toBe('ac/tst-42-add-dark-mode-to-the-dashboard');
    expect(branchSlug('///')).toBe('work');
  });

  it('spawns a worker: home, worktree, ticket binding and the first wake', async () => {
    const ticket = seedTicket();
    const worker = await workers.spawnForTicket(HUMAN, ticket.id);

    expect(worker.status).toBe('active');
    expect(worker.name).toBe('Backend Engineer #1');
    expect(worker.homePath).toBe(join(h.ctx.paths.workers, worker.id));
    expect(worker.worktreePath).toBe(join(worker.homePath, 'work'));
    expect(worker.branch).toBe('ac/tst-1-add-dark-mode');
    expect(existsSync(join(worker.homePath, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(worker.homePath, 'brief.md'))).toBe(true);
    expect(existsSync(join(worker.homePath, 'notes.md'))).toBe(true);
    expect(existsSync(join(worker.worktreePath!, 'README.md'))).toBe(true);
    expect(readFileSync(join(worker.homePath, 'brief.md'), 'utf8')).toContain('TST-1 — Add dark mode');

    const wt = h.db.get<{ branch: string; status: string; provider: string }>('SELECT * FROM worktrees WHERE agent_id = ?', [worker.id])!;
    expect(wt).toMatchObject({ branch: 'ac/tst-1-add-dark-mode', status: 'active', provider: 'git' });

    const bound = h.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [ticket.id])!;
    expect(bound.workerId).toBe(worker.id);
    expect(bound.openspecChangeName).toBe('tst-1-add-dark-mode');

    expect(wake.calls).toHaveLength(1);
    expect(wake.calls[0]).toMatchObject({ agentId: worker.id, input: expect.objectContaining({ source: 'ticket_assigned' }) });
    expect(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM agent_sessions WHERE agent_id = ?', [worker.id])!.n).toBe(1);
  });

  describe('startInteractiveSession (VS-101)', () => {
    it('marks an existing ticket interactive and spawns its worker, exactly as spawnForTicket would', async () => {
      const ticket = seedTicket();
      const agent = await workers.startInteractiveSession(HUMAN, { ticketId: ticket.id });
      expect(agent.ticketId).toBe(ticket.id);
      expect(agent.worktreePath).toBeTruthy();
      const updated = h.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [ticket.id])!;
      expect(updated.interactiveSession).toBeTruthy();
    });

    it('creates a fresh ticket marked interactive when no ticketId is given', async () => {
      // The harness's ticket fake ignores its input by default (it exists to satisfy spawnCurator's
      // fixed ticket); this test needs the input actually respected, so it swaps in a real insert.
      (h.services.tickets!.create as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (_actor: Actor, input: { kind: string; title: string; description?: string; assigneeRoleId?: string; interactiveSession?: boolean }) =>
          seedTicket({
            number: 9, identifier: 'TST-9', kind: input.kind, title: input.title, description: input.description ?? '',
            assigneeRoleId: input.assigneeRoleId, interactiveSession: input.interactiveSession ?? false,
          }),
      );
      const agent = await workers.startInteractiveSession(HUMAN, {
        projectId: h.projectId, roleId: h.roleId, kind: 'task', title: 'Debug the flaky test',
      });
      const ticket = h.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [agent.ticketId!])!;
      expect(ticket.title).toBe('Debug the flaky test');
      expect(ticket.interactiveSession).toBeTruthy();
      expect(agent.worktreePath).toBeTruthy();
    });

    it('returns the existing worker rather than spawning a second one', async () => {
      const ticket = seedTicket();
      const first = await workers.startInteractiveSession(HUMAN, { ticketId: ticket.id });
      const second = await workers.startInteractiveSession(HUMAN, { ticketId: ticket.id });
      expect(second.id).toBe(first.id);
    });
  });

  it('returns the existing worker instead of spawning twice for a ticket', async () => {
    const ticket = seedTicket();
    const a = await workers.spawnForTicket(SYSTEM, ticket.id);
    const b = await workers.spawnForTicket(SYSTEM, ticket.id);
    expect(b.id).toBe(a.id);
  });

  it('still spawns when the role is at its stored maxWorkers and the project has room', async () => {
    h.db.update('roles', h.roleId, { maxWorkers: 1 });
    await workers.spawnForTicket(SYSTEM, seedTicket().id);
    const second = seedTicket({ number: 2, identifier: 'TST-2', title: 'Second thing' });
    const spawned = await workers.spawnForTicket(SYSTEM, second.id);
    expect(spawned.status).toBe('active');
  });

  it('refuses to spawn when the project is at its worker limit', async () => {
    h.db.update('projects', h.projectId, { maxWorkers: 1 });
    await workers.spawnForTicket(SYSTEM, seedTicket().id);
    const second = seedTicket({ number: 2, identifier: 'TST-2', title: 'Second thing' });
    await expect(workers.spawnForTicket(SYSTEM, second.id)).rejects.toMatchObject({ code: 'role_full' });
  });

  it('picks a new project limit up on the next spawn, and lowering it never cancels a live worker', async () => {
    h.db.update('projects', h.projectId, { maxWorkers: 1 });
    const first = await workers.spawnForTicket(SYSTEM, seedTicket().id);
    const second = seedTicket({ number: 2, identifier: 'TST-2', title: 'Second thing' });
    await expect(workers.spawnForTicket(SYSTEM, second.id)).rejects.toMatchObject({ code: 'role_full' });

    h.db.update('projects', h.projectId, { maxWorkers: 2 });
    const spawned = await workers.spawnForTicket(SYSTEM, second.id);
    expect(spawned.status).toBe('active');

    h.db.update('projects', h.projectId, { maxWorkers: 1 });
    for (const w of [first, spawned]) expect(workers.get(w.id).status).toBe('active');
    const third = seedTicket({ number: 3, identifier: 'TST-3', title: 'Third thing' });
    await expect(workers.spawnForTicket(SYSTEM, third.id)).rejects.toMatchObject({ code: 'role_full' });
  });

  it('spawns a third worker of one role when the project still has a slot, even if that role is at its stored max', async () => {
    h.db.update('projects', h.projectId, { maxWorkers: 3 });
    h.db.update('roles', h.roleId, { maxWorkers: 2 });
    const now = nowIso();
    const otherRoleId = newId();
    h.db.insert('roles', {
      id: otherRoleId, workspaceId: h.workspaceId, projectId: h.projectId, slug: 'frontend', name: 'Frontend Engineer',
      charterSummary: 'Owns the ui.', scopeText: 'Frontend work.', sessionPolicy: 'per_ticket', maxWorkers: 2,
      status: 'active', specRevision: 1, createdBy: 'conductor', createdAt: now, updatedAt: now,
    });

    await workers.spawnForTicket(SYSTEM, seedTicket().id);
    await workers.spawnForTicket(SYSTEM, seedTicket({ number: 2, identifier: 'TST-2', title: 'Second thing' }).id);
    const third = await workers.spawnForTicket(SYSTEM, seedTicket({ number: 3, identifier: 'TST-3', title: 'Third thing' }).id);
    expect(third.status).toBe('active');

    const fourth = seedTicket({ number: 4, identifier: 'TST-4', title: 'Fourth thing' });
    await expect(workers.spawnForTicket(SYSTEM, fourth.id)).rejects.toMatchObject({ code: 'role_full' });
    const otherTicket = seedTicket({ number: 5, identifier: 'TST-5', title: 'Other role', assigneeRoleId: otherRoleId });
    await expect(workers.spawnForTicket(SYSTEM, otherTicket.id)).rejects.toMatchObject({ code: 'role_full' });
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

  it('refuses to provision a worker before creating a worktree when Git identity is missing', async () => {
    await git(['config', '--local', '--unset', 'user.name'], clonePath);
    await git(['config', '--local', '--unset', 'user.email'], clonePath);
    vi.stubEnv('GIT_CONFIG_GLOBAL', join(h.ctx.paths.root, 'missing-global-gitconfig'));
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    const ticket = seedTicket();

    await expect(workers.spawnForTicket(SYSTEM, ticket.id)).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('user.name and user.email'),
    });
    expect(h.db.all("SELECT * FROM agents WHERE kind = 'worker'")).toHaveLength(0);
    expect(h.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [ticket.id])!.workerId).toBeNull();
    expect(h.db.all('SELECT * FROM worktrees')).toHaveLength(0);
  });

  it('keeps a worker with a modified tracked file and marks its worktree dirty', async () => {
    const ticket = seedTicket();
    const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
    writeFileSync(join(worker.worktreePath!, 'README.md'), '# changed by hand\n', 'utf8');
    const result = await workers.retireIfLanded(SYSTEM, worker.id);
    expect(result.retired).toBe(false);
    expect(result.reason).toMatch(/uncommitted/);
    expect(h.db.get<{ status: string }>('SELECT status FROM worktrees WHERE agent_id = ?', [worker.id])!.status).toBe('dirty');
    expect(h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [worker.id])!.status).toBe('active');
  });

  it('keeps a terminal worker whose commit has not landed, recording the reason (VS-333)', async () => {
    h.db.update('projects', h.projectId, { policiesJson: { deliveryMode: 'local-branch' } });
    const ticket = seedTicket({ status: 'done' });
    const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
    writeFileSync(join(worker.worktreePath!, 'unmerged.txt'), 'x', 'utf8');
    await git(['add', '.'], worker.worktreePath!);
    await git(['commit', '-m', 'feat: unmerged'], worker.worktreePath!);
    h.db.update('agents', worker.id, { status: 'done' });

    const result = await workers.retireIfLanded(SYSTEM, worker.id);
    expect(result.retired).toBe(false);
    expect(result.reason).toMatch(/not contained/);
    expect(h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [worker.id])!.errorText).toMatch(/not contained/);
  });

  it('retires a landed worker with untracked leftovers, archiving them and leaving a trail (VS-333)', async () => {
    h.db.update('projects', h.projectId, { policiesJson: { deliveryMode: 'local-branch' } });
    const ticket = seedTicket({ status: 'done' });
    const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
    const wtPath = worker.worktreePath!;
    writeFileSync(join(wtPath, 'committed.txt'), 'ok', 'utf8');
    await git(['add', '.'], wtPath);
    await git(['commit', '-m', 'feat: landed'], wtPath);
    await git(['merge', '--ff-only', worker.branch!], clonePath);
    mkdirSync(join(wtPath, '.review-screenshots'), { recursive: true });
    writeFileSync(join(wtPath, '.review-screenshots', 'a.png'), 'png', 'utf8');
    writeFileSync(join(wtPath, 'notes.md'), 'scratch', 'utf8');

    const result = await workers.retireIfLanded(SYSTEM, worker.id);
    expect(result.retired).toBe(true);
    expect(existsSync(wtPath)).toBe(false);
    expect(existsSync(join(h.ctx.paths.archive, worker.id, 'untracked', '.review-screenshots', 'a.png'))).toBe(true);
    expect(existsSync(join(h.ctx.paths.archive, worker.id, 'untracked', 'notes.md'))).toBe(true);
    expect(existsSync(join(h.ctx.paths.archive, worker.id, 'brief.md'))).toBe(true);

    const comment = vi.mocked(h.services.tickets!.comment).mock.calls.at(-1);
    expect(comment?.[2]).toContain('.review-screenshots/a.png');
    expect(comment?.[2]).toContain('notes.md');
    const activity = h.db.get<{ details: Record<string, unknown> }>("SELECT details_json FROM activity WHERE action = 'worker.retire' AND entity_id = ?", [worker.id])!;
    expect(JSON.stringify(activity.details.archivedUntracked)).toContain('notes.md');
  });

  it('caps the archived-file trail at 50 paths and reports the remainder (VS-333)', async () => {
    h.db.update('projects', h.projectId, { policiesJson: { deliveryMode: 'local-branch' } });
    const ticket = seedTicket({ status: 'done' });
    const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
    const wtPath = worker.worktreePath!;
    writeFileSync(join(wtPath, 'ok.txt'), 'ok', 'utf8');
    await git(['add', '.'], wtPath);
    await git(['commit', '-m', 'feat: landed'], wtPath);
    await git(['merge', '--ff-only', worker.branch!], clonePath);
    mkdirSync(join(wtPath, 'leftovers'), { recursive: true });
    for (let i = 0; i < 51; i++) writeFileSync(join(wtPath, 'leftovers', `f${String(i).padStart(2, '0')}.txt`), 'x', 'utf8');

    const result = await workers.retireIfLanded(SYSTEM, worker.id);
    expect(result.retired).toBe(true);
    const comment = vi.mocked(h.services.tickets!.comment).mock.calls.at(-1);
    expect(comment?.[2]).toContain('and 1 more.');
  });

  it('retires a squash-merged worker whose stored PR record is stale open, after a forge refresh (VS-333)', async () => {
    const ticket = seedTicket({ status: 'done' });
    const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
    const wtPath = worker.worktreePath!;
    writeFileSync(join(wtPath, 'squashed.txt'), 'content\n', 'utf8');
    await git(['add', '.'], wtPath);
    await git(['commit', '-m', 'feat: squashed'], wtPath);
    const sha = (await git(['rev-parse', 'HEAD'], wtPath)).stdout.trim();
    await git(['cherry-pick', '--no-commit', sha], clonePath);
    await git(['commit', '-m', 'feat: squashed (#1)'], clonePath);
    h.db.insert('ticket_work_products', {
      id: newId(), ticketId: ticket.id, type: 'pull_request', provider: 'github', url: 'https://github.com/acme/api/pull/1',
      title: 'PR 1', state: 'open', isPrimary: 1, createdAt: nowIso(), updatedAt: nowIso(),
    });
    const prState = vi.fn(async () => ({ state: 'merged' as const, mergeCommit: sha, ciState: 'success' as const }));
    h.ctx.registries.forges.set('github', { id: 'github', detect: async () => true, prState } as never);

    const result = await workers.retireIfLanded(SYSTEM, worker.id);
    expect(result.retired).toBe(true);
    expect(prState).toHaveBeenCalledTimes(1);
    expect(h.db.get<{ state: string }>('SELECT state FROM ticket_work_products WHERE ticket_id = ?', [ticket.id])!.state).toBe('merged');
  });

  it('throttles the forge refresh across retirement attempts (VS-333)', async () => {
    h.db.update('projects', h.projectId, { policiesJson: { deliveryMode: 'local-branch' } });
    const ticket = seedTicket({ status: 'done' });
    const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
    writeFileSync(join(worker.worktreePath!, 'open.txt'), 'x', 'utf8');
    await git(['add', '.'], worker.worktreePath!);
    await git(['commit', '-m', 'feat: open'], worker.worktreePath!);
    h.db.insert('ticket_work_products', {
      id: newId(), ticketId: ticket.id, type: 'pull_request', provider: 'github', url: 'https://github.com/acme/api/pull/2',
      title: 'PR 2', state: 'open', isPrimary: 1, createdAt: nowIso(), updatedAt: nowIso(),
    });
    const prState = vi.fn(async () => ({ state: 'open' as const }));
    h.ctx.registries.forges.set('github', { id: 'github', detect: async () => true, prState } as never);

    expect((await workers.retireIfLanded(SYSTEM, worker.id)).retired).toBe(false);
    expect((await workers.retireIfLanded(SYSTEM, worker.id)).retired).toBe(false);
    expect(prState).toHaveBeenCalledTimes(1);
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

  // VS-56: resume used to flip the column and stop there, so the endpoint, the CLI verb and the web
  // button all did nothing. It has to queue the turn and unblock the ticket.
  describe('resuming a paused worker', () => {
    const parked = async (): Promise<{ ticket: Ticket; worker: Agent }> => {
      const ticket = seedTicket({ status: 'blocked' });
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      h.db.update('agents', worker.id, {
        status: 'paused', pauseReason: 'rate_limit: waiting for a human',
        pauseDetailJson: { family: 'provider_quota', code: 'rate_limit', message: 'limit resets in 2 hours', resetAt: null, runId: 'r1' },
      });
      wake.calls.length = 0;
      return { ticket, worker };
    };

    it('clears the pause, queues a turn and unblocks the ticket without touching the worktree', async () => {
      const { ticket, worker } = await parked();

      const after = workers.resume(HUMAN, worker.id);

      expect(after).toMatchObject({ status: 'active', pauseReason: null, pauseDetail: null });
      expect(after.worktreePath).toBe(worker.worktreePath);
      expect(after.branch).toBe(worker.branch);
      expect(after.briefRevision).toBe(worker.briefRevision);
      expect(existsSync(worker.worktreePath!)).toBe(true);
      expect(wake.calls.filter((c) => c.agentId === worker.id)).toHaveLength(1);
      expect(wake.calls[0]).toMatchObject({ agentId: worker.id, input: expect.objectContaining({ source: 'system', reason: 'resumed' }) });
      // This ticket was seeded straight into `blocked` with no `blockedFromStatus` recorded (that
      // field is only ever set by `tickets.transition()` itself, VS-118), so `todo` here is the
      // documented fallback for "no prior status known" — not the bug the tests below cover.
      expect(h.services.tickets!.transition).toHaveBeenCalledWith(HUMAN, ticket.id, expect.objectContaining({ to: 'todo' }));
    });

    // VS-118: resume used to pick `in_progress` vs `todo` from `ticket.executionRunId`, which
    // `finalize()` always clears before a run can be parked — so it always read `todo` and a
    // parked `change` ticket lost its approval, forcing a full re-approval of an unchanged plan.
    it('restores an approved change ticket to approved, not todo', async () => {
      const ticket = seedTicket({ status: 'blocked', blockedFromStatus: 'approved' });
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      h.db.update('agents', worker.id, {
        status: 'paused', pauseReason: 'tooling: waiting for a human',
        pauseDetailJson: { family: 'tooling', code: 'exit_143', message: 'the process was killed', resetAt: null, runId: 'r1' },
      });
      wake.calls.length = 0;

      workers.resume(HUMAN, worker.id);

      expect(h.services.tickets!.transition).toHaveBeenCalledWith(HUMAN, ticket.id, expect.objectContaining({ to: 'approved' }));
    });

    it('restores a parked in_progress task ticket to in_progress, not todo', async () => {
      const ticket = seedTicket({ kind: 'task', status: 'blocked', blockedFromStatus: 'in_progress' });
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      h.db.update('agents', worker.id, {
        status: 'paused', pauseReason: 'tooling: waiting for a human',
        pauseDetailJson: { family: 'tooling', code: 'exit_143', message: 'the process was killed', resetAt: null, runId: 'r1' },
      });
      wake.calls.length = 0;

      workers.resume(HUMAN, worker.id);

      expect(h.services.tickets!.transition).toHaveBeenCalledWith(HUMAN, ticket.id, expect.objectContaining({ to: 'in_progress' }));
    });

    // VS-625: the worker going back to work makes the card raised for its stop stale, so it must be
    // closed before the turn is claimed — otherwise a late answer could start a second turn.
    it('closes the worker\'s open retry card when it is resumed', async () => {
      const { ticket, worker } = await parked();
      const decisions = createDecisionsService(h.ctx, h.deps);
      h.services.decisions = decisions;
      const card = decisions.create(SYSTEM, { ticketId: ticket.id, kind: 'retry_approval', owner: 'human', title: 'failed', correlationKey: `retry:${worker.id}`, target: { agentId: worker.id, ticketId: ticket.id } });

      workers.resume(HUMAN, worker.id);

      expect(decisions.get(card.id)).toMatchObject({ status: 'superseded' });
      expect(decisions.get(card.id).answerText).toMatch(/resumed by the human/);
      expect(decisions.list({ status: ['open'], ticketId: ticket.id })).toHaveLength(0);
    });

    it('closes the worker\'s stalled-worker finding when it is resumed', async () => {
      const { ticket, worker } = await parked();
      const decisions = createDecisionsService(h.ctx, h.deps);
      h.services.decisions = decisions;
      const finding = decisions.create(SYSTEM, { ticketId: ticket.id, kind: 'gate_finding', owner: 'weaver', title: 'stalled', correlationKey: `stalled-worker:${worker.id}` });

      workers.resume(HUMAN, worker.id);

      expect(decisions.get(finding.id).status).toBe('superseded');
    });

    it('closes the retry card when the conductor relaunches a parked worker', async () => {
      const { ticket, worker } = await parked();
      const decisions = createDecisionsService(h.ctx, h.deps);
      h.services.decisions = decisions;
      const card = decisions.create(SYSTEM, { ticketId: ticket.id, kind: 'retry_approval', owner: 'human', title: 'failed', correlationKey: `retry:${worker.id}`, target: { agentId: worker.id, ticketId: ticket.id } });

      await workers.relaunch(CONDUCTOR, worker.id, 'you look stuck');

      expect(decisions.get(card.id).status).toBe('superseded');
      expect(decisions.get(card.id).answerText).toMatch(/resumed by the weaver/);
    });

    it('raises a fresh retry card when the worker fails again after a resume', async () => {
      const { ticket, worker } = await parked();
      const decisions = createDecisionsService(h.ctx, h.deps);
      h.services.decisions = decisions;
      const first = decisions.create(SYSTEM, { ticketId: ticket.id, kind: 'retry_approval', owner: 'human', title: 'failed', correlationKey: `retry:${worker.id}`, target: { agentId: worker.id, ticketId: ticket.id } });

      workers.resume(HUMAN, worker.id);
      expect(decisions.get(first.id).status).toBe('superseded');
      // A later failure raises the card again under the same key; nothing is left to supersede.
      const second = decisions.create(SYSTEM, { ticketId: ticket.id, kind: 'retry_approval', owner: 'human', title: 'failed again', correlationKey: `retry:${worker.id}`, target: { agentId: worker.id, ticketId: ticket.id } });
      expect(decisions.get(second.id).status).toBe('open');
      expect(decisions.list({ status: ['open'], ticketId: ticket.id })).toHaveLength(1);
    });

    it('queues nothing for a worker that was not paused', async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      wake.calls.length = 0;
      expect(workers.resume(HUMAN, worker.id).status).toBe('active');
      expect(wake.calls).toHaveLength(0);
    });

    it('relaunching a worker parked after a failure resumes it instead', async () => {
      const { worker } = await parked();

      const after = await workers.relaunch({ kind: 'agent', id: 'conductor' }, worker.id, 'you look stuck');

      // Resume, not relaunch: the brief is untouched, so the session and its progress stand.
      expect(after.briefRevision).toBe(worker.briefRevision);
      expect(after).toMatchObject({ status: 'active', pauseDetail: null });
      expect(wake.calls[0]!.input).toMatchObject({ source: 'system', reason: 'resumed' });
      expect(readFileSync(join(worker.homePath, 'brief.md'), 'utf8')).not.toContain('you look stuck');
    });

    it('still relaunches a worker that failed without being parked', async () => {
      const ticket = seedTicket({ status: 'in_progress' });
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      h.db.update('agents', worker.id, { status: 'error', errorText: 'the CLI died' });
      wake.calls.length = 0;

      const after = await workers.relaunch(HUMAN, worker.id, 'try again');
      expect(after.briefRevision).toBe(worker.briefRevision + 1);
      expect(wake.calls[0]!.input).toMatchObject({ source: 'system', reason: 'relaunch' });
    });
  });

  it('is a no-op that reports the wait when a shutdown already left the resume queued (VS-375)', async () => {
    const ticket = seedTicket({ status: 'in_progress' });
    const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
    const wakeId = newId();
    const at = nowIso();
    h.db.run('INSERT INTO wakeups (id, workspace_id, agent_id, source, reason, status, created_at) VALUES (?,?,?,?,?,?,?)',
      [wakeId, h.workspaceId, worker.id, 'retry', 'previous turn was interrupted', 'queued', at]);
    h.db.run(
      `INSERT INTO runs (id, workspace_id, agent_id, ticket_id, wakeup_ids_json, runtime_id, status, turn_epoch, cwd, error_code, error_family, finished_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [newId(), h.workspaceId, worker.id, ticket.id, JSON.stringify([wakeId]), 'claude', 'interrupted', 1, '/tmp/w', 'interrupted_by_shutdown', 'tooling', at, at],
    );
    wake.calls.length = 0;

    const after = await workers.relaunch(HUMAN, worker.id, 'you look stuck');

    expect(after.notice).toBe('already queued; waiting for a run slot');
    // Nothing was relaunched: the brief is untouched and no wake was enqueued.
    expect(after.briefRevision).toBe(worker.briefRevision);
    expect(readFileSync(join(worker.homePath, 'brief.md'), 'utf8')).not.toContain('you look stuck');
    expect(wake.calls).toHaveLength(0);
  });

  it('messages a worker as a ticket comment plus a conductor_request wake when the caller asks for no live delivery', async () => {
    const ticket = seedTicket();
    const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
    wake.calls.length = 0;
    // This pins the *service's own* default (queued) when a caller omits `live` entirely — not the
    // conductor's `weave_worker_message` tool, which defaults to `live: true` at the tool layer (VS-103)
    // and is covered separately in packages/server/test/mcp.test.ts.
    const outcome = await workers.message({ kind: 'agent', id: 'conductor' }, worker.id, 'use CSS variables');
    expect(h.services.tickets!.comment).toHaveBeenCalledWith(expect.anything(), ticket.id, 'use CSS variables', 'relay', 'agent');
    expect(wake.calls[0]!.input).toMatchObject({ source: 'conductor_request' });
    expect(outcome).toMatchObject({ delivery: 'queued' });
  });

  describe('the conductor cannot message an interactive session (VS-101)', () => {
    it('refuses an agent actor', async () => {
      const session = await workers.startInteractiveSession(HUMAN, { ticketId: seedTicket().id });
      await expect(workers.message(CONDUCTOR, session.id, 'what are you doing')).rejects.toThrow(/interactive session/);
    });

    it('leaves a human actor unaffected', async () => {
      const session = await workers.startInteractiveSession(HUMAN, { ticketId: seedTicket().id });
      const outcome = await workers.message(HUMAN, session.id, 'go ahead');
      expect(outcome).toMatchObject({ delivery: 'queued' });
    });

    it('does not refuse the conductor on an ordinary (non-session) ticket', async () => {
      const worker = await workers.spawnForTicket(SYSTEM, seedTicket().id);
      const outcome = await workers.message(CONDUCTOR, worker.id, 'status?');
      expect(outcome).toMatchObject({ delivery: 'queued' });
    });
  });

  describe('message: mid-turn vs queued delivery (VS-99)', () => {
    function seedRun(worker: Agent, status = 'running'): string {
      const runId = newId();
      h.db.insert('runs', {
        id: runId, workspaceId: h.workspaceId, agentId: worker.id, wakeupIdsJson: [], runtimeId: 'fake',
        status, turnEpoch: 1, cwd: worker.homePath, createdAt: nowIso(),
      });
      return runId;
    }

    it('delivers mid-turn when `live` is asked for and the active run accepts the frame, and never also queues', async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      wake.calls.length = 0;
      const runId = seedRun(worker);
      const sent: string[] = [];
      runState(h.ctx).active.set(runId, {
        runId, agentId: worker.id, startedAt: Date.now(), pid: 1,
        cancel: async () => undefined,
        send: async (text: string) => { sent.push(text); return 'delivered'; },
      });

      const outcome = await workers.message(HUMAN, worker.id, 'check the failing test', { live: true });
      expect(outcome).toEqual({ delivery: 'mid_turn', runId, wake: null });
      expect(sent).toEqual(['check the failing test']);
      expect(wake.calls).toHaveLength(0); // never both delivered and queued

      const events = h.db.all<{ type: string; payload: Record<string, unknown> }>('SELECT type, payload_json FROM run_events WHERE run_id = ?', [runId]);
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('human.input');
      expect(events[0]!.payload).toMatchObject({ text: 'check the failing test', authorKind: 'human', authorId: 'victor', delivery: 'mid_turn' });
    });

    it('queues when `live` is not asked for, even though the runtime could take it mid-turn', async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      wake.calls.length = 0;
      const runId = seedRun(worker);
      runState(h.ctx).active.set(runId, {
        runId, agentId: worker.id, startedAt: Date.now(), pid: 1,
        cancel: async () => undefined, send: async () => 'delivered',
      });

      const outcome = await workers.message(HUMAN, worker.id, 'later is fine');
      expect(outcome.delivery).toBe('queued');
      expect(outcome.wake).not.toBeNull();
      expect(wake.calls).toHaveLength(1);
    });

    it("a human's live message interrupts a running turn on a runtime with no `send` (VS-254)", async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      wake.calls.length = 0;
      const runId = seedRun(worker);
      runState(h.ctx).active.set(runId, { runId, agentId: worker.id, startedAt: Date.now(), pid: 1, cancel: async () => undefined });

      const outcome = await workers.message(HUMAN, worker.id, 'stop, wrong direction', { live: true });
      expect(outcome.delivery).toBe('interrupted');
      expect(outcome.runId).toBe(runId);
      expect(outcome.wake).not.toBeNull();
      expect(h.services.runs!.cancel).toHaveBeenCalledWith(HUMAN, runId, 'interrupt', 'message');
      expect(wake.calls).toHaveLength(1);
      expect(wake.calls[0]).toMatchObject({ agentId: worker.id, input: expect.objectContaining({ source: 'live_interrupt' }) });

      const events = h.db.all<{ payload: Record<string, unknown> }>('SELECT payload_json FROM run_events WHERE run_id = ?', [runId]);
      expect(events[0]!.payload).toMatchObject({ delivery: 'interrupted' });
    });

    it("does not interrupt a live message on the conductor's behalf — only a human's send can (VS-254)", async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      wake.calls.length = 0;
      const runId = seedRun(worker);
      runState(h.ctx).active.set(runId, { runId, agentId: worker.id, startedAt: Date.now(), pid: 1, cancel: async () => undefined });

      const outcome = await workers.message(CONDUCTOR, worker.id, 'also, when you get a chance', { live: true });
      expect(outcome.delivery).toBe('queued');
      expect(outcome.wake).not.toBeNull();
      expect(h.services.runs!.cancel).not.toHaveBeenCalled();
      expect(wake.calls).toHaveLength(1);
      expect(wake.calls[0]).toMatchObject({ input: expect.objectContaining({ source: 'conductor_request' }) });
    });

    it('a live message queues, not interrupts, when the runtime has no `send` and no turn is running', async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      wake.calls.length = 0;

      const outcome = await workers.message(HUMAN, worker.id, 'no turn to interrupt', { live: true });
      expect(outcome.delivery).toBe('queued');
      expect(h.services.runs!.cancel).not.toHaveBeenCalled();
      expect(wake.calls).toHaveLength(1);
    });

    it("carries a live-interrupt message whole in the wake body (VS-254)", async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      wake.calls.length = 0;
      const runId = seedRun(worker);
      runState(h.ctx).active.set(runId, { runId, agentId: worker.id, startedAt: Date.now(), pid: 1, cancel: async () => undefined });
      const longBody = 'x'.repeat(8500);

      const outcome = await workers.message(HUMAN, worker.id, longBody, { live: true });
      expect(outcome.delivery).toBe('interrupted');
      const call = wake.calls[0]!;
      const input = call.input as { reason: string; payload: Record<string, unknown> };
      expect(input.reason).toBe(longBody);
      expect(input.payload).toMatchObject({ message: longBody });
      expect(input.payload).not.toHaveProperty('truncated');
      // The same untruncated body is on the ticket too.
      expect(h.services.tickets!.comment).toHaveBeenCalledWith(expect.anything(), ticket.id, longBody, 'relay', 'trusted');
    });

    it("queues when `send` reports the channel is closed — the turn's result already arrived", async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      wake.calls.length = 0;
      const runId = seedRun(worker);
      runState(h.ctx).active.set(runId, {
        runId, agentId: worker.id, startedAt: Date.now(), pid: 1,
        cancel: async () => undefined, send: async () => 'closed',
      });

      const outcome = await workers.message(HUMAN, worker.id, 'too late', { live: true });
      expect(outcome.delivery).toBe('queued');
      expect(wake.calls).toHaveLength(1);
    });

    it('the ticket comment is recorded even when `send` throws', async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      wake.calls.length = 0;
      const runId = seedRun(worker);
      runState(h.ctx).active.set(runId, {
        runId, agentId: worker.id, startedAt: Date.now(), pid: 1,
        cancel: async () => undefined, send: async () => { throw new Error('pipe is gone'); },
      });

      const outcome = await workers.message(HUMAN, worker.id, 'are you still there', { live: true });
      expect(outcome.delivery).toBe('queued');
      expect(h.services.tickets!.comment).toHaveBeenCalledWith(expect.anything(), ticket.id, 'are you still there', 'relay', 'trusted');
      expect(wake.calls).toHaveLength(1);
    });

    it('a mid-turn message leaves an open decision open and touches no permission or tool config', async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      wake.calls.length = 0;
      const runId = seedRun(worker);
      runState(h.ctx).active.set(runId, {
        runId, agentId: worker.id, startedAt: Date.now(), pid: 1,
        cancel: async () => undefined, send: async () => 'delivered',
      });
      const decisionId = newId();
      h.db.insert('decisions', {
        id: decisionId, workspaceId: h.workspaceId, ticketId: ticket.id, kind: 'question', owner: 'human',
        title: 'Which approach?', context: '', status: 'open', createdAt: nowIso(),
      });
      const roleBefore = h.db.get<{ permissionJson: string }>('SELECT permission_json FROM roles WHERE id = ?', [h.roleId]);

      await workers.message(HUMAN, worker.id, 'go with option A', { live: true });

      expect(h.db.get<{ status: string }>('SELECT status FROM decisions WHERE id = ?', [decisionId])!.status).toBe('open');
      const roleAfter = h.db.get<{ permissionJson: string }>('SELECT permission_json FROM roles WHERE id = ?', [h.roleId]);
      expect(roleAfter).toEqual(roleBefore);
    });

    it('a mid-turn message from the conductor leaves an open decision open and touches no permission or tool config (VS-103)', async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      wake.calls.length = 0;
      const runId = seedRun(worker);
      const sent: string[] = [];
      runState(h.ctx).active.set(runId, {
        runId, agentId: worker.id, startedAt: Date.now(), pid: 1,
        cancel: async () => undefined,
        send: async (text: string) => { sent.push(text); return 'delivered'; },
      });
      const decisionId = newId();
      h.db.insert('decisions', {
        id: decisionId, workspaceId: h.workspaceId, ticketId: ticket.id, kind: 'question', owner: 'human',
        title: 'Which approach?', context: '', status: 'open', createdAt: nowIso(),
      });
      const roleBefore = h.db.get<{ permissionJson: string }>('SELECT permission_json FROM roles WHERE id = ?', [h.roleId]);

      const outcome = await workers.message(CONDUCTOR, worker.id, 'scope changed, drop the CSV export', { live: true });

      expect(outcome).toMatchObject({ delivery: 'mid_turn' });
      expect(sent).toEqual(['scope changed, drop the CSV export']);
      expect(wake.calls).toHaveLength(0);
      expect(h.services.tickets!.comment).toHaveBeenCalledWith(expect.anything(), ticket.id, 'scope changed, drop the CSV export', 'relay', 'agent');
      expect(h.db.get<{ status: string }>('SELECT status FROM decisions WHERE id = ?', [decisionId])!.status).toBe('open');
      const roleAfter = h.db.get<{ permissionJson: string }>('SELECT permission_json FROM roles WHERE id = ?', [h.roleId]);
      expect(roleAfter).toEqual(roleBefore);
    });
  });

  describe('message: refuses a retired worker (VS-106)', () => {
    it('throws wrong_status and records no comment and no wake', async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      h.db.update('agents', worker.id, { status: 'retired', updatedAt: nowIso() });
      wake.calls.length = 0;
      vi.mocked(h.services.tickets!.comment).mockClear();

      await expect(workers.message(HUMAN, worker.id, 'are you still there', { live: true }))
        .rejects.toMatchObject({ code: 'wrong_status' });
      expect(h.services.tickets!.comment).not.toHaveBeenCalled();
      expect(wake.calls).toHaveLength(0);
    });

    it('a non-retired worker is unaffected', async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      wake.calls.length = 0;

      const outcome = await workers.message(HUMAN, worker.id, 'still here', { live: true });
      expect(outcome.delivery).toBe('queued');
      expect(h.services.tickets!.comment).toHaveBeenCalledWith(expect.anything(), ticket.id, 'still here', 'relay', 'trusted');
    });
  });

  describe('sessionResumable (VS-106)', () => {
    it('is true for a worker with an active session and false once it is closed', async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      expect(workers.sessionResumable(worker.id)).toBe(true);

      h.db.run("UPDATE agent_sessions SET status = 'closed' WHERE agent_id = ?", [worker.id]);
      expect(workers.sessionResumable(worker.id)).toBe(false);
    });
  });

  it('cancel keeps the worktree and marks it dirty', async () => {
    const ticket = seedTicket();
    const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
    const after = await workers.cancel(HUMAN, worker.id, 'no longer needed');
    expect(after.status).toBe('done');
    expect(existsSync(worker.worktreePath!)).toBe(true);
    expect(h.db.get<{ status: string }>('SELECT status FROM worktrees WHERE agent_id = ?', [worker.id])!.status).toBe('dirty');
  });

  it('ending an interactive session is exactly cancel: ticket commented, worktree kept, no new mechanism (VS-101)', async () => {
    const session = await workers.startInteractiveSession(HUMAN, { ticketId: seedTicket().id });
    const after = await workers.cancel(HUMAN, session.id, 'done for now');
    expect(after.status).toBe('done');
    expect(existsSync(session.worktreePath!)).toBe(true);
    expect(h.db.get<{ status: string }>('SELECT status FROM worktrees WHERE agent_id = ?', [session.id])!.status).toBe('dirty');
    expect(h.services.tickets!.comment).toHaveBeenCalledWith(
      expect.anything(), session.ticketId, expect.stringContaining('kept until the work lands or is discarded'), 'status', 'trusted',
    );
  });

  it('spawns a curator with no worktree', async () => {
    const curator = await workers.spawnCurator(SYSTEM, h.projectId);
    expect(curator.worktreePath).toBeNull();
    expect(curator.spawnReason).toBe('knowledge curation');
    expect(existsSync(join(curator.homePath, 'AGENTS.md'))).toBe(true);
  });

  it('spawns a curator with a real worktree and branch for an opted-in project (VS-358)', async () => {
    h.db.run('UPDATE projects SET knowledge_repo_enabled = 1 WHERE id = ?', [h.projectId]);
    const curator = await workers.spawnCurator(SYSTEM, h.projectId);
    expect(curator.worktreePath).not.toBeNull();
    expect(curator.branch).not.toBeNull();
    expect(curator.spawnReason).toBe('knowledge curation');
  });

  it('ensureConductor is idempotent and renders the weaver home', async () => {
    const a = await workers.ensureConductor();
    const b = await workers.ensureConductor();
    expect(b.id).toBe(a.id);
    expect(a.kind).toBe('weaver');
    expect(a.name).toBe('Weaver');
    expect(readFileSync(join(h.ctx.paths.weaver, 'AGENTS.md'), 'utf8')).toContain('weaver');
  });

  it('pauses and resumes a worker', async () => {
    const worker = await workers.spawnForTicket(SYSTEM, seedTicket().id);
    expect(workers.pause(HUMAN, worker.id, 'lunch').status).toBe('paused');
    expect(workers.resume(HUMAN, worker.id).status).toBe('active');
  });

  describe('session handover (VS-249)', () => {
    async function spawnWithSession(): Promise<import('@weave-ai/shared').Agent> {
      const worker = await workers.spawnForTicket(SYSTEM, seedTicket().id);
      h.db.run("UPDATE agent_sessions SET session_ref_json = ? WHERE agent_id = ?", [JSON.stringify({ sessionId: 'sess-1' }), worker.id]);
      return worker;
    }

    it('handoverCommand says why when the runtime has no session yet', async () => {
      const worker = await workers.spawnForTicket(SYSTEM, seedTicket().id);
      const result = workers.handoverCommand(worker.id);
      expect(result.resumable).toBe(false);
      expect(result.reason).toMatch(/no session/i);
    });

    it('startHandover pauses the worker, opens a hold, and returns a command', async () => {
      const worker = await spawnWithSession();
      const result = await workers.startHandover(HUMAN, worker.id);
      expect(result.resumable).toBe(true);
      expect(result.command).toContain('--resume');
      expect(result.command).toContain('sess-1');

      const after = workers.get(worker.id);
      expect(after.status).toBe('paused');
      expect(after.pauseDetail).toMatchObject({ code: 'held_by_human' });

      const hold = h.db.get<{ status: string; agentId: string }>("SELECT * FROM agent_handovers WHERE agent_id = ? AND status = 'active'", [worker.id]);
      expect(hold).toBeTruthy();
    });

    it('refuses to take a worker with a turn currently running', async () => {
      const worker = await spawnWithSession();
      h.db.insert('runs', { id: 'run-x', workspaceId: h.workspaceId, agentId: worker.id, runtimeId: 'claude', status: 'running', turnEpoch: 1, cwd: worker.homePath, createdAt: nowIso() });
      await expect(workers.startHandover(HUMAN, worker.id)).rejects.toThrow(/running/i);
    });

    it('refuses to take a worker whose session is already held', async () => {
      const worker = await spawnWithSession();
      await workers.startHandover(HUMAN, worker.id);
      await expect(workers.startHandover(HUMAN, worker.id)).rejects.toThrow(/already held/i);
    });

    it('plain resume refuses a worker whose session is held', async () => {
      const worker = await spawnWithSession();
      await workers.startHandover(HUMAN, worker.id);
      expect(() => workers.resume(HUMAN, worker.id)).toThrow(/held by a human/i);
      // The hold itself is unaffected by the refused resume attempt.
      const hold = h.db.get<{ status: string }>("SELECT status FROM agent_handovers WHERE agent_id = ? AND status = 'active'", [worker.id]);
      expect(hold?.status).toBe('active');
    });

    it('endHandover rejects an empty or missing note without changing state', async () => {
      const worker = await spawnWithSession();
      await workers.startHandover(HUMAN, worker.id);
      await expect(workers.endHandover(HUMAN, worker.id, '')).rejects.toThrow(/note/i);
      await expect(workers.endHandover(HUMAN, worker.id, '   ')).rejects.toThrow(/note/i);
      expect(workers.get(worker.id).status).toBe('paused');
    });

    it('endHandover reconciles the worktree, posts a ticket comment, and resumes ordinary dispatch', async () => {
      const worker = await spawnWithSession();
      const started = await workers.startHandover(HUMAN, worker.id);
      expect(started.resumable).toBe(true);

      writeFileSync(join(worker.worktreePath!, 'device-notes.txt'), 'usb trace attached\n');
      await git(['add', '.'], worker.worktreePath!);
      await git(['commit', '-m', 'debug notes'], worker.worktreePath!);

      const result = await workers.endHandover(HUMAN, worker.id, 'attached Frida to the device and poked around');
      expect(result.reconciliation.worktree.newCommits).toBe(1);
      expect(result.note).toBe('attached Frida to the device and poked around');

      const after = workers.get(worker.id);
      expect(after.status).toBe('active');
      expect(after.pauseDetail).toBeNull();

      const hold = h.db.get<{ status: string; note: string }>("SELECT status, note FROM agent_handovers WHERE agent_id = ?", [worker.id]);
      expect(hold).toMatchObject({ status: 'returned', note: 'attached Frida to the device and poked around' });

      expect(h.services.tickets!.comment).toHaveBeenCalledWith(
        expect.anything(), worker.ticketId, expect.stringContaining('new commit'), 'status', 'trusted',
      );
    });

    it('endHandover refuses a worker with no open hold', async () => {
      const worker = await spawnWithSession();
      await expect(workers.endHandover(HUMAN, worker.id, 'note')).rejects.toThrow(/not currently held/i);
    });
  });

  describe('ensurePlanner / retirePlanner (VS-398)', () => {
    beforeEach(() => {
      h.services.projects = { get: () => ({ id: h.projectId }), list: () => [] } as never;
      h.services.planning = createPlanningService(h.ctx, h.deps);
      h.services.threads = createThreadsService(h.ctx, h.deps);
      h.db.insert('channels', { id: 'ch1', workspaceId: h.workspaceId, kind: 'web' });
      h.db.insert('channel_threads', { id: 'th1', channelId: 'ch1', agentId: h.conductorId, createdAt: nowIso() });
    });

    const startPlan = () => h.services.planning!.create(HUMAN, h.projectId, { threadId: 'th1', title: 'Redesign the settings page' });

    it('spawns a planner: home, disposable worktree, persistent session, no ticket', async () => {
      const plan = startPlan();
      const planner = await workers.ensurePlanner(HUMAN, plan.id);

      expect(planner.kind).toBe('planner');
      expect(planner.status).toBe('active');
      expect(planner.ticketId).toBeNull();
      expect(planner.roleId).toBeNull();
      expect(planner.planId).toBe(plan.id);
      expect(planner.branch).toBe(`plan/${plan.id.toLowerCase()}`);
      expect(existsSync(join(planner.homePath, 'AGENTS.md'))).toBe(true);
      expect(existsSync(join(planner.homePath, 'brief.md'))).toBe(false);
      expect(existsSync(join(planner.worktreePath!, 'README.md'))).toBe(true);

      const wt = h.db.get<{ ticketId: string | null; status: string }>('SELECT * FROM worktrees WHERE agent_id = ?', [planner.id])!;
      expect(wt).toMatchObject({ ticketId: null, status: 'active' });

      expect(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM agent_sessions WHERE agent_id = ?', [planner.id])!.n).toBe(1);
      expect(h.services.planning!.get(plan.id).agentId).toBe(planner.id);
      // No first-turn wake — the planner waits for captain's first message, unlike a worker's ticket_assigned.
      expect(wake.calls).toHaveLength(0);
    });

    it('returns the existing live planner instead of spawning a second one', async () => {
      const plan = startPlan();
      const first = await workers.ensurePlanner(HUMAN, plan.id);
      const second = await workers.ensurePlanner(HUMAN, plan.id);
      expect(second.id).toBe(first.id);
      expect(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM agents WHERE plan_id = ? AND kind = 'planner'", [plan.id])!.n).toBe(1);
    });

    it('refuses to provision a planner when Git identity is missing', async () => {
      await git(['config', '--local', '--unset', 'user.name'], clonePath);
      await git(['config', '--local', '--unset', 'user.email'], clonePath);
      vi.stubEnv('GIT_CONFIG_GLOBAL', join(h.ctx.paths.root, 'missing-global-gitconfig'));
      vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
      const plan = startPlan();

      await expect(workers.ensurePlanner(HUMAN, plan.id)).rejects.toMatchObject({
        code: 'validation',
        message: expect.stringContaining('user.name and user.email'),
      });
      expect(h.db.all("SELECT * FROM agents WHERE kind = 'planner'")).toHaveLength(0);
      expect(h.db.all('SELECT * FROM worktrees')).toHaveLength(0);
    });

    it('runs the planner on the weaver\'s own model, not a worker option (VS-398)', async () => {
      h.ctx.config = { ...h.ctx.config, models: { weaver: { runtime: 'codex', model: 'gpt-5' } } } as never;
      const plan = startPlan();
      const planner = await workers.ensurePlanner(HUMAN, plan.id);
      expect(planner.runtimeId).toBe('codex');
    });

    it('retires the planner and removes its worktree, clearing the plan\'s agent', async () => {
      const plan = startPlan();
      const planner = await workers.ensurePlanner(HUMAN, plan.id);
      const worktreePath = planner.worktreePath!;
      expect(existsSync(worktreePath)).toBe(true);

      await workers.retirePlanner(plan.id);

      expect(existsSync(worktreePath)).toBe(false);
      expect(workers.get(planner.id).status).toBe('retired');
      expect(h.db.get<{ status: string }>('SELECT status FROM worktrees WHERE agent_id = ?', [planner.id])!.status).toBe('removed');
      expect(h.services.planning!.get(plan.id).agentId).toBeNull();
    });

    it('retiring a plan with no planner is a no-op', async () => {
      const plan = startPlan();
      await expect(workers.retirePlanner(plan.id)).resolves.toBeUndefined();
    });

    describe('a replaced planner keeps the plan conversation (VS-567)', () => {
      const threadAgent = (): string => h.db.get<{ agentId: string }>('SELECT agent_id FROM channel_threads WHERE id = ?', ['th1'])!.agentId;

      it('ensurePlanner rebinds the plan thread to the replacement, and a message wakes it', async () => {
        const plan = startPlan();
        const first = await workers.ensurePlanner(HUMAN, plan.id);
        expect(threadAgent()).toBe(first.id);
        await workers.retirePlanner(plan.id);
        const second = await workers.ensurePlanner(HUMAN, plan.id);

        expect(second.id).not.toBe(first.id);
        expect(threadAgent()).toBe(second.id);
        wake.calls.length = 0;
        await h.services.threads!.inbound(HUMAN, 'th1', 'continue the plan');
        expect(wake.calls).toEqual([expect.objectContaining({ agentId: second.id, input: expect.objectContaining({ source: 'human_message' }) })]);
      });

      it('repairs a thread still bound to a retired planner and replays its skipped message once', async () => {
        const plan = startPlan();
        const first = await workers.ensurePlanner(HUMAN, plan.id);
        await workers.retirePlanner(plan.id);
        const second = await workers.ensurePlanner(HUMAN, plan.id);
        // The state the 2026-09-18 upgrade left behind: plan re-pointed, thread not.
        h.db.run('UPDATE channel_threads SET agent_id = ? WHERE id = ?', [first.id, 'th1']);
        h.db.insert('wakeups', {
          id: 'w_skipped', workspaceId: h.workspaceId, agentId: first.id, source: 'human_message', reason: 'message from captain',
          payloadJson: { threadId: 'th1', messageId: 'm_old', body: 'the skipped message' }, status: 'skipped', skipReason: 'agent_retired', createdAt: nowIso(),
        });
        wake.calls.length = 0;

        await h.services.threads!.inbound(HUMAN, 'th1', 'are you there');
        expect(threadAgent()).toBe(second.id);
        expect(wake.calls.map((c) => c.agentId)).toEqual([second.id, second.id]);
        expect(wake.calls[0]!.input).toMatchObject({ payload: expect.objectContaining({ messageId: 'm_old' }), idempotencyKey: 'replay:m_old' });

        wake.calls.length = 0;
        await h.services.threads!.inbound(HUMAN, 'th1', 'again');
        expect(wake.calls).toHaveLength(1);
      });
    });
  });

  describe('list kind filter (VS-525)', () => {
    beforeEach(() => {
      h.services.threads = createThreadsService(h.ctx, h.deps);
    });

    it('defaults to worker-kind agents, leaving a role session out', async () => {
      h.addWorker(null);
      await workers.ensureSession(HUMAN, h.projectId, h.roleId);

      expect(workers.list().map((a) => a.kind)).toEqual(['worker']);
      expect(workers.list({ kinds: ['session'] }).map((a) => a.kind)).toEqual(['session']);
    });

    it('narrows sessions by project and role', async () => {
      await workers.ensureSession(HUMAN, h.projectId, h.roleId);

      expect(workers.list({ kinds: ['session'], projectId: h.projectId, roleId: h.roleId })).toHaveLength(1);
      expect(workers.list({ kinds: ['session'], roleId: 'nope' })).toHaveLength(0);
    });
  });

  describe('ensureSession (VS-495)', () => {
    beforeEach(() => {
      h.services.threads = createThreadsService(h.ctx, h.deps);
    });

    it('opens a persistent session for the role: no ticket, no worktree, its own thread, a persistent session policy', async () => {
      const { agent, thread } = await workers.ensureSession(HUMAN, h.projectId, h.roleId);

      expect(agent.kind).toBe('session');
      expect(agent.status).toBe('active');
      expect(agent.ticketId).toBeNull();
      expect(agent.worktreePath).toBeNull();
      expect(agent.branch).toBeNull();
      expect(agent.roleId).toBe(h.roleId);
      expect(existsSync(join(agent.homePath, 'AGENTS.md'))).toBe(true);
      expect(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM worktrees WHERE agent_id = ?', [agent.id])!.n).toBe(0);
      expect(thread.agentId).toBe(agent.id);
      // No first-turn wake — a persistent session waits for the human to say something, like the planner.
      expect(wake.calls).toHaveLength(0);
    });

    it('resumes the same session and thread on a second open, rather than creating a second one', async () => {
      const first = await workers.ensureSession(HUMAN, h.projectId, h.roleId);
      const second = await workers.ensureSession(HUMAN, h.projectId, h.roleId);

      expect(second.agent.id).toBe(first.agent.id);
      expect(second.thread.id).toBe(first.thread.id);
      expect(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM agents WHERE role_id = ? AND kind = 'session'", [h.roleId])!.n).toBe(1);
    });

    it('is never counted by a spawn against the project worker cap', async () => {
      h.db.run('UPDATE projects SET max_workers = 0 WHERE id = ?', [h.projectId]);
      await expect(workers.ensureSession(HUMAN, h.projectId, h.roleId)).resolves.toMatchObject({ agent: { kind: 'session' } });
    });

    // VS-526: codex refuses to start outside a Git repository, and a ticketless session has no
    // worktree, so its home has to be one before the first turn.
    it('initialises its home as a Git repository a runtime can start in', async () => {
      const { agent } = await workers.ensureSession(HUMAN, h.projectId, h.roleId);
      expect(existsSync(join(agent.homePath, '.git'))).toBe(true);
      const head = await git(['rev-parse', 'HEAD'], agent.homePath, 15_000);
      expect(head.ok).toBe(true);
      // The rendered instructions are present and excluded from the repository's own status.
      expect(existsSync(join(agent.homePath, 'AGENTS.md'))).toBe(true);
      expect(readFileSync(join(agent.homePath, '.gitignore'), 'utf8')).toContain('AGENTS.md');
      expect(readFileSync(join(agent.homePath, '.gitignore'), 'utf8')).toContain('.ac-render.json');
      const status = await git(['status', '--porcelain'], agent.homePath, 15_000);
      expect(status.stdout.trim()).toBe('');
    });

    it('leaves an already-initialised session home untouched on a later open', async () => {
      const first = await workers.ensureSession(HUMAN, h.projectId, h.roleId);
      const head = await git(['rev-parse', 'HEAD'], first.agent.homePath, 15_000);
      const second = await workers.ensureSession(HUMAN, h.projectId, h.roleId);
      const after = await git(['rev-parse', 'HEAD'], second.agent.homePath, 15_000);
      expect(after.stdout.trim()).toBe(head.stdout.trim());
      expect(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM agents WHERE kind = ?', ['session'])!.n).toBe(1);
    });

    // VS-526: the option is chosen when the session is opened and is the session's own thereafter.
    it('stores the chosen worker option on the session, and keeps it on a later open', async () => {
      h.ctx.config.models.workerOptions = [
        { id: 'quick', description: 'Fast.', runtime: 'opencode', model: 'glm-4.6' },
        { id: 'deep', description: 'Cause unknown.', runtime: 'codex', model: null },
      ];
      const first = await workers.ensureSession(HUMAN, h.projectId, h.roleId, 'deep');
      expect(first.agent.workerModelId).toBe('deep');
      expect(first.agent.runtimeId).toBe('codex');
      const second = await workers.ensureSession(HUMAN, h.projectId, h.roleId, 'quick');
      expect(second.agent.id).toBe(first.agent.id);
      expect(second.agent.workerModelId).toBe('deep');
    });

    it('rejects an unknown option id and an option with no runtime chosen', async () => {
      h.ctx.config.models.workerOptions = [
        { id: 'quick', description: 'Fast.', runtime: 'opencode', model: 'glm-4.6' },
        { id: 'deep', description: 'Cause unknown.', runtime: null, model: null },
      ];
      await expect(workers.ensureSession(HUMAN, h.projectId, h.roleId, 'nope')).rejects.toMatchObject({ code: 'validation' });
      await expect(workers.ensureSession(HUMAN, h.projectId, h.roleId, 'deep')).rejects.toMatchObject({ code: 'model_unconfigured' });
    });

    it('keeps the session\'s own option when it takes a ticket that names none (VS-526)', async () => {
      await seedRepo();
      h.ctx.config.models.workerOptions = [
        { id: 'quick', description: 'Fast.', runtime: 'opencode', model: 'glm-4.6' },
      ];
      h.services.threads = createThreadsService(h.ctx, h.deps);
      h.services.tickets = createTicketsService(h.ctx, h.deps);
      const { agent: session } = await workers.ensureSession(HUMAN, h.projectId, h.roleId, 'quick');
      const { agent } = await workers.takeTicketForSession(HUMAN, session.id, { kind: 'task', title: 'Fix the thing', projectId: h.projectId, assigneeRoleId: h.roleId });
      expect(agent.workerModelId).toBe('quick');
    });

    it('changes the option of a session already holding a ticket without disturbing the ticket binding', async () => {
      await seedRepo();
      h.ctx.config.models.workerOptions = [
        { id: 'quick', description: 'Fast.', runtime: 'opencode', model: 'glm-4.6' },
        { id: 'deep', description: 'Cause unknown.', runtime: 'codex', model: null },
      ];
      h.services.threads = createThreadsService(h.ctx, h.deps);
      h.services.tickets = createTicketsService(h.ctx, h.deps);
      const { agent: session } = await workers.ensureSession(HUMAN, h.projectId, h.roleId, 'quick');
      const { ticket } = await workers.takeTicketForSession(HUMAN, session.id, { kind: 'task', title: 'Fix the thing', projectId: h.projectId, assigneeRoleId: h.roleId });
      const updated = await workers.setSessionOption(HUMAN, session.id, 'deep');
      expect(updated.workerModelId).toBe('deep');
      expect(updated.ticketId).toBe(ticket.id);
      expect(updated.worktreePath).toBe(session.worktreePath ?? updated.worktreePath);
    });
  });

  describe('setSessionOption (VS-526)', () => {
    beforeEach(() => {
      h.services.threads = createThreadsService(h.ctx, h.deps);
      h.ctx.config.models.workerOptions = [
        { id: 'quick', description: 'Fast.', runtime: 'opencode', model: 'glm-4.6' },
        { id: 'deep', description: 'Cause unknown.', runtime: 'codex', model: null },
      ];
    });

    it('changes the option and the runtime the session resolves to, without retiring it here', async () => {
      const { agent } = await workers.ensureSession(HUMAN, h.projectId, h.roleId, 'quick');
      const updated = await workers.setSessionOption(HUMAN, agent.id, 'deep');
      expect(updated.workerModelId).toBe('deep');
      expect(updated.runtimeId).toBe('codex');
      // The session row is untouched by the setter; the next turn's runtime change retires it.
      expect(h.db.get<{ status: string }>('SELECT status FROM agent_sessions WHERE agent_id = ?', [agent.id])).toMatchObject({ status: 'active' });
    });

    it('clears the option back to the workers setting with null', async () => {
      const { agent } = await workers.ensureSession(HUMAN, h.projectId, h.roleId, 'quick');
      const updated = await workers.setSessionOption(HUMAN, agent.id, null);
      expect(updated.workerModelId).toBeNull();
    });

    it('rejects a non-session agent and an unknown option', async () => {
      const { agent } = await workers.ensureSession(HUMAN, h.projectId, h.roleId, 'quick');
      h.db.insert('agents', { id: 'w1', workspaceId: h.workspaceId, kind: 'worker', name: 'Worker', runtimeId: 'claude', homePath: '/tmp/w1', createdAt: nowIso(), updatedAt: nowIso() });
      await expect(workers.setSessionOption(HUMAN, 'w1', 'deep')).rejects.toMatchObject({ code: 'validation' });
      await expect(workers.setSessionOption(HUMAN, agent.id, 'nope')).rejects.toMatchObject({ code: 'validation' });
    });
  });

  describe('takeTicketForSession (VS-495)', () => {
    beforeEach(() => {
      h.services.threads = createThreadsService(h.ctx, h.deps);
      h.services.tickets = createTicketsService(h.ctx, h.deps);
    });

    it('files a fresh ticket assigned to its own role, binds itself as the worker, and gets a worktree — no separate worker agent', async () => {
      const { agent: session } = await workers.ensureSession(HUMAN, h.projectId, h.roleId);

      const { agent, ticket } = await workers.takeTicketForSession(HUMAN, session.id, {
        projectId: h.projectId, kind: 'task', title: 'Wire up the new endpoint', description: 'Do it.',
      });

      expect(agent.id).toBe(session.id);
      expect(agent.kind).toBe('session');
      expect(agent.ticketId).toBe(ticket.id);
      expect(existsSync(join(agent.worktreePath!, 'README.md'))).toBe(true);
      expect(ticket.assigneeRoleId).toBe(h.roleId);
      expect(ticket.workerId).toBe(session.id);
      expect(ticket.status).toBe('todo');
      expect(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM agents WHERE kind = 'worker'")!.n).toBe(0);
      const wt = h.db.get<{ agentId: string; ticketId: string }>('SELECT agent_id AS agentId, ticket_id AS ticketId FROM worktrees WHERE agent_id = ?', [session.id])!;
      expect(wt).toMatchObject({ agentId: session.id, ticketId: ticket.id });
      expect(wake.calls.some((c) => c.agentId === session.id && c.input.source === 'ticket_assigned')).toBe(true);
    });

    it('takes an existing, unassigned ticket instead of creating a new one', async () => {
      const { agent: session } = await workers.ensureSession(HUMAN, h.projectId, h.roleId);
      const existing = seedTicket({ number: 5, identifier: 'TST-5', assigneeRoleId: null, status: 'backlog' });

      const { ticket } = await workers.takeTicketForSession(HUMAN, session.id, { ticketId: existing.id });

      expect(ticket.id).toBe(existing.id);
      expect(ticket.assigneeRoleId).toBe(h.roleId);
      expect(ticket.workerId).toBe(session.id);
    });

    it('refuses to take a second ticket while already holding one', async () => {
      const { agent: session } = await workers.ensureSession(HUMAN, h.projectId, h.roleId);
      await workers.takeTicketForSession(HUMAN, session.id, { projectId: h.projectId, kind: 'task', title: 'First' });

      await expect(workers.takeTicketForSession(HUMAN, session.id, { projectId: h.projectId, kind: 'task', title: 'Second' }))
        .rejects.toMatchObject({ code: 'wrong_status' });
    });

    it('refuses a ticket that already has a worker', async () => {
      const { agent: session } = await workers.ensureSession(HUMAN, h.projectId, h.roleId);
      const taken = seedTicket({ number: 6, identifier: 'TST-6', workerId: 'someone-else' });

      await expect(workers.takeTicketForSession(HUMAN, session.id, { ticketId: taken.id })).rejects.toMatchObject({ code: 'conflict' });
    });

    it('refuses a ticket already assigned to a different role', async () => {
      const { agent: session } = await workers.ensureSession(HUMAN, h.projectId, h.roleId);
      const otherRoleId = newId();
      h.db.insert('roles', {
        id: otherRoleId, workspaceId: h.workspaceId, projectId: h.projectId, slug: 'frontend', name: 'Frontend',
        charterSummary: 'Owns the UI.', scopeText: 'Frontend work.', sessionPolicy: 'per_ticket', maxWorkers: 2,
        status: 'active', specRevision: 1, createdBy: 'weaver', createdAt: nowIso(), updatedAt: nowIso(),
      });
      const elsewhere = seedTicket({ number: 7, identifier: 'TST-7', assigneeRoleId: otherRoleId });

      await expect(workers.takeTicketForSession(HUMAN, session.id, { ticketId: elsewhere.id })).rejects.toMatchObject({ code: 'validation' });
    });

    it('never leaves the ticket in the shape supervisor.spawnPending() sweeps for (VS-495 race)', async () => {
      // supervisor.spawnPending()'s own query, reproduced here: a ticket with a role assigned and no
      // worker is exactly what it spawns a transient worker for. If takeTicketForSession ever left
      // that gap open past its own synchronous call, this would find the ticket and a real worker
      // could be spawned on it behind the session's back.
      const sweepWouldSpawnFor = (ticketId: string): boolean =>
        !!h.db.get<{ id: string }>("SELECT id FROM tickets WHERE id = ? AND assignee_role_id IS NOT NULL AND worker_id IS NULL", [ticketId]);

      const { agent: session } = await workers.ensureSession(HUMAN, h.projectId, h.roleId);
      const { ticket } = await workers.takeTicketForSession(HUMAN, session.id, { projectId: h.projectId, kind: 'task', title: 'Race check' });

      expect(sweepWouldSpawnFor(ticket.id)).toBe(false);
    });

    // VS-620: the home's skills follow the session's posture, and checkout/release re-render it.
    it('installs the all-audience skills on a ticketless session, the worker set on checkout, and removes it again on release', async () => {
      seedSkills();
      const seen: string[][] = [];
      h.ctx.registries.runtimes.set('claude', fakeRuntimeWithInstallSpy(async (_home, bundle) => {
        seen.push(bundle.skills.map((s) => s.name).sort());
      }));

      const { agent: session } = await workers.ensureSession(HUMAN, h.projectId, h.roleId);
      expect(seen.at(-1)).toEqual(SESSION_SKILL_NAMES);

      const { agent } = await workers.takeTicketForSession(HUMAN, session.id, { projectId: h.projectId, kind: 'task', title: 'Wire up the endpoint' });
      expect(seen.at(-1)).toEqual(WORKER_SKILL_NAMES);

      await workers.releaseSessionTicket(HUMAN, agent.id);
      expect(seen.at(-1)).toEqual(SESSION_SKILL_NAMES);
    });
  });

  describe('startOrResumePlan (VS-398)', () => {
    beforeEach(() => {
      h.services.projects = { get: () => ({ id: h.projectId }), list: () => [] } as never;
      h.services.planning = createPlanningService(h.ctx, h.deps);
      h.services.threads = createThreadsService(h.ctx, h.deps);
    });

    it('creates a fresh plan, its own thread and a live planner when none exists', async () => {
      const { plan, agent } = await workers.startOrResumePlan(HUMAN, h.projectId, { title: 'Redesign the settings page' });
      expect(plan.status).toBe('drafting');
      expect(plan.projectId).toBe(h.projectId);
      expect(agent.kind).toBe('planner');
      expect(agent.planId).toBe(plan.id);
      expect(agent.status).toBe('active');

      const thread = h.services.threads!.get(plan.threadId);
      expect(thread.agentId).toBe(agent.id);

      expect(existsSync(join(agent.homePath, 'AGENTS.md'))).toBe(true);
      expect(existsSync(join(agent.worktreePath!, 'README.md'))).toBe(true);
    });

    it('resumes the existing drafting plan and its live planner instead of creating a second one', async () => {
      const first = await workers.startOrResumePlan(HUMAN, h.projectId, { title: 'Redesign' });
      const second = await workers.startOrResumePlan(HUMAN, h.projectId);
      expect(second.plan.id).toBe(first.plan.id);
      expect(second.agent.id).toBe(first.agent.id);
      expect(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM agents WHERE plan_id = ? AND kind = 'planner'", [first.plan.id])!.n).toBe(1);
      expect(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM plans WHERE project_id = ?', [h.projectId])!.n).toBe(1);
    });

    it('resumes an existing plan whose planner was retired mid-session (turn crash) by spawning a fresh one', async () => {
      const first = await workers.startOrResumePlan(HUMAN, h.projectId);
      await workers.retirePlanner(first.plan.id);
      const second = await workers.startOrResumePlan(HUMAN, h.projectId);
      expect(second.plan.id).toBe(first.plan.id);
      expect(second.agent.id).not.toBe(first.agent.id);
      expect(workers.get(second.agent.id).status).toBe('active');
    });

    it('starting a new plan after the first is submitted creates a second, separate plan', async () => {
      const first = await workers.startOrResumePlan(HUMAN, h.projectId);
      h.services.planning!.submit(HUMAN, first.plan.id);
      await workers.retirePlanner(first.plan.id);
      const second = await workers.startOrResumePlan(HUMAN, h.projectId);
      expect(second.plan.id).not.toBe(first.plan.id);
      expect(second.plan.status).toBe('drafting');
    });

    it('createPlan makes a second drafting plan with its own thread and planner (VS-477)', async () => {
      const first = await workers.createPlan(HUMAN, h.projectId);
      const second = await workers.createPlan(HUMAN, h.projectId);
      expect(second.plan.id).not.toBe(first.plan.id);
      expect(second.plan.threadId).not.toBe(first.plan.threadId);
      expect(second.agent.id).not.toBe(first.agent.id);
      expect(second.agent.planId).toBe(second.plan.id);
      expect(h.services.threads!.get(second.plan.threadId).agentId).toBe(second.agent.id);
      expect(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM agents WHERE kind = 'planner' AND status = 'active'")!.n).toBe(2);
      // startOrResumePlan resumes the newest, not a fresh one.
      const resumed = await workers.startOrResumePlan(HUMAN, h.projectId);
      expect(resumed.plan.id).toBe(second.plan.id);
    });

    it('retireIdlePlanners retires an idle, unfocused planner and leaves the focused one (VS-477)', async () => {
      const first = await workers.createPlan(HUMAN, h.projectId);
      const second = await workers.createPlan(HUMAN, h.projectId);
      // Backdate both planners so they count as idle; keep `second` focused.
      h.db.run("UPDATE agents SET last_run_at = '2000-01-01T00:00:00.000Z' WHERE kind = 'planner'");
      const retired = await workers.retireIdlePlanners(h.projectId, { keepPlanId: second.plan.id });
      expect(retired).toBe(1);
      expect(workers.get(first.agent.id).status).toBe('retired');
      expect(workers.get(second.agent.id).status).toBe('active');
      // The plan, its thread and its drafts survive retirement.
      expect(h.services.planning!.get(first.plan.id).status).toBe('drafting');
    });

    it('retireIdlePlanners never retires a planner with a running turn (VS-477)', async () => {
      const plan = await workers.createPlan(HUMAN, h.projectId);
      h.db.update('agents', plan.agent.id, { status: 'running', lastRunAt: '2000-01-01T00:00:00.000Z' });
      expect(await workers.retireIdlePlanners(h.projectId)).toBe(0);
      expect(workers.get(plan.agent.id).status).toBe('running');
    });
  });
});
