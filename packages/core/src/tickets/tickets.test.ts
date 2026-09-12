import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId, nowIso } from '@agent-conductor/db';
import { OcError, TICKET_KINDS, TICKET_STATUSES, TRANSITIONS, NAMED_CARD_OPTION_KEYS, canTransition, type Agent, type TicketKind, type TicketStatus } from '@agent-conductor/shared';
import { makeHarness, fakeWake, fakeSpecs, type TestHarness } from '../testing/context.js';
import { createTicketsService, TICKET_COMMENT_WAKE_BODY_CHARS } from './service.js';
import { GitWorktreeProvider } from '../worktrees/git.js';
import { git } from '../util/git.js';
import type { Actor, TicketsService } from '../api.js';

const AGENT: Actor = { kind: 'agent', id: 'agent-1', runId: 'run-1' };
const HUMAN: Actor = { kind: 'human', id: 'victor' };
const SYSTEM: Actor = { kind: 'system', id: null };

describe('tickets', () => {
  let h: TestHarness;
  let tickets: TicketsService;
  let wake: ReturnType<typeof fakeWake>;
  let decisions: { create: ReturnType<typeof vi.fn>; supersedeForTarget: ReturnType<typeof vi.fn>; withdrawForTicket: ReturnType<typeof vi.fn> };
  let openspec: { validateForProposed: ReturnType<typeof vi.fn>; archiveAfterMerge: ReturnType<typeof vi.fn> };
  let specs: ReturnType<typeof fakeSpecs>;

  beforeEach(() => {
    h = makeHarness();
    wake = fakeWake();
    decisions = { create: vi.fn(() => ({ id: newId() })), supersedeForTarget: vi.fn(() => 0), withdrawForTicket: vi.fn(() => 0) };
    openspec = {
      validateForProposed: vi.fn(async () => ({ ok: true as const, plan: '# Plan\n\n## Proposal\nbody' })),
      archiveAfterMerge: vi.fn(async () => ({ archivedAs: '2026-09-04-tst-1-thing', skipped: null })),
    };
    specs = fakeSpecs();
    h.services.wake = wake as never;
    h.services.decisions = decisions as never;
    h.services.openspec = openspec as never;
    // A merge schedules a spec re-index; without this the harness proxy throws inside that timer.
    h.services.specs = specs as never;
    // The merge queue brings a worker for the ticket it admits (PLAN §11.4).
    h.services.workers = {
      spawnForTicket: vi.fn(async (_a: Actor, ticketId: string) => ({ id: h.addWorker(ticketId) })),
      retireIfLanded: vi.fn(async () => ({ retired: true })),
      relaunch: vi.fn(async (_a: Actor, workerId: string) => ({ id: workerId })),
      conductor: vi.fn(() => ({ id: h.conductorId })),
    } as never;
    tickets = createTicketsService(h.ctx, h.deps);
    h.services.tickets = tickets;
  });
  // Drain the follow-up work a merge scheduled before the harness (and its db) goes away.
  afterEach(async () => { await tickets.stop(); h.cleanup(); });

  const make = (over: Partial<Parameters<TicketsService['create']>[1]> = {}) =>
    tickets.create(HUMAN, { kind: 'change', title: 'Add dark mode', projectId: h.projectId, assigneeRoleId: h.roleId, ...over });

  it('allocates sequential identifiers from the workspace counter', () => {
    const a = make();
    const b = make({ title: 'Second' });
    expect(a.identifier).toBe('TST-1');
    expect(b.identifier).toBe('TST-2');
    expect(tickets.nextIdentifier()).toBe('TST-3');
  });

  it('creates assigned tickets in todo and unassigned ones in backlog', () => {
    expect(make().status).toBe('todo');
    expect(make({ assigneeRoleId: null }).status).toBe('backlog');
  });

  it('stores interactiveSession from the input, defaulting false (VS-101)', () => {
    expect(make().interactiveSession).toBe(false);
    expect(make({ interactiveSession: true }).interactiveSession).toBe(true);
  });

  it('stores landingBranch from the input, defaulting null (VS-119)', () => {
    expect(make().landingBranch).toBeNull();
    expect(make({ landingBranch: 'main' }).landingBranch).toBe('main');
  });

  it('stores workerModelId from the catalog, defaulting null, and rejects an unknown id (VS-162)', () => {
    expect(make().workerModelId).toBeNull();
    h.ctx.config.models.workerOptions = [
      { id: 'cheap', description: 'Scouts.', runtime: 'opencode', model: 'glm-4.6' },
    ];
    expect(make({ workerModelId: 'cheap' }).workerModelId).toBe('cheap');
    expect(() => make({ workerModelId: 'nope' })).toThrow(OcError);
    try { make({ workerModelId: 'nope' }); } catch (e) { expect((e as OcError).code).toBe('validation'); }
  });

  it('rejects an unconfigured worker option id (VS-236)', () => {
    h.ctx.config.models.workerOptions = [
      { id: 'deep', description: 'Cause unknown.', runtime: null, model: null },
      { id: 'cheap', description: 'Scouts.', runtime: 'opencode', model: 'glm-4.6' },
    ];
    expect(() => make({ workerModelId: 'deep' })).toThrow(OcError);
    try { make({ workerModelId: 'deep' }); } catch (e) {
      expect((e as OcError).code).toBe('model_unconfigured');
      expect((e as OcError).message).toContain('deep');
    }
    expect(make({ workerModelId: 'cheap' }).workerModelId).toBe('cheap');
    expect(tickets.list({}).items.some((t) => t.workerModelId === 'deep')).toBe(false);
  });

  it('validates workerModelId against a filled daemon catalog (VS-185)', () => {
    h.ctx.config.models.workerOptions = [
      { id: 'cheap', description: 'Scouts.', runtime: 'opencode', model: 'glm-4.6' },
    ];
    h.ctx.daemon.models = {
      workerOptions: [{ id: 'strong', description: 'Heavy.', runtime: 'claude', model: 'opus' }],
    };
    expect(make({ workerModelId: 'strong' }).workerModelId).toBe('strong');
    expect(() => make({ workerModelId: 'cheap' })).toThrow(OcError);
    h.ctx.daemon.models = {};
  });

  it('lets assign set workerModelId before spawn and refuses after (VS-162)', () => {
    h.ctx.config.models.workerOptions = [
      { id: 'cheap', description: 'Scouts.', runtime: 'opencode', model: 'glm-4.6' },
    ];
    const t = make({ assigneeRoleId: null });
    expect(tickets.assign(HUMAN, t.id, h.roleId, 'cheap').workerModelId).toBe('cheap');
    h.db.update('tickets', t.id, { workerId: 'ag_already' });
    expect(() => tickets.assign(HUMAN, t.id, h.roleId, 'cheap')).toThrow(OcError);
    expect(tickets.get(t.id).workerModelId).toBe('cheap');
  });

  it('lets the quota-card writer set workerModelId after spawn and rejects an unknown id (VS-238)', () => {
    h.ctx.config.models.workerOptions = [
      { id: 'cheap', description: 'Scouts.', runtime: 'opencode', model: 'glm-4.6' },
      { id: 'deep', description: 'Cause unknown.', runtime: 'claude', model: 'opus' },
    ];
    const t = make({ workerModelId: 'cheap' });
    h.db.update('tickets', t.id, { workerId: 'ag_already' });
    expect(() => tickets.assign(HUMAN, t.id, h.roleId, 'deep')).toThrow(OcError);
    expect(tickets.setWorkerModelFromQuotaCard(HUMAN, t.id, 'deep').workerModelId).toBe('deep');
    expect(() => tickets.setWorkerModelFromQuotaCard(HUMAN, t.id, 'nope')).toThrow(OcError);
    try { tickets.setWorkerModelFromQuotaCard(HUMAN, t.id, 'nope'); } catch (e) { expect((e as OcError).code).toBe('validation'); }
    expect(tickets.get(t.id).workerModelId).toBe('deep');
  });

  it('stores summary from the input, defaulting null, and accepts a later patch (VS-146)', () => {
    expect(make().summary).toBeNull();
    expect(make({ summary: 'Remind captain why this ticket exists.' }).summary).toBe('Remind captain why this ticket exists.');
    const t = make();
    expect(tickets.update(HUMAN, t.id, { summary: 'Added after creation.' }).summary).toBe('Added after creation.');
    expect(tickets.update(HUMAN, t.id, { summary: null }).summary).toBeNull();
  });

  it('records the run that created the ticket, and nothing when there is no run', () => {
    expect(tickets.create(AGENT, { kind: 'change', title: 'From a turn', projectId: h.projectId, assigneeRoleId: h.roleId }).createdRunId).toBe('run-1');
    expect(make().createdRunId).toBeNull();
    expect(tickets.create(SYSTEM, { kind: 'task', title: 'From the system', projectId: h.projectId }).createdRunId).toBeNull();
  });

  it('keeps the creating run unchanged as the ticket moves', async () => {
    const t = tickets.create(AGENT, { kind: 'task', title: 'Anchored', projectId: h.projectId });
    tickets.assign(HUMAN, t.id, h.roleId);
    await tickets.transition(SYSTEM, t.id, { to: 'in_progress' });
    tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'u' });
    await tickets.transition(AGENT, t.id, { to: 'in_review' });
    await tickets.transition(HUMAN, t.id, { to: 'done', note: 'ending: done — reviewed without merging' });
    expect(tickets.get(t.id).createdRunId).toBe('run-1');
  });

    it('binds an OpenSpec change name for change tickets in openspec projects', () => {
    expect(make().openspecChangeName).toBe('tst-1-add-dark-mode');
    expect(make({ kind: 'scout', title: 'Investigate' }).openspecChangeName).toBeNull();
    expect(make({ kind: 'operational', title: 'Restart the daemon' }).openspecChangeName).toBeNull();
  });

  it('creates an operational ticket the same way as a scout: assigned in todo, no OpenSpec name', () => {
    const t = make({ kind: 'operational', title: 'Restart the daemon' });
    expect(t.kind).toBe('operational');
    expect(t.status).toBe('todo');
    expect(t.openspecChangeName).toBeNull();
  });

  it('rejects blocker cycles', () => {
    const a = make();
    const b = make({ title: 'B' });
    tickets.setBlockers(HUMAN, b.id, [a.id]);
    expect(() => tickets.setBlockers(HUMAN, a.id, [b.id])).toThrow(/cycle/);
  });

  describe('state machine', () => {
    it('matches the shared transition table exactly when every guard is satisfied', async () => {
      for (const kind of TICKET_KINDS) {
        for (const from of TICKET_STATUSES) {
          for (const to of TICKET_STATUSES) {
            if (from === to) continue;
            const t = make({ kind: kind as TicketKind, title: `${kind} ${from}->${to}` });
            const blocker = make({ title: 'blocker' });
            // Satisfy every guard: an open blocker, an unblock path, a work product and auto-merge.
            tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'https://example.com/pr/1' });
            h.db.update('tickets', t.id, { status: from, autoMerge: 1 });
            const allowed = canTransition(kind as TicketKind, from as TicketStatus, to as TicketStatus);
            // VS-250: `merging -> done` stays graph-legal (mergeDone finishes that ticket), but the
            // transition() call is refused — only merge-done may write that edge.
            const guardRefuses = allowed && from === 'merging' && to === 'done';
            let ok = true;
            let err: unknown;
            try {
              // Reopening a finished ticket is a human's call (PLAN §6.2); everything else the machine may do.
              // The note satisfies the task-done guard: a `done` needs its ending stated (VS-215).
              await tickets.transition(from === 'done' || from === 'cancelled' ? HUMAN : SYSTEM, t.id, {
                to: to as TicketStatus,
                note: 'ending stated for the guard',
                blockedBy: [blocker.id],
                unblock: { owner: 'human', action: 'decide' },
              });
            } catch (e) {
              ok = false;
              err = e;
            }
            expect(ok, `${kind}: ${from} -> ${to} expected ${allowed ? 'allowed' : 'rejected'} (${String(err)})`).toBe(allowed && !guardRefuses);
            if (guardRefuses) {
              expect(err).toMatchObject({ code: 'invalid_disposition' });
              expect((err as OcError).message).toContain('ac_ticket_merge_done');
              expect(tickets.get(t.id).status).toBe('merging');
            } else if (ok) {
              expect(tickets.get(t.id).status).toBe(to);
            }
          }
        }
      }
    });

    // VS-250: the old bypass let a ticket leave merging for done with no complete delivery record
    // (the VS-227 shape). Only merge-done writes that edge now.
    it('refuses merging -> done through transition() and names merge-done, for change and task', async () => {
      for (const kind of ['change', 'task'] as const) {
        const t = make({ kind, title: `${kind} merging` });
        tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'https://example.com/pr/1' });
        h.db.update('tickets', t.id, { status: 'merging', autoMerge: 1 });
        await expect(tickets.transition(SYSTEM, t.id, { to: 'done', note: 'ending stated for the guard' })).rejects.toMatchObject({
          code: 'invalid_disposition',
          message: expect.stringContaining('ac_ticket_merge_done'),
        });
        expect(tickets.get(t.id).status).toBe('merging');
      }
    });

    // VS-118: the ticket forgot what it was doing before it was blocked, so resuming or unblocking
    // it always fell back to `todo` — this is what remembers.
    it('records the status a ticket held before it was blocked, and clears it on the way out', async () => {
      const t = make();
      h.db.update('tickets', t.id, { status: 'approved' });
      const blocked = await tickets.transition(SYSTEM, t.id, { to: 'blocked', unblock: { owner: 'human', action: 'decide' } });
      expect(blocked.blockedFromStatus).toBe('approved');

      const restored = await tickets.transition(SYSTEM, t.id, { to: 'approved' });
      expect(restored.blockedFromStatus).toBeNull();
    });

    // VS-127: a blocked ticket used to be visible only at the conductor's next digest — this is what
    // makes a conductor-owned unblock action wake it the same turn instead.
    it('wakes the conductor immediately when blocked on an unblock action it owns', async () => {
      const t = make();
      await tickets.transition(AGENT, t.id, { to: 'blocked', unblock: { owner: 'weaver', action: 'pick a store' } });
      const w = wake.calls.find((c) => c.agentId === h.conductorId && c.input.source === 'ticket_blocked');
      expect(w).toBeDefined();
      expect(w?.input.reason).toContain(t.identifier);
    });

    it('does not wake the conductor when blocked on an unblock action the human owns', async () => {
      const t = make();
      await tickets.transition(AGENT, t.id, { to: 'blocked', unblock: { owner: 'human', action: 'decide' } });
      expect(wake.calls.some((c) => c.input.source === 'ticket_blocked')).toBe(false);
    });

    it('does not wake the conductor when blocked on unresolved blockers alone', async () => {
      const t = make();
      const blocker = make({ title: 'blocker' });
      await tickets.transition(AGENT, t.id, { to: 'blocked', blockedBy: [blocker.id] });
      expect(wake.calls.some((c) => c.input.source === 'ticket_blocked')).toBe(false);
    });

    it('rejects blocked without a routable action path', async () => {
      const t = make();
      await expect(tickets.transition(AGENT, t.id, { to: 'blocked', note: 'stuck' })).rejects.toMatchObject({ code: 'missing_action_path' });
    });

    it('accepts blocked when an open decision exists', async () => {
      const t = make();
      h.db.insert('decisions', {
        id: newId(), workspaceId: h.workspaceId, ticketId: t.id, kind: 'question', owner: 'human', title: 'Which db?',
        context: '', optionsJson: [], allowFreeText: 1, status: 'open', createdAt: nowIso(),
      });
      expect((await tickets.transition(AGENT, t.id, { to: 'blocked' })).status).toBe('blocked');
    });

    // VS-209: the error names what IS reachable, so a worker doesn't need to have memorised the graph.
    it('names the reachable statuses when rejecting approved -> in_review on a change ticket', async () => {
      const t = make({ kind: 'change' });
      h.db.update('tickets', t.id, { status: 'approved' });
      await expect(tickets.transition(AGENT, t.id, { to: 'in_review' })).rejects.toMatchObject({
        code: 'invalid_disposition',
        details: { kind: 'change', from: 'approved', to: 'in_review', allowed: TRANSITIONS.change.approved },
      });
      expect(TRANSITIONS.change.approved).not.toContain('in_review');
    });

    it('rejects in_review without a work product', async () => {
      const t = make({ kind: 'task' });
      h.db.update('tickets', t.id, { status: 'in_progress' });
      await expect(tickets.transition(AGENT, t.id, { to: 'in_review' })).rejects.toMatchObject({ code: 'invalid_disposition' });
    });

    it('rejects merging without an approved merge decision', async () => {
      const t = make();
      tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'u' });
      h.db.update('tickets', t.id, { status: 'in_review' });
      await expect(tickets.transition(AGENT, t.id, { to: 'merging' })).rejects.toMatchObject({ code: 'merge_not_approved' });
    });

    it('allows merging once a merge_approval was answered approve', async () => {
      const t = make();
      tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'u' });
      h.db.update('tickets', t.id, { status: 'in_review' });
      h.db.insert('decisions', {
        id: newId(), workspaceId: h.workspaceId, ticketId: t.id, kind: 'merge_approval', owner: 'human', title: 'Merge?',
        context: '', optionsJson: [], allowFreeText: 1, status: 'answered', answerKey: 'approve', createdAt: nowIso(),
      });
      const workerId = h.addWorker(t.id);
      expect((await tickets.transition(HUMAN, t.id, { to: 'merging' })).status).toBe('merging');
      expect(wake.calls.some((c) => c.agentId === workerId && c.input.source === 'merge_approved')).toBe(true);
    });
  });

  describe('task completion gate (VS-215)', () => {
    // The gate reads the project through the service (as mergeDone does); the default harness bag
    // has no projects service, so give it one over this harness's own row.
    beforeEach(() => {
      h.services.projects = {
        get: (id: string) => {
          const row = h.db.get<{ clonePath: string; policies: unknown }>('SELECT clone_path AS "clonePath", policies_json AS "policies" FROM projects WHERE id = ?', [id]);
          if (!row) throw new OcError('not_found', `project ${id} not found`);
          const raw = row.policies;
          const policies = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {});
          return { id, clonePath: row.clonePath, defaultBranch: 'main', landingBranch: null, policies } as never;
        },
      } as never;
    });

    const cloneOf = (): string =>
      h.db.get<{ clonePath: string }>('SELECT clone_path AS "clonePath" FROM projects WHERE id = ?', [h.projectId])!.clonePath;

    async function initClone(): Promise<string> {
      const repo = cloneOf();
      mkdirSync(repo, { recursive: true });
      await git(['init', '-b', 'main'], repo);
      await git(['config', 'user.email', 'test@example.com'], repo);
      await git(['config', 'user.name', 'Test'], repo);
      await git(['config', 'commit.gpgsign', 'false'], repo);
      writeFileSync(join(repo, 'README.md'), '# repo\n', 'utf8');
      await git(['add', '.'], repo);
      await git(['commit', '-m', 'init'], repo);
      return repo;
    }

    /** A real worktree for the ticket, plus the worktrees row the gate reads. */
    async function makeWorktree(t: { id: string }, commits = 0): Promise<{ repo: string; path: string; branch: string }> {
      const repo = await initClone();
      const branch = `ac/${t.id.slice(-6).toLowerCase()}-task`;
      const path = join(mkdtempSync(join(tmpdir(), 'ac-215-')), 'work');
      await new GitWorktreeProvider().create({ repoPath: repo, branch, base: 'main', targetPath: path });
      for (let i = 0; i < commits; i++) {
        writeFileSync(join(path, `f${i}.txt`), `work ${i}\n`, 'utf8');
        await git(['add', '.'], path);
        await git(['commit', '-m', `feat: work ${i}`], path);
      }
      h.db.insert('worktrees', {
        id: newId(), projectId: h.projectId, ticketId: t.id, agentId: null, provider: 'git',
        path, branch, status: 'active', createdAt: nowIso(),
      });
      return { repo, path, branch };
    }

    const taskInProgress = async (over: Partial<Parameters<TicketsService['create']>[1]> = {}) => {
      const t = make({ kind: 'task', title: 'Chore', ...over });
      await tickets.transition(AGENT, t.id, { to: 'in_progress' });
      return t;
    };

    it('finishes a no-commit task at done with no merge approval and records the stated ending', async () => {
      const t = await taskInProgress();
      await makeWorktree(t);
      decisions.create.mockClear();
      const done = await tickets.transition(AGENT, t.id, { to: 'done', note: 'ending: done — config-only, nothing to land' });
      expect(done.status).toBe('done');
      expect(decisions.create).not.toHaveBeenCalled();
      const comment = h.db.get<{ body: string }>('SELECT body FROM ticket_comments WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1', [t.id]);
      expect(comment!.body).toContain('nothing to land');
    });

    it('rejects done without a stated ending, naming the two endings', async () => {
      const t = await taskInProgress();
      await expect(tickets.transition(AGENT, t.id, { to: 'done' })).rejects.toMatchObject({ code: 'validation' });
      expect(tickets.get(t.id).status).toBe('in_progress');
    });

    it('refuses done while the branch carries unlanded commits, and keeps the status', async () => {
      const t = await taskInProgress();
      await makeWorktree(t, 1);
      await expect(tickets.transition(AGENT, t.id, { to: 'done', note: 'ending: done' }))
        .rejects.toMatchObject({ code: 'worktree_not_landed', message: /in_review/ });
      expect(tickets.get(t.id).status).toBe('in_progress');
      // The same request from a human is refused too: the guard protects unlanded work, not just agents.
      await expect(tickets.transition(HUMAN, t.id, { to: 'done', note: 'ending: done' }))
        .rejects.toMatchObject({ code: 'worktree_not_landed' });
    });

    it('does not refuse done when the branch commits are patch-id equivalent (squash-landed)', async () => {
      const t = await taskInProgress();
      const { repo, branch } = await makeWorktree(t, 1);
      await git(['cherry-pick', branch], repo);
      const done = await tickets.transition(AGENT, t.id, { to: 'done', note: 'ending: done — landed by squash' });
      expect(done.status).toBe('done');
    });

    it('does not refuse done for a task without a worktree row', async () => {
      const t = await taskInProgress();
      const done = await tickets.transition(AGENT, t.id, { to: 'done', note: 'ending: done — answered in place' });
      expect(done.status).toBe('done');
    });

    it('leaves scout endings untouched: done without a note stays legal', async () => {
      const t = make({ kind: 'scout', title: 'Investigate' });
      await tickets.transition(AGENT, t.id, { to: 'in_progress' });
      expect((await tickets.transition(AGENT, t.id, { to: 'done' })).status).toBe('done');
    });

    it('leaves operational endings without a note legal, and refuses unlanded commits', async () => {
      const t = make({ kind: 'operational', title: 'Restart the daemon' });
      await tickets.transition(AGENT, t.id, { to: 'in_progress' });
      expect((await tickets.transition(AGENT, t.id, { to: 'done' })).status).toBe('done');

      const withCommits = make({ kind: 'operational', title: 'Restart again' });
      await tickets.transition(AGENT, withCommits.id, { to: 'in_progress' });
      await makeWorktree(withCommits, 1);
      await expect(tickets.transition(AGENT, withCommits.id, { to: 'done' }))
        .rejects.toMatchObject({ code: 'worktree_not_landed', message: /unlanded commits/ });
      expect(tickets.get(withCommits.id).status).toBe('in_progress');
    });

    it('delivers a task with commits through in_review and a merge approval, and lands it as today', async () => {
      const t = await taskInProgress();
      await makeWorktree(t, 1);
      tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'u' });
      decisions.create.mockClear();
      expect((await tickets.transition(AGENT, t.id, { to: 'in_review' })).status).toBe('in_review');
      expect(decisions.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'merge_approval', ticketId: t.id }));

      // Post-merge completion bypasses the gate: mergeDone writes done directly (landed via ff).
      h.db.update('projects', h.projectId, { policiesJson: { deliveryMode: 'local-branch' } });
      h.db.update('tickets', t.id, { status: 'merging' });
      const done = await tickets.mergeDone(AGENT, t.id, { mergeCommit: 'abc1234', method: 'merge' });
      expect(done.status).toBe('done');
    });
  });

  describe('the proposed gate', () => {
    it('validates with openspec, writes the plan document and opens a plan_approval', async () => {
      const t = make();
      h.db.update('tickets', t.id, { status: 'proposing' });
      const next = await tickets.transition(AGENT, t.id, { to: 'proposed' });
      expect(next.status).toBe('proposed');
      expect(openspec.validateForProposed).toHaveBeenCalledWith(t.id);
      expect(tickets.getDocument(t.id, 'plan')?.body).toContain('## Proposal');
      expect(decisions.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'plan_approval', owner: 'human' }));
      // VS-111: the plan-approval card's buttons are hard-coded to these keys — the decision the
      // daemon actually raises must offer no other keys, or pressing one of them would fail.
      const planCall = decisions.create.mock.calls.find((c) => c[1]?.kind === 'plan_approval');
      expect(planCall?.[1]?.options.map((o: { key: string }) => o.key)).toEqual(Object.values(NAMED_CARD_OPTION_KEYS.plan_approval));
    });

    it('rejects the transition when openspec validation fails', async () => {
      openspec.validateForProposed.mockResolvedValueOnce({ ok: false, issues: [{ level: 'error', message: 'no tasks' }] });
      const t = make();
      h.db.update('tickets', t.id, { status: 'proposing' });
      await expect(tickets.transition(AGENT, t.id, { to: 'proposed' })).rejects.toMatchObject({ code: 'openspec_validation_failed' });
      expect(tickets.get(t.id).status).toBe('proposing');
    });

    it('auto-approves when the project policy is none', async () => {
      h.db.update('projects', h.projectId, { policiesJson: { proposalApproval: 'none' } });
      const t = make();
      const workerId = h.addWorker(t.id);
      h.db.update('tickets', t.id, { status: 'proposing' });
      const next = await tickets.transition(AGENT, t.id, { to: 'proposed' });
      expect(next.status).toBe('approved');
      expect(decisions.create).not.toHaveBeenCalled();
      expect(wake.calls.some((c) => c.agentId === workerId && c.input.source === 'ticket_assigned')).toBe(true);
    });

    it('supersedes an open plan approval when the daemon writes a newer plan revision', () => {
      // `{ system: true }` simulates transition()'s own internal write — the one legitimate writer.
      const t = make();
      tickets.putDocument(AGENT, t.id, 'plan', 'v1', { system: true });
      tickets.putDocument(AGENT, t.id, 'plan', 'v2', { system: true });
      expect(decisions.supersedeForTarget).toHaveBeenCalledWith(expect.anything(), t.id, `plan_approval:${t.id}`);
      expect(tickets.getDocument(t.id, 'plan')?.revision).toBe(2);
      expect(tickets.getDocument(t.id, 'plan', 1)?.body).toBe('v1');
    });

    it('refuses an external write to the plan key, leaving any open approval untouched', () => {
      const t = make();
      tickets.putDocument(AGENT, t.id, 'plan', 'the daemon digest', { system: true });
      decisions.supersedeForTarget.mockClear();
      expect(() => tickets.putDocument(AGENT, t.id, 'plan', 'my own notes')).toThrow(expect.objectContaining({ code: 'forbidden' }));
      expect(decisions.supersedeForTarget).not.toHaveBeenCalled();
      expect(tickets.getDocument(t.id, 'plan')?.revision).toBe(1);
      expect(tickets.getDocument(t.id, 'plan')?.body).toBe('the daemon digest');
    });

    it('refuses an external write to an artifact:-prefixed key (VS-269)', () => {
      const t = make();
      tickets.putDocument(AGENT, t.id, 'artifact:overview', '<html>hi</html>', { system: true });
      expect(() => tickets.putDocument(AGENT, t.id, 'artifact:overview', '<html>sneaky</html>')).toThrow(expect.objectContaining({ code: 'forbidden' }));
      expect(() => tickets.putDocument(AGENT, t.id, 'artifact:brand-new', '<html>sneaky</html>')).toThrow(expect.objectContaining({ code: 'forbidden' }));
      expect(tickets.getDocument(t.id, 'artifact:overview')?.revision).toBe(1);
      expect(tickets.getDocument(t.id, 'artifact:overview')?.body).toBe('<html>hi</html>');
    });

    describe('putArtifactWorkProduct (VS-269)', () => {
      it('inserts one artifact work product on first publish, keyed by the artifact key', () => {
        const t = make();
        const { id } = tickets.putArtifactWorkProduct(AGENT, t.id, 'overview', { url: '/raw/1', title: 'Overview', kind: 'diagram' });
        const products = tickets.workProducts(t.id);
        expect(products).toHaveLength(1);
        expect(products[0]).toMatchObject({ id, type: 'artifact', externalId: 'overview', url: '/raw/1', title: 'Overview' });
        expect((products[0]!.metadata as { kind?: string }).kind).toBe('diagram');
      });

      it('updates the same row in place on a second publish under the same key', () => {
        const t = make();
        const first = tickets.putArtifactWorkProduct(AGENT, t.id, 'overview', { url: '/raw/1', title: 'v1' });
        const second = tickets.putArtifactWorkProduct(AGENT, t.id, 'overview', { url: '/raw/2', title: 'v2' });
        expect(second.id).toBe(first.id);
        const products = tickets.workProducts(t.id);
        expect(products).toHaveLength(1);
        expect(products[0]).toMatchObject({ url: '/raw/2', title: 'v2' });
      });

      it('keeps two artifacts under different keys as two independent work products', () => {
        const t = make();
        tickets.putArtifactWorkProduct(AGENT, t.id, 'overview', { url: '/raw/overview' });
        tickets.putArtifactWorkProduct(AGENT, t.id, 'sequence', { url: '/raw/sequence' });
        expect(tickets.workProducts(t.id).map((p) => p.externalId).sort()).toEqual(['overview', 'sequence']);
      });
    });

    describe('artifacts (VS-270)', () => {
      const otherProject = (): string => {
        const id = newId();
        const now = nowIso();
        h.db.insert('projects', {
          id, workspaceId: h.workspaceId, slug: 'other', name: 'Other', gitUrl: 'git@example.com:acme/other.git',
          defaultBranch: 'main', clonePath: join(h.root, 'other'), maxWorkers: 4, worktreeProvider: 'git',
          openspecEnabled: 1, policiesJson: {}, status: 'ready', createdAt: now, updatedAt: now,
        });
        return id;
      };

      it('lists only the artifacts belonging to the given project, joined with each ticket', () => {
        const a = make({ title: 'Ticket A' });
        const other = otherProject();
        const b = tickets.create(HUMAN, { kind: 'change', title: 'Ticket B', projectId: other, assigneeRoleId: null });
        tickets.putArtifactWorkProduct(AGENT, a.id, 'overview', { url: '/raw/a-overview', title: 'A overview' });
        tickets.putArtifactWorkProduct(AGENT, b.id, 'overview', { url: '/raw/b-overview', title: 'B overview' });

        const forA = tickets.artifacts(h.projectId);
        expect(forA).toHaveLength(1);
        expect(forA[0]).toMatchObject({ ticketId: a.id, ticketIdentifier: a.identifier, ticketTitle: 'Ticket A', key: 'overview', title: 'A overview', url: '/raw/a-overview' });

        const forAll = tickets.artifacts(null);
        expect(forAll.map((r) => r.ticketId).sort()).toEqual([a.id, b.id].sort());
      });

      it('excludes a project-less ticket from a specific-project call and includes it when unfiltered', () => {
        const a = make({ title: 'Has a project' });
        const orphan = tickets.create(HUMAN, { kind: 'change', title: 'No project', projectId: null, assigneeRoleId: null });
        tickets.putArtifactWorkProduct(AGENT, a.id, 'overview', { url: '/raw/a' });
        tickets.putArtifactWorkProduct(AGENT, orphan.id, 'overview', { url: '/raw/orphan' });

        expect(tickets.artifacts(h.projectId).map((r) => r.ticketId)).toEqual([a.id]);
        expect(tickets.artifacts(null).map((r) => r.ticketId).sort()).toEqual([a.id, orphan.id].sort());
      });

      it('republishing under the same key yields exactly one row, reflecting the latest publish', () => {
        const t = make();
        tickets.putArtifactWorkProduct(AGENT, t.id, 'overview', { url: '/raw/1', title: 'v1' });
        tickets.putArtifactWorkProduct(AGENT, t.id, 'overview', { url: '/raw/2', title: 'v2' });
        const rows = tickets.artifacts(h.projectId).filter((r) => r.ticketId === t.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ url: '/raw/2', title: 'v2' });
      });

      it('sorts most-recently-updated first and carries kind through metadata', () => {
        // Real-clock timestamps can tie within the same millisecond (the project's own ULID/timestamp-tie
        // flake, VS-191) — set updated_at explicitly rather than relying on call order to produce distinct ones.
        const t = make();
        const first = tickets.putArtifactWorkProduct(AGENT, t.id, 'first', { url: '/raw/first', kind: 'diagram' });
        const second = tickets.putArtifactWorkProduct(AGENT, t.id, 'second', { url: '/raw/second' });
        h.db.update('ticket_work_products', first.id, { updatedAt: '2026-09-12T00:00:00.000Z' });
        h.db.update('ticket_work_products', second.id, { updatedAt: '2026-09-12T00:00:01.000Z' });
        const rows = tickets.artifacts(h.projectId);
        expect(rows.map((r) => r.key)).toEqual(['second', 'first']);
        expect(rows.find((r) => r.key === 'first')!.metadata['kind']).toBe('diagram');
      });
    });

    it('lists the documents on a ticket with their current revision', () => {
      const t = make();
      tickets.putDocument(AGENT, t.id, 'report', 'r1');
      tickets.putDocument(AGENT, t.id, 'report', 'r2');
      tickets.putDocument(AGENT, t.id, 'notes', 'n1');
      expect(tickets.documents(t.id).map((d) => ({ key: d.key, revision: d.revision }))).toEqual([
        { key: 'notes', revision: 1 },
        { key: 'report', revision: 2 },
      ]);
      expect(tickets.documents(t.id)[1]?.updatedAt).not.toBe('');
    });

    describe('reading a document by id (VS-224)', () => {
      it('reads the current revision by id and names the key and currentRevision', () => {
        const t = make();
        tickets.putDocument(AGENT, t.id, 'action', 'systemctl restart');
        tickets.putDocument(AGENT, t.id, 'action', 'systemctl restart --now');
        const doc = h.db.get<{ id: string }>('SELECT id FROM ticket_documents WHERE ticket_id = ? AND key = ?', [t.id, 'action'])!;
        const found = tickets.getDocumentById(t.id, doc.id);
        expect(found).toMatchObject({ key: 'action', documentId: doc.id, revision: 2, currentRevision: 2, body: 'systemctl restart --now' });
      });

      it('reads an earlier revision at that revision', () => {
        const t = make();
        tickets.putDocument(AGENT, t.id, 'action', 'v1');
        tickets.putDocument(AGENT, t.id, 'action', 'v2');
        const doc = h.db.get<{ id: string }>('SELECT id FROM ticket_documents WHERE ticket_id = ? AND key = ?', [t.id, 'action'])!;
        expect(tickets.getDocumentById(t.id, doc.id, 1)).toMatchObject({ revision: 1, currentRevision: 2, body: 'v1' });
      });

      it('returns null for an unknown id, another ticket\'s document, and a revision that never existed', () => {
        const a = make();
        const b = make();
        const written = tickets.putDocument(AGENT, a.id, 'report', 'only on a');
        expect(tickets.getDocumentById(a.id, 'doc_unknown')).toBeNull();
        expect(tickets.getDocumentById(b.id, written.documentId)).toBeNull();
        expect(tickets.getDocumentById(a.id, written.documentId, 99)).toBeNull();
      });
    });

    it('raises a human-owned action_approval when an operational ticket writes action, and YOLO does not answer it', () => {
      h.ctx.config.defaults.yolo = true;
      const t = make({ kind: 'operational', title: 'Restart the daemon' });
      decisions.create.mockClear();
      const written = tickets.putDocument(AGENT, t.id, 'action', 'systemctl restart agent-conductor');
      expect(written.revision).toBe(1);
      expect(decisions.create).toHaveBeenCalledTimes(1);
      expect(decisions.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        ticketId: t.id, kind: 'action_approval', owner: 'human',
      }));
      const call = decisions.create.mock.calls[0]?.[1];
      expect(call?.options.map((o: { key: string }) => o.key)).toEqual(Object.values(NAMED_CARD_OPTION_KEYS.action_approval));
      expect(call?.target).toEqual({ documentId: written.documentId, revision: 1 });
      tickets.putDocument(AGENT, t.id, 'action', 'systemctl restart agent-conductor --now');
      expect(decisions.create).toHaveBeenCalledTimes(2);
    });

    it('stores an action document on a non-operational ticket without raising action_approval', () => {
      const t = make({ kind: 'scout', title: 'Investigate' });
      decisions.create.mockClear();
      tickets.putDocument(AGENT, t.id, 'action', 'not a gate');
      expect(decisions.create).not.toHaveBeenCalled();
      expect(tickets.getDocument(t.id, 'action')?.body).toBe('not a gate');
    });

    it('opens a merge_approval on in_review unless auto_merge is set', async () => {
      const t = make({ kind: 'task' });
      tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'u' });
      h.db.update('tickets', t.id, { status: 'in_progress' });
      await tickets.transition(AGENT, t.id, { to: 'in_review' });
      expect(decisions.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'merge_approval' }));
      // VS-111: the merge-approval card no longer offers Hold, so the decision it answers must never
      // offer a third key that a card could be tempted to send.
      const mergeCall = decisions.create.mock.calls.find((c) => c[1]?.kind === 'merge_approval');
      expect(mergeCall?.[1]?.options.map((o: { key: string }) => o.key)).toEqual(Object.values(NAMED_CARD_OPTION_KEYS.merge_approval));

      decisions.create.mockClear();
      const auto = make({ kind: 'task', autoMerge: true, title: 'auto' });
      tickets.addWorkProduct(AGENT, auto.id, { type: 'pull_request', url: 'u' });
      h.db.update('tickets', auto.id, { status: 'in_progress' });
      await tickets.transition(AGENT, auto.id, { to: 'in_review' });
      expect(decisions.create).not.toHaveBeenCalled();
    });
  });

  describe('checkout', () => {
    it('is idempotent for the bound worker and conflicts for anyone else', () => {
      const t = make();
      const workerId = h.addWorker(t.id);
      tickets.checkout(AGENT, t.id, 'run-1', workerId);
      expect(tickets.get(t.id).checkoutRunId).toBe('run-1');
      expect(tickets.checkout(AGENT, t.id, 'run-2', workerId).executionRunId).toBe('run-2');
      expect(() => tickets.checkout(AGENT, t.id, 'run-3', 'some-other-agent')).toThrow(OcError);
      try {
        tickets.checkout(AGENT, t.id, 'run-3', 'some-other-agent');
      } catch (e) {
        expect((e as OcError).code).toBe('conflict');
      }
    });

    it('conflicts when another agent holds the execution lock on an unbound ticket', () => {
      const t = make({ assigneeRoleId: null });
      const other = h.addWorker(null);
      h.db.insert('runs', {
        id: 'run-other', workspaceId: h.workspaceId, agentId: other, ticketId: t.id, runtimeId: 'claude',
        status: 'running', turnEpoch: 1, cwd: '/tmp', createdAt: nowIso(),
      });
      h.db.update('tickets', t.id, { executionRunId: 'run-other' });
      expect(() => tickets.checkout(AGENT, t.id, 'run-mine', 'agent-mine')).toThrow(/locked by run/);
    });

    it('releases only its own run lock', () => {
      const t = make();
      const workerId = h.addWorker(t.id);
      tickets.checkout(AGENT, t.id, 'run-1', workerId);
      tickets.release(AGENT, t.id, 'run-other');
      expect(tickets.get(t.id).executionRunId).toBe('run-1');
      tickets.release(AGENT, t.id, 'run-1', 'done for now');
      expect(tickets.get(t.id).executionRunId).toBeNull();
      expect(tickets.get(t.id).checkoutRunId).toBeNull();
    });
  });

  describe('comments and propagation', () => {
    it('wakes the worker on a human comment but not on an agent comment', () => {
      const t = make();
      const workerId = h.addWorker(t.id);
      tickets.comment(AGENT, t.id, 'working on it', 'status');
      expect(wake.calls).toHaveLength(0);
      tickets.comment(HUMAN, t.id, 'please also add tests');
      expect(wake.calls).toEqual([expect.objectContaining({ agentId: workerId, input: expect.objectContaining({ source: 'ticket_comment' }) })]);
      expect(tickets.comments(t.id)).toHaveLength(2);
    });

    // VS-246: a comment over the bound used to be sliced silently into the wake payload. Every
    // payload site now carries VS-242's `truncated`/`bodyLength` marker, and a reader is pointed at
    // `ac_ticket_comments` for the full body.
    describe('ticket comment truncation (VS-246)', () => {
      const tick = () => new Promise((r) => setImmediate(r));

      it('marks an over-bound comment with the original length and points at the read tool', () => {
        const t = make();
        h.addWorker(t.id);
        const body = 'z'.repeat(TICKET_COMMENT_WAKE_BODY_CHARS + 1);
        tickets.comment(HUMAN, t.id, body);
        const call = wake.calls[0]!;
        const payload = call.input.payload as { body: string; truncated?: boolean; bodyLength?: number };
        expect(payload.body).toHaveLength(TICKET_COMMENT_WAKE_BODY_CHARS);
        expect(payload.truncated).toBe(true);
        expect(payload.bodyLength).toBe(body.length);
        expect(call.input.reason).toContain('ac_ticket_comments');
      });

      it('reproduces bodyLength 9000 for a 9,000-character comment', () => {
        const t = make();
        h.addWorker(t.id);
        tickets.comment(HUMAN, t.id, 'q'.repeat(9000));
        const payload = wake.calls[0]!.input.payload as { truncated?: boolean; bodyLength?: number };
        expect(payload.truncated).toBe(true);
        expect(payload.bodyLength).toBe(9000);
      });

      it('leaves a within-bound comment unchanged, with no truncation fields and an unchanged reason', () => {
        const t = make();
        h.addWorker(t.id);
        const body = 'please also add tests';
        tickets.comment(HUMAN, t.id, body);
        const call = wake.calls[0]!;
        const payload = call.input.payload as Record<string, unknown>;
        expect(payload.body).toBe(body);
        expect(payload).not.toHaveProperty('truncated');
        expect(payload).not.toHaveProperty('bodyLength');
        expect(call.input.reason).toBe(`new comment on ${t.identifier}`);
      });

      it('marks the follow-up payload a spawned worker receives', async () => {
        const t = make();
        const body = 'w'.repeat(TICKET_COMMENT_WAKE_BODY_CHARS + 10);
        tickets.comment(HUMAN, t.id, body);
        await tick();
        const call = wake.calls.find((c) => c.input.source === 'ticket_comment');
        const payload = call?.input.payload as { body: string; truncated?: boolean; bodyLength?: number };
        expect(payload.truncated).toBe(true);
        expect(payload.bodyLength).toBe(body.length);
        expect(call?.input.reason).toContain('ac_ticket_comments');
      });

      it('marks the relaunch note when the reply is longer than its excerpt, and leaves a short one alone', async () => {
        const t = make();
        h.addWorker(t.id);
        h.db.update('tickets', t.id, { workerId: null });
        const relaunch = (h.services.workers as unknown as { relaunch: ReturnType<typeof vi.fn> }).relaunch;

        tickets.comment(HUMAN, t.id, 'r'.repeat(320));
        await tick();
        expect(relaunch).toHaveBeenCalledTimes(1);
        const marked = String(relaunch.mock.calls[0]![2]);
        expect(marked).toContain(t.identifier);
        expect(marked).toContain('ac_ticket_comments');

        relaunch.mockClear();
        tickets.comment(HUMAN, t.id, 'a short reply');
        await tick();
        const note = String(relaunch.mock.calls[0]![2]);
        expect(note).toContain('a short reply');
        expect(note).not.toContain('ac_ticket_comments');
      });

      it('points the conductor at the full comment when a workerless ticket has no role', async () => {
        const t = make({ assigneeRoleId: null });
        const body = 'n'.repeat(TICKET_COMMENT_WAKE_BODY_CHARS + 5);
        tickets.comment(HUMAN, t.id, body);
        await tick();
        const call = wake.calls.find((c) => c.agentId === h.conductorId);
        expect(call?.input.reason).toContain('ac_ticket_comments');
        const payload = call?.input.payload as { truncated?: boolean; bodyLength?: number };
        expect(payload.truncated).toBe(true);
        expect(payload.bodyLength).toBe(body.length);
      });
    });

    it('moves a blocked dependent back to todo and wakes it when its blockers land', async () => {
      const blocker = make({ title: 'blocker' });
      const dep = make({ title: 'dependent' });
      tickets.setBlockers(HUMAN, dep.id, [blocker.id]);
      expect(tickets.get(dep.id).status).toBe('blocked');
      const depWorker = h.addWorker(dep.id);
      h.db.update('tickets', blocker.id, { status: 'in_progress' });
      await tickets.transition(AGENT, blocker.id, { to: 'in_review' }).catch(() => undefined);
      tickets.addWorkProduct(AGENT, blocker.id, { type: 'branch', title: 'ac/x' });
      h.db.update('tickets', blocker.id, { status: 'merging', autoMerge: 1 });
      // VS-250: done from merging is merge-done's alone, and that is the path these tests mean.
      await tickets.mergeDone(SYSTEM, blocker.id, {});
      expect(tickets.get(dep.id).status).toBe('todo');
      expect(wake.calls.some((c) => c.agentId === depWorker && c.input.source === 'blockers_resolved')).toBe(true);
    });

    // VS-118: a dependent blocked while `approved` (or further along) used to lose that status to the
    // same `assigneeRoleId ? todo : backlog` guess `setBlockers` and this propagation used for a
    // ticket that never had a recorded prior status. Once one is recorded, it wins.
    it('returns a blocked dependent to the status it held, not always todo, when its blockers land', async () => {
      const blocker = make({ title: 'blocker' });
      const dep = make({ title: 'dependent' });
      h.db.update('tickets', dep.id, { status: 'approved' });
      tickets.setBlockers(HUMAN, dep.id, [blocker.id]);
      expect(tickets.get(dep.id)).toMatchObject({ status: 'blocked', blockedFromStatus: 'approved' });

      tickets.addWorkProduct(AGENT, blocker.id, { type: 'branch', title: 'ac/x' });
      h.db.update('tickets', blocker.id, { status: 'merging', autoMerge: 1 });
      // VS-250: done from merging is merge-done's alone, and that is the path these tests mean.
      await tickets.mergeDone(SYSTEM, blocker.id, {});

      expect(tickets.get(dep.id)).toMatchObject({ status: 'approved', blockedFromStatus: null });
    });

    it('setBlockers itself restores the status a ticket held before it was blocked', () => {
      const blocker = make({ title: 'blocker' });
      const dep = make({ title: 'dependent' });
      h.db.update('tickets', dep.id, { status: 'in_progress' });
      tickets.setBlockers(HUMAN, dep.id, [blocker.id]);
      expect(tickets.get(dep.id)).toMatchObject({ status: 'blocked', blockedFromStatus: 'in_progress' });

      tickets.setBlockers(HUMAN, dep.id, []);

      expect(tickets.get(dep.id)).toMatchObject({ status: 'in_progress', blockedFromStatus: null });
    });

    it('wakes the parent when every child is terminal', async () => {
      const parent = make({ title: 'parent' });
      const parentWorker = h.addWorker(parent.id);
      const child = make({ title: 'child', parentId: parent.id });
      tickets.cancel(HUMAN, child.id, 'not needed');
      expect(wake.calls.some((c) => c.agentId === parentWorker && c.input.source === 'children_completed')).toBe(true);
    });
  });

  // VS-118: `retry()` picked `in_progress` vs `todo` from `t.executionRunId`, which is always null
  // for a blocked ticket by the time a human retries it — the run that got it parked already cleared
  // its own lock. It must restore what the ticket actually was.
  describe('retry (VS-118)', () => {
    it('restores the ticket to the status it held before it was blocked, not always todo', async () => {
      const t = make();
      const workerId = h.addWorker(t.id);
      const relaunch = vi.fn(async () => undefined);
      h.services.workers = { get: vi.fn(() => ({ id: workerId, status: 'active' })), relaunch } as never;
      h.db.update('tickets', t.id, { status: 'in_progress' });
      await tickets.transition(SYSTEM, t.id, { to: 'blocked', unblock: { owner: 'human', action: 'retry or cancel' } });

      const after = await tickets.retry(HUMAN, t.id, 'try again');

      expect(relaunch).toHaveBeenCalledWith(HUMAN, workerId, 'try again');
      expect(after.status).toBe('in_progress');
    });
  });

  describe('lastWorker (VS-106)', () => {
    it('names the ticket\'s worker even after retirement nulls its current one', () => {
      const t = make();
      const workerId = h.addWorker(t.id);
      expect(tickets.lastWorker(t.id)?.id).toBe(workerId);

      h.db.update('agents', workerId, { status: 'retired', retiredAt: nowIso() });
      h.db.update('tickets', t.id, { workerId: null });
      expect(tickets.lastWorker(t.id)?.id).toBe(workerId);
    });

    it('is null for a ticket that never had a worker', () => {
      const t = make();
      expect(tickets.lastWorker(t.id)).toBeNull();
    });
  });

  describe('terminal ticket releases its worker (VS-172)', () => {
    const LIVE = new Set(['provisioning', 'active', 'running']);

    it('cancel from todo takes an active worker out of the live set', () => {
      const t = make();
      const workerId = h.addWorker(t.id);
      h.db.insert('worktrees', {
        id: newId(), projectId: h.projectId, ticketId: t.id, agentId: workerId, provider: 'git',
        path: '/tmp/wt', branch: 'ac/test', status: 'active', createdAt: nowIso(),
      });
      tickets.cancel(HUMAN, t.id, 'not needed');
      const worker = h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [workerId])!;
      expect(LIVE.has(worker.status)).toBe(false);
      expect(worker.status).toBe('done');
      expect(h.db.get<{ status: string }>('SELECT status FROM worktrees WHERE agent_id = ?', [workerId])!.status).toBe('dirty');
    });

    it('transition to done takes an active worker out of the live set without a supervisor tick', async () => {
      const t = make({ kind: 'task' });
      const workerId = h.addWorker(t.id);
      h.db.update('tickets', t.id, { status: 'in_progress' });
      await tickets.transition(AGENT, t.id, { to: 'done', note: 'ending: nothing to land' });
      const worker = h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [workerId])!;
      expect(LIVE.has(worker.status)).toBe(false);
      expect(worker.status).toBe('done');
    });

    it('leaves an already-retired worker retired', async () => {
      const t = make({ kind: 'task' });
      const workerId = h.addWorker(t.id, { status: 'retired', retiredAt: nowIso() });
      h.db.update('tickets', t.id, { status: 'in_progress' });
      await tickets.transition(AGENT, t.id, { to: 'done', note: 'ending: nothing to land' });
      expect(h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [workerId])!.status).toBe('retired');
    });

    it('still transitions a ticket that has no worker', async () => {
      const t = make({ kind: 'task' });
      h.db.update('tickets', t.id, { status: 'in_progress' });
      expect((await tickets.transition(AGENT, t.id, { to: 'done', note: 'ending: nothing to land' })).status).toBe('done');
    });
  });

  describe('mergeDone', () => {
    it('archives the openspec change and completes the ticket', async () => {
      const t = make();
      tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'u' });
      h.db.update('tickets', t.id, { status: 'merging' });
      const next = await tickets.mergeDone(AGENT, t.id, { mergeCommit: 'abc1234', method: 'squash' });
      expect(openspec.archiveAfterMerge).toHaveBeenCalledWith(t.id);
      expect(next.status).toBe('done');
      expect(next.delivery).toMatchObject({ merged: true, archivedAs: '2026-09-04-tst-1-thing' });
      expect(h.events.some((e) => e.type === 'ticket.merged')).toBe(true);
    });

    it('leaves the ticket merging with an unblock path when the archive fails', async () => {
      openspec.archiveAfterMerge.mockRejectedValueOnce(new Error('git push denied'));
      const t = make();
      h.db.update('tickets', t.id, { status: 'merging' });
      await expect(tickets.mergeDone(AGENT, t.id, {})).rejects.toThrow(/archive failed/);
      const after = tickets.get(t.id);
      expect(after.status).toBe('merging');
      expect(after.unblock).toMatchObject({ owner: 'weaver' });
      expect(wake.calls.some((c) => c.agentId === h.conductorId && c.input.source === 'system')).toBe(true);
    });

    it('refuses when the ticket is not merging', async () => {
      const t = make();
      await expect(tickets.mergeDone(AGENT, t.id, {})).rejects.toMatchObject({ code: 'wrong_status' });
    });
  });

  describe('post-merge follow-up work', () => {
    /** Merge `t` and let the scheduled follow-up work fire and settle. */
    const mergeAndDrain = async (t: { id: string }) => {
      h.db.update('tickets', t.id, { status: 'merging' });
      await tickets.mergeDone(AGENT, t.id, {});
      vi.advanceTimersByTime(200);
      await tickets.stop();
    };

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('re-indexes the merged ticket\'s project', async () => {
      const t = make();
      await mergeAndDrain(t);
      expect(specs.calls).toEqual([h.projectId]);
    });

    it('schedules nothing for a ticket without a project', async () => {
      const t = make({ projectId: null, assigneeRoleId: null });
      await mergeAndDrain(t);
      expect(specs.calls).toEqual([]);
    });

    it('contains a re-index that throws before it returns a promise', async () => {
      // `deps()` throws synchronously for a service the test did not stub, so the throw happens
      // before `index()` is called — the reason this timer used to take the whole run down.
      delete h.services.specs;
      const t = make();
      h.db.update('tickets', t.id, { status: 'merging' });
      await tickets.mergeDone(AGENT, t.id, {});
      expect(() => vi.advanceTimersByTime(200)).not.toThrow();
      await expect(tickets.stop()).resolves.toBeUndefined();
      expect(tickets.get(t.id).status).toBe('done');
    });

    it('contains a re-index that rejects, and still runs the next one', async () => {
      specs.index = vi.fn()
        .mockRejectedValueOnce(new Error('index failed'))
        .mockResolvedValueOnce({ capabilities: 0, changes: 0 });
      const first = make();
      const second = make();
      h.db.update('tickets', first.id, { status: 'merging' });
      h.db.update('tickets', second.id, { status: 'merging' });
      await tickets.mergeDone(AGENT, first.id, {});
      await tickets.mergeDone(AGENT, second.id, {});
      expect(() => vi.advanceTimersByTime(200)).not.toThrow();
      await expect(tickets.stop()).resolves.toBeUndefined();
      expect(specs.index).toHaveBeenCalledTimes(2);
      expect(tickets.get(second.id).status).toBe('done');
    });

    it('cancels work that has not fired yet', async () => {
      const t = make();
      h.db.update('tickets', t.id, { status: 'merging' });
      await tickets.mergeDone(AGENT, t.id, {});
      await tickets.stop();
      vi.advanceTimersByTime(1000);
      expect(specs.calls).toEqual([]);
    });

    it('waits for work already in flight', async () => {
      let release: () => void = () => {};
      let finished = false;
      specs.index = vi.fn(() => new Promise<{ capabilities: number; changes: number }>((resolve) => {
        release = () => { finished = true; resolve({ capabilities: 0, changes: 0 }); };
      })) as never;
      const t = make();
      h.db.update('tickets', t.id, { status: 'merging' });
      await tickets.mergeDone(AGENT, t.id, {});
      vi.advanceTimersByTime(200);
      const stopped = tickets.stop();
      expect(finished).toBe(false);
      release();
      await stopped;
      expect(finished).toBe(true);
    });

    it('resolves when idle and when called twice', async () => {
      await expect(tickets.stop()).resolves.toBeUndefined();
      const t = make();
      await mergeAndDrain(t);
      await expect(tickets.stop()).resolves.toBeUndefined();
    });
  });

  describe('livenessViolations', () => {
    it('ignores tickets with a pending spawn, an open decision or a queued wake', () => {
      const pendingSpawn = make({ title: 'waiting for a slot' });
      expect(tickets.livenessViolations().map((t) => t.id)).not.toContain(pendingSpawn.id);

      const stalled = make({ title: 'stalled' });
      const workerId = h.addWorker(stalled.id);
      h.db.update('tickets', stalled.id, { status: 'in_progress' });
      expect(tickets.livenessViolations().map((t) => t.id)).toContain(stalled.id);

      h.db.insert('wakeups', {
        id: newId(), workspaceId: h.workspaceId, agentId: workerId, source: 'system', reason: 'ping',
        payloadJson: {}, status: 'queued', createdAt: nowIso(),
      });
      expect(tickets.livenessViolations().map((t) => t.id)).not.toContain(stalled.id);
    });

    it('ignores an interactive session left open after conversation (VS-213)', () => {
      const session = make({ title: 'session', interactiveSession: true });
      h.addWorker(session.id);
      h.db.update('tickets', session.id, { status: 'todo' });
      expect(tickets.livenessViolations().map((t) => t.id)).not.toContain(session.id);
      h.db.update('tickets', session.id, { status: 'in_progress' });
      expect(tickets.livenessViolations().map((t) => t.id)).not.toContain(session.id);

      const ordinary = make({ title: 'ordinary' });
      h.addWorker(ordinary.id);
      h.db.update('tickets', ordinary.id, { status: 'in_progress' });
      expect(tickets.livenessViolations().map((t) => t.id)).toContain(ordinary.id);
    });

    it('ignores an in_progress operational ticket waiting on an open action_approval', () => {
      const t = make({ kind: 'operational', title: 'Restart the daemon' });
      h.addWorker(t.id);
      h.db.update('tickets', t.id, { status: 'in_progress' });
      expect(tickets.livenessViolations().map((v) => v.id)).toContain(t.id);
      h.db.insert('decisions', {
        id: newId(), workspaceId: h.workspaceId, ticketId: t.id, kind: 'action_approval', owner: 'human',
        title: 'Approve the action?', context: '', status: 'open', correlationKey: `action_approval:${t.id}`, createdAt: nowIso(),
      });
      expect(tickets.livenessViolations().map((v) => v.id)).not.toContain(t.id);
    });

    it('flags an in_progress operational ticket whose action_approval is answered and whose worker has no queued wake', () => {
      const t = make({ kind: 'operational', title: 'Restart the daemon' });
      h.addWorker(t.id);
      h.db.update('tickets', t.id, { status: 'in_progress' });
      h.db.insert('decisions', {
        id: newId(), workspaceId: h.workspaceId, ticketId: t.id, kind: 'action_approval', owner: 'human',
        title: 'Approve the action?', context: '', status: 'answered', answerKey: 'approve',
        correlationKey: `action_approval:${t.id}`, createdAt: nowIso(), answeredAt: nowIso(),
      });
      expect(tickets.livenessViolations().map((v) => v.id)).toContain(t.id);
    });
  });

  describe('repairApprovals', () => {
    it('raises a fresh plan_approval for a proposed ticket with none open, and leaves one with an open approval alone', async () => {
      const stranded = make({ title: 'stranded' });
      h.db.update('tickets', stranded.id, { status: 'proposed' });

      const fine = make({ title: 'fine' });
      h.db.update('tickets', fine.id, { status: 'proposed' });
      h.db.insert('decisions', {
        id: newId(), workspaceId: h.workspaceId, ticketId: fine.id, kind: 'plan_approval', owner: 'human',
        title: 'Approve?', context: '', status: 'open', correlationKey: `plan_approval:${fine.id}`, createdAt: nowIso(),
      });
      decisions.create.mockClear();

      const repaired = await tickets.repairApprovals();
      expect(repaired).toEqual([{ id: stranded.id, identifier: stranded.identifier, kind: 'plan_approval' }]);
      expect(decisions.create).toHaveBeenCalledTimes(1);
      expect(decisions.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ticketId: stranded.id, kind: 'plan_approval' }));
      // VS-111: repairApprovals re-raises with its own (duplicated) options array — must not drift
      // from the one the normal `proposed` transition creates.
      expect(decisions.create.mock.calls[0]?.[1]?.options.map((o: { key: string }) => o.key)).toEqual(Object.values(NAMED_CARD_OPTION_KEYS.plan_approval));
    });

    it('raises a fresh merge_approval for an in_review, non-auto_merge ticket with none open, and skips auto_merge tickets', async () => {
      const stranded = make({ kind: 'task', title: 'stranded' });
      h.db.update('tickets', stranded.id, { status: 'in_review' });

      const auto = make({ kind: 'task', title: 'auto', autoMerge: true });
      h.db.update('tickets', auto.id, { status: 'in_review' });
      decisions.create.mockClear();

      const repaired = await tickets.repairApprovals();
      expect(repaired).toEqual([{ id: stranded.id, identifier: stranded.identifier, kind: 'merge_approval' }]);
      expect(decisions.create).toHaveBeenCalledTimes(1);
      expect(decisions.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ticketId: stranded.id, kind: 'merge_approval' }));
      // VS-111: same duplicated-array risk as the plan_approval repair path above.
      expect(decisions.create.mock.calls[0]?.[1]?.options.map((o: { key: string }) => o.key)).toEqual(Object.values(NAMED_CARD_OPTION_KEYS.merge_approval));
    });

    it('reports nothing when every waiting ticket already has an open approval', async () => {
      const t = make();
      h.db.update('tickets', t.id, { status: 'proposed' });
      h.db.insert('decisions', {
        id: newId(), workspaceId: h.workspaceId, ticketId: t.id, kind: 'plan_approval', owner: 'human',
        title: 'Approve?', context: '', status: 'open', correlationKey: `plan_approval:${t.id}`, createdAt: nowIso(),
      });
      expect(await tickets.repairApprovals()).toEqual([]);
    });

    it('re-raises action_approval for an operational ticket that wrote action and has none open, without YOLO', async () => {
      h.ctx.config.defaults.yolo = true;
      const neverWrote = make({ kind: 'operational', title: 'never wrote' });
      h.db.update('tickets', neverWrote.id, { status: 'in_progress' });

      const stranded = make({ kind: 'operational', title: 'stranded action' });
      h.db.update('tickets', stranded.id, { status: 'in_progress' });
      h.db.insert('ticket_documents', { id: newId(), ticketId: stranded.id, key: 'action', currentRevision: 1 });

      const fine = make({ kind: 'operational', title: 'fine action' });
      h.db.update('tickets', fine.id, { status: 'in_progress' });
      h.db.insert('ticket_documents', { id: newId(), ticketId: fine.id, key: 'action', currentRevision: 1 });
      h.db.insert('decisions', {
        id: newId(), workspaceId: h.workspaceId, ticketId: fine.id, kind: 'action_approval', owner: 'human',
        title: 'Approve?', context: '', status: 'open', correlationKey: `action_approval:${fine.id}`, createdAt: nowIso(),
      });
      decisions.create.mockClear();

      const repaired = await tickets.repairApprovals();
      expect(repaired).toEqual([{ id: stranded.id, identifier: stranded.identifier, kind: 'action_approval' }]);
      expect(decisions.create).toHaveBeenCalledTimes(1);
      expect(decisions.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        ticketId: stranded.id, kind: 'action_approval', owner: 'human',
      }));
      expect(decisions.create.mock.calls[0]?.[1]?.options.map((o: { key: string }) => o.key)).toEqual(Object.values(NAMED_CARD_OPTION_KEYS.action_approval));
    });

    it('does not re-raise after approve, even across repeated repair sweeps', async () => {
      const t = make({ kind: 'operational', title: 'deploy' });
      h.db.update('tickets', t.id, { status: 'in_progress' });
      const written = tickets.putDocument(AGENT, t.id, 'action', 'systemctl restart agent-conductor');
      const target = decisions.create.mock.calls[0]?.[1]?.target as { documentId: string; revision: number };
      expect(target).toEqual({ documentId: written.documentId, revision: 1 });
      h.db.insert('decisions', {
        id: newId(), workspaceId: h.workspaceId, ticketId: t.id, kind: 'action_approval', owner: 'human',
        title: 'Approve?', context: '', status: 'answered', answerKey: 'approve',
        correlationKey: `action_approval:${t.id}`, targetJson: target, createdAt: nowIso(), answeredAt: nowIso(),
      });
      decisions.create.mockClear();
      expect(await tickets.repairApprovals()).toEqual([]);
      expect(await tickets.repairApprovals()).toEqual([]);
      expect(decisions.create).not.toHaveBeenCalled();
    });

    it('does not re-raise after revise until a new action revision is written', async () => {
      const t = make({ kind: 'operational', title: 'deploy' });
      h.db.update('tickets', t.id, { status: 'in_progress' });
      const first = tickets.putDocument(AGENT, t.id, 'action', 'systemctl restart agent-conductor');
      const target = decisions.create.mock.calls[0]?.[1]?.target as { documentId: string; revision: number };
      expect(target).toEqual({ documentId: first.documentId, revision: 1 });
      h.db.insert('decisions', {
        id: newId(), workspaceId: h.workspaceId, ticketId: t.id, kind: 'action_approval', owner: 'human',
        title: 'Approve?', context: '', status: 'answered', answerKey: 'revise',
        correlationKey: `action_approval:${t.id}`, targetJson: target, createdAt: nowIso(), answeredAt: nowIso(),
      });
      decisions.create.mockClear();
      expect(await tickets.repairApprovals()).toEqual([]);
      expect(decisions.create).not.toHaveBeenCalled();

      const second = tickets.putDocument(AGENT, t.id, 'action', 'systemctl restart agent-conductor --now');
      expect(second.revision).toBe(2);
      expect(decisions.create).toHaveBeenCalledTimes(1);
      expect(decisions.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        ticketId: t.id, kind: 'action_approval', target: { documentId: second.documentId, revision: 2 },
      }));
    });
  });

  it('lists and filters tickets', () => {
    make({ title: 'one', description: 'the body' });
    const two = make({ title: 'two', kind: 'scout' });
    tickets.cancel(HUMAN, two.id, 'nope');
    expect(tickets.list().total).toBe(1);
    expect(tickets.list().items[0]?.description).toBe('the body');
    expect(tickets.list({ includeTerminal: true }).total).toBe(2);
    expect(tickets.list({ kind: ['scout'], includeTerminal: true }).items[0]?.id).toBe(two.id);
    expect(tickets.list({ search: 'one' }).total).toBe(1);
    expect(tickets.list({ fields: 'label' }).items[0]?.description).toBe('');
    expect(tickets.get(tickets.list().items[0]!.id).description).toBe('the body');
  });

  it('orders finished tickets by when they landed, not by ticket number', () => {
    // Filed first but finished last, so number order and finish order disagree.
    const old = make({ title: 'long runner' });
    const fresh = make({ title: 'quick one' });
    const dropped = make({ title: 'dropped' });
    h.db.update('tickets', fresh.id, { status: 'done', completedAt: '2026-09-01T09:00:00.000Z' });
    h.db.update('tickets', dropped.id, { status: 'cancelled', cancelledAt: '2026-09-02T09:00:00.000Z' });
    h.db.update('tickets', old.id, { status: 'done', completedAt: '2026-09-03T09:00:00.000Z' });

    const finished = tickets.list({ status: ['done', 'cancelled'], sort: 'finished' });
    expect(finished.items.map((t) => t.id)).toEqual([old.id, dropped.id, fresh.id]);
    // The default ordering is unchanged: newest ticket number first.
    expect(tickets.list({ status: ['done', 'cancelled'] }).items.map((t) => t.id)).toEqual([dropped.id, fresh.id, old.id]);
  });

  describe('scheduled-task filing (VS-220)', () => {
    function seedRun(runId: string, wakes: Array<{ id: string; source: string; payload: Record<string, unknown>; bundle?: unknown[] }>): void {
      const ids: string[] = [];
      for (const w of wakes) {
        ids.push(w.id);
        h.db.insert('wakeups', {
          id: w.id, workspaceId: h.workspaceId, agentId: h.conductorId, source: w.source,
          reason: w.source, payloadJson: w.bundle ? { ...w.payload, bundle: w.bundle } : w.payload,
          status: 'claimed', runId, createdAt: nowIso(),
        });
      }
      h.db.insert('runs', {
        id: runId, workspaceId: h.workspaceId, agentId: h.conductorId, wakeupIdsJson: ids, runtimeId: 'claude',
        turnEpoch: 1, cwd: h.ctx.paths.weaver, createdAt: nowIso(),
      });
    }

    it('forbids create when flattened wakes are exclusively report routine fires', () => {
      seedRun('run-report-only', [{ id: 'wk-r', source: 'routine', payload: { routineId: 'r1', action: 'report', instruction: 'look' } }]);
      const actor: Actor = { kind: 'agent', id: h.conductorId, runId: 'run-report-only' };
      expect(() => tickets.create(actor, { kind: 'scout', title: 'From an alarm', projectId: h.projectId })).toThrow(/cannot file tickets/);
    });

    it('allows create when a report fire is coalesced with a digest or ticket-event wake', () => {
      seedRun('run-digest', [{
        id: 'wk-d', source: 'system', payload: { kind: 'digest' },
        bundle: [{ source: 'routine', reason: 'scheduled task', payload: { routineId: 'r1', action: 'report' } }],
      }]);
      const actor: Actor = { kind: 'agent', id: h.conductorId, runId: 'run-digest' };
      expect(tickets.create(actor, { kind: 'scout', title: 'From a digest turn', projectId: h.projectId }).title).toBe('From a digest turn');

      seedRun('run-ticket-event', [
        { id: 'wk-t', source: 'ticket_comment', payload: { ticketId: 't1' } },
        { id: 'wk-r2', source: 'routine', payload: { routineId: 'r1', action: 'report' } },
      ]);
      // Two top-level wakes: ticket_comment is claimed as a second row. The run lists both.
      const actor2: Actor = { kind: 'agent', id: h.conductorId, runId: 'run-ticket-event' };
      expect(tickets.create(actor2, { kind: 'task', title: 'From a ticket-event turn', projectId: h.projectId }).title).toBe('From a ticket-event turn');
    });

    it('file_work cap 3 rejects the fourth ticket this fire', () => {
      seedRun('run-fw', [{
        id: 'wk-fw', source: 'routine',
        payload: { routineId: 'r-fw', action: 'file_work', maxTicketsPerFire: 3 },
      }]);
      const actor: Actor = { kind: 'agent', id: h.conductorId, runId: 'run-fw' };
      for (let i = 1; i <= 3; i++) {
        tickets.create(actor, { kind: 'scout', title: `Item ${i}`, projectId: h.projectId });
      }
      expect(() => tickets.create(actor, { kind: 'scout', title: 'Item 4', projectId: h.projectId })).toThrow(/at most 3/);
    });
  });
});
