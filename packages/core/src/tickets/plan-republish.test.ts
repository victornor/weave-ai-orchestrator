import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId, nowIso } from '@weave-ai/db';
import { makeHarness, fakeWake, type TestHarness } from '../testing/context.js';
import { createTicketsService } from './service.js';
import { createDecisionsService } from '../decisions/service.js';
import { createOpenSpecService, renderPlan } from '../openspec/index.js';
import { writeFakeOpenspec, type FakeCase, type FakeBin } from '../openspec/fakeBin.js';
import type { Actor, TicketsService } from '../api.js';

const SYSTEM: Actor = { kind: 'system', id: null };
const CHANGE = 'tst-1-dark-mode';

const STATUS_JSON = { changeName: CHANGE, isPlanningComplete: true, artifacts: [{ id: 'proposal', status: 'done' }, { id: 'tasks', status: 'done' }] };
const VALID_CASES: FakeCase[] = [
  { match: ['status', '--change'], json: STATUS_JSON },
  { match: ['validate'], json: { items: [{ issues: [] }] } },
];
const INVALID_CASES: FakeCase[] = [
  { match: ['status', '--change'], json: STATUS_JSON },
  { match: ['validate'], json: { items: [{ issues: [{ level: 'error', message: 'no tasks' }] }] } },
];

let h: TestHarness;
let tickets: TicketsService;
let wake: ReturnType<typeof fakeWake>;
let worktree: string;
let ticketId: string;
const previousBin = process.env.AC_OPENSPEC_BIN;

/** A real temporary OpenSpec change in the worker's worktree, plus the fake openspec binary. */
function setup(cases: FakeCase[], opts: { status?: string } = {}): FakeBin {
  h = makeHarness();
  wake = fakeWake();
  h.services.wake = wake as never;
  h.services.projects = { fetch: async () => ({ head: 'deadbeef', fastForwarded: true }) } as never;
  h.services.openspec = createOpenSpecService(h.ctx, h.deps);
  h.services.decisions = createDecisionsService(h.ctx, h.deps);

  ticketId = newId();
  const ts = nowIso();
  h.db.insert('tickets', {
    id: ticketId, workspaceId: h.workspaceId, projectId: h.projectId, number: 1, identifier: 'TST-1', kind: 'change',
    title: 'Dark mode', status: opts.status ?? 'proposed', createdByKind: 'human', openspecChangeName: CHANGE, createdAt: ts, updatedAt: ts,
  });
  const workerId = h.addWorker(ticketId);
  worktree = h.db.get<{ worktreePath: string }>('SELECT worktree_path FROM agents WHERE id = ?', [workerId])!.worktreePath;
  const changeDir = join(worktree, 'openspec', 'changes', CHANGE);
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, 'proposal.md'), '## Why\nUsers want dark mode.\n');
  writeFileSync(join(changeDir, 'tasks.md'), '- [x] add tokens\n- [ ] wire the toggle\n');
  writeFileSync(join(changeDir, 'design.md'), 'CSS variables per theme.\n');

  const bin = writeFakeOpenspec(join(h.root, 'fake-openspec'), cases);
  process.env.AC_OPENSPEC_BIN = bin.path;

  tickets = createTicketsService(h.ctx, h.deps);
  h.services.tickets = tickets;
  return bin;
}

const planApprovals = () => h.services.decisions!.list({ ticketId }).filter((d) => d.kind === 'plan_approval');

afterEach(async () => {
  if (tickets) await tickets.stop();
  h?.cleanup();
  if (previousBin === undefined) delete process.env.AC_OPENSPEC_BIN; else process.env.AC_OPENSPEC_BIN = previousBin;
});

beforeEach(() => { tickets = undefined as unknown as TicketsService; });

describe('TicketsService.republishRevisedPlan', () => {
  it('republishes a plan revised while proposed, superseding the held card and waking the weaver', async () => {
    setup(VALID_CASES);
    // The original propose published revision 1 and raised the card the weaver then held.
    tickets.putDocument(SYSTEM, ticketId, 'plan', renderPlan(join(worktree, 'openspec', 'changes', CHANGE), CHANGE), { system: true });
    const first = h.services.decisions!.create(SYSTEM, {
      ticketId, kind: 'plan_approval', owner: 'human', title: 'Approve the plan', correlationKey: `plan_approval:${ticketId}`,
    });
    h.services.decisions!.review({ kind: 'agent', id: h.conductorId }, first.id, { status: 'concerns', note: 'tighten the second task' });
    wake.calls.length = 0;

    // The worker revises its artifacts during the turn, and the turn ends without a transition.
    writeFileSync(join(worktree, 'openspec', 'changes', CHANGE, 'tasks.md'), '- [x] add tokens\n- [x] wire the toggle\n- [ ] write docs\n');

    const result = await tickets.republishRevisedPlan(SYSTEM, ticketId);
    expect(result).toEqual({ republished: true, reason: 'republished' });

    expect(tickets.getDocument(ticketId, 'plan')!.revision).toBe(2);
    const approvals = planApprovals();
    expect(approvals.filter((d) => d.status === 'open')).toHaveLength(1);
    const open = approvals.find((d) => d.status === 'open')!;
    expect(open.weaverReviewStatus).toBe('unseen');
    expect((open.target as { revision?: number } | null)?.revision).toBe(2);
    expect(approvals.find((d) => d.id === first.id)!.status).toBe('superseded');

    // The fresh card wakes the weaver for review (VS-361), with no digest involved.
    expect(wake.calls.some((c) => c.agentId === h.conductorId && c.input.reason === 'decision plan_approval awaits your review' && (c.input.payload as { decisionId?: string }).decisionId === open.id)).toBe(true);
    // The republish is on the record.
    expect(tickets.comments(ticketId).some((c) => c.body.includes('published as revision 2'))).toBe(true);
  });

  it('publishes nothing when the plan did not change', async () => {
    const bin = setup(VALID_CASES);
    const rendered = renderPlan(join(worktree, 'openspec', 'changes', CHANGE), CHANGE);
    tickets.putDocument(SYSTEM, ticketId, 'plan', rendered, { system: true });

    const result = await tickets.republishRevisedPlan(SYSTEM, ticketId);

    expect(result).toEqual({ republished: false, reason: 'unchanged' });
    expect(tickets.getDocument(ticketId, 'plan')!.revision).toBe(1);
    expect(planApprovals()).toHaveLength(0);
    expect(bin.calls().length).toBeGreaterThan(0); // it still rendered and validated to know nothing changed
  });

  it('publishes nothing and names the issues when the revision is invalid', async () => {
    setup(INVALID_CASES);
    const result = await tickets.republishRevisedPlan(SYSTEM, ticketId);

    expect(result).toEqual({ republished: false, reason: 'validation failed' });
    expect(tickets.getDocument(ticketId, 'plan')).toBeNull();
    expect(planApprovals()).toHaveLength(0);
    const comment = tickets.comments(ticketId).find((c) => c.body.includes('does not validate'))!;
    expect(comment.body).toContain('no tasks');
    expect(wake.calls.some((c) => c.agentId === h.conductorId && String(c.input.reason).includes('failed validation'))).toBe(true);
  });

  it('never republishes a ticket that is not proposed', async () => {
    const bin = setup(VALID_CASES, { status: 'in_progress' });
    const result = await tickets.republishRevisedPlan(SYSTEM, ticketId);

    expect(result).toEqual({ republished: false, reason: 'not proposed' });
    expect(bin.calls()).toHaveLength(0);
  });

  it('writes nothing when the ticket is approved while validation is still running', async () => {
    setup(VALID_CASES);
    tickets.putDocument(SYSTEM, ticketId, 'plan', renderPlan(join(worktree, 'openspec', 'changes', CHANGE), CHANGE), { system: true });
    const card = h.services.decisions!.create(SYSTEM, {
      ticketId, kind: 'plan_approval', owner: 'human', title: 'Approve the plan', correlationKey: `plan_approval:${ticketId}`,
    });
    // The worker revises its artifacts, so a republish would have something to write.
    writeFileSync(join(worktree, 'openspec', 'changes', CHANGE, 'tasks.md'), '- [x] add tokens\n- [x] wire the toggle\n- [ ] write docs\n');

    // Validation resolves only after the human has approved the open card.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const real = h.services.openspec!.validateForProposed.bind(h.services.openspec);
    vi.spyOn(h.services.openspec!, 'validateForProposed').mockImplementation(async (id: string) => { await gate; return real(id); });

    const pending = tickets.republishRevisedPlan(SYSTEM, ticketId);
    // VS-474: an unanswered card is held until the weaver reviews it, so mark it looked before the
    // approval that moves the ticket mid-flight.
    await h.services.decisions!.review({ kind: 'agent', id: h.conductorId, runId: 'run-c' }, card.id, { status: 'looked', note: 'the plan is sound' });
    await h.services.decisions!.answer(SYSTEM, card.id, { key: 'approve' }); // moves the ticket to approved mid-flight
    release();
    const result = await pending;

    expect(result).toEqual({ republished: false, reason: 'no longer proposed' });
    expect(h.db.get<{ status: string }>('SELECT status FROM tickets WHERE id = ?', [ticketId])!.status).toBe('approved');
    expect(tickets.getDocument(ticketId, 'plan')!.revision).toBe(1);
    expect(planApprovals().filter((d) => d.status === 'open')).toHaveLength(0);
  });

  describe('after approval (VS-907)', () => {
    const planPath = () => join(worktree, 'openspec', 'changes', CHANGE);
    const tasksPath = () => join(planPath(), 'tasks.md');
    const status = () => h.db.get<{ status: string }>('SELECT status FROM tickets WHERE id = ?', [ticketId])!.status;
    const approvedWithPlan = () => {
      setup(VALID_CASES, { status: 'approved' });
      tickets.putDocument(SYSTEM, ticketId, 'plan', renderPlan(planPath(), CHANGE), { system: true });
    };

    it('publishes a revised plan, sends the ticket back to proposed and raises a card on the new revision', async () => {
      approvedWithPlan();
      writeFileSync(tasksPath(), '- [x] add tokens\n- [ ] wire the toggle\n- [ ] write docs\n');

      expect(await tickets.republishRevisedPlan(SYSTEM, ticketId)).toEqual({ republished: true, reason: 'republished' });

      expect(status()).toBe('proposed');
      expect(tickets.getDocument(ticketId, 'plan')!.revision).toBe(2);
      const open = planApprovals().filter((d) => d.status === 'open');
      expect(open).toHaveLength(1);
      expect((open[0]!.target as { revision?: number } | null)?.revision).toBe(2);
      expect(open[0]!.context).toContain('revised after it was approved (revision 1)');
      expect(open[0]!.context).toContain('this is revision 2');
      expect(tickets.comments(ticketId).some((c) => c.body.includes('revised after approval') && c.body.includes('approved: revision 1'))).toBe(true);
    });

    it('approving the fresh card returns the ticket to approved and wakes the worker', async () => {
      approvedWithPlan();
      writeFileSync(tasksPath(), '- [x] add tokens\n- [ ] wire the toggle\n- [ ] write docs\n');
      await tickets.republishRevisedPlan(SYSTEM, ticketId);
      const card = planApprovals().find((d) => d.status === 'open')!;
      await h.services.decisions!.review({ kind: 'agent', id: h.conductorId, runId: 'run-c' }, card.id, { status: 'looked', note: 'ok' });
      wake.calls.length = 0;

      await h.services.decisions!.answer(SYSTEM, card.id, { key: 'approve' });

      expect(status()).toBe('approved');
      expect(wake.calls.some((c) => c.input.source === 'ticket_assigned' && String(c.input.reason).includes('plan approved'))).toBe(true);
    });

    it.each(['approved', 'proposed'])('ticking every task box on a %s ticket republishes nothing', async (from) => {
      setup(VALID_CASES, { status: from });
      tickets.putDocument(SYSTEM, ticketId, 'plan', renderPlan(planPath(), CHANGE), { system: true });
      writeFileSync(tasksPath(), '- [X] add tokens\n- [x] wire the toggle\n');

      expect(await tickets.republishRevisedPlan(SYSTEM, ticketId)).toEqual({ republished: false, reason: 'unchanged' });

      expect(status()).toBe(from);
      expect(tickets.getDocument(ticketId, 'plan')!.revision).toBe(1);
      expect(planApprovals()).toHaveLength(0);
    });

    it.each([
      ['reworded', '- [x] add colour tokens\n- [ ] wire the toggle\n'],
      ['removed', '- [x] add tokens\n'],
      ['reordered', '- [ ] wire the toggle\n- [x] add tokens\n'],
      ['reworded and ticked', '- [x] add tokens\n- [x] wire the switch\n'],
    ])('a %s task is a plan change', async (_name, tasks) => {
      approvedWithPlan();
      writeFileSync(tasksPath(), tasks);

      expect(await tickets.republishRevisedPlan(SYSTEM, ticketId)).toEqual({ republished: true, reason: 'republished' });
      expect(status()).toBe('proposed');
    });

    it('leaves an approved ticket alone when the revision is invalid', async () => {
      setup(INVALID_CASES, { status: 'approved' });
      writeFileSync(tasksPath(), '- [ ] something else\n');

      expect(await tickets.republishRevisedPlan(SYSTEM, ticketId)).toEqual({ republished: false, reason: 'validation failed' });
      expect(status()).toBe('approved');
      expect(planApprovals()).toHaveLength(0);
    });

    it('writes nothing when the ticket moves on while validation is running', async () => {
      approvedWithPlan();
      writeFileSync(tasksPath(), '- [x] add tokens\n- [ ] write docs\n');
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const real = h.services.openspec!.validateForProposed.bind(h.services.openspec);
      vi.spyOn(h.services.openspec!, 'validateForProposed').mockImplementation(async (id: string) => { await gate; return real(id); });

      const pending = tickets.republishRevisedPlan(SYSTEM, ticketId);
      await tickets.transition({ kind: 'agent', id: 'w' }, ticketId, { to: 'in_progress' });
      release();

      expect(await pending).toEqual({ republished: false, reason: 'no longer proposed' });
      expect(status()).toBe('in_progress');
      expect(tickets.getDocument(ticketId, 'plan')!.revision).toBe(1);
    });

    it('still refuses a requested approved → proposed or proposing, naming the allowed set', async () => {
      approvedWithPlan();
      for (const to of ['proposed', 'proposing'] as const) {
        await expect(tickets.transition({ kind: 'agent', id: 'w' }, ticketId, { to })).rejects.toMatchObject({
          code: 'invalid_disposition',
          details: { from: 'approved', allowed: ['in_progress', 'in_review', 'blocked', 'cancelled'] },
        });
      }
      expect(status()).toBe('approved');
    });
  });
});
