import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId, nowIso } from '@agent-conductor/db';
import type { ProjectsService, TicketsService } from '../api.js';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { writeFakeOpenspec, type FakeCase } from './fakeBin.js';
import { createOpenSpecService } from './index.js';

let h: TestHarness | null = null;
const previousBin = process.env.AC_OPENSPEC_BIN;
afterEach(() => {
  h?.cleanup(); h = null;
  if (previousBin === undefined) delete process.env.AC_OPENSPEC_BIN; else process.env.AC_OPENSPEC_BIN = previousBin;
});

const CHANGE = 'tst-1-dark-mode';

function setup(cases: FakeCase[], opts: { changeName?: string | null; policies?: Record<string, unknown> } = {}): { harness: TestHarness; ticketId: string; clone: string; bin: ReturnType<typeof writeFakeOpenspec> } {
  const harness = makeHarness();
  h = harness;
  const clone = join(harness.root, 'projects', 'api');
  mkdirSync(clone, { recursive: true });
  if (opts.policies) harness.db.update('projects', harness.projectId, { policiesJson: opts.policies });

  const ticketId = newId();
  const ts = nowIso();
  harness.db.insert('tickets', {
    id: ticketId, workspaceId: harness.workspaceId, projectId: harness.projectId, number: 1, identifier: 'TST-1', kind: 'change',
    title: 'Dark mode', status: 'proposing', createdByKind: 'human', openspecChangeName: opts.changeName === undefined ? CHANGE : opts.changeName,
    createdAt: ts, updatedAt: ts,
  });
  harness.services.tickets = {
    get: (id: string) => harness.db.get<Record<string, unknown>>('SELECT * FROM tickets WHERE id = ?', [id]) as never,
  } as unknown as TicketsService;
  harness.services.projects = { fetch: async () => ({ head: 'deadbeef', fastForwarded: true }) } as unknown as ProjectsService;

  const bin = writeFakeOpenspec(join(harness.root, 'fake-openspec'), cases);
  process.env.AC_OPENSPEC_BIN = bin.path;
  return { harness, ticketId, clone, bin };
}

function writeChange(dir: string, files: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
}

const READY_CASES: FakeCase[] = [
  { match: ['status', '--change'], json: { changeName: CHANGE, isPlanningComplete: true, artifacts: [{ id: 'proposal', status: 'done', requires: [] }, { id: 'tasks', status: 'done', requires: ['proposal'] }] } },
  { match: ['list'], json: { changes: [{ name: CHANGE, completedTasks: 2, totalTasks: 4, status: 'in-progress' }] } },
  { match: ['instructions', 'apply'], json: { state: 'ready', progress: { completed: 2, total: 4 }, tasks: [], contextFiles: [] } },
  { match: ['validate'], json: { items: [{ issues: [] }] } },
];

describe('OpenSpecService.statusFor', () => {
  it('assembles the status, caches it on the ticket and emits ticket.updated', async () => {
    const { harness, ticketId, clone } = setup(READY_CASES);
    mkdirSync(join(clone, 'openspec', 'changes', CHANGE), { recursive: true });
    mkdirSync(join(clone, 'openspec', 'changes', 'archive', `2026-09-01-${CHANGE}`), { recursive: true });

    const svc = createOpenSpecService(harness.ctx, harness.deps);
    const status = await svc.statusFor(ticketId);
    expect(status).toEqual({
      changeName: CHANGE, planningComplete: true,
      artifacts: [{ id: 'proposal', status: 'done' }, { id: 'tasks', status: 'done' }],
      tasks: { total: 4, complete: 2 }, applyState: 'ready', validation: { ok: true, issues: [] }, archived: true,
    });
    const row = harness.db.get<{ openspecState: unknown }>('SELECT openspec_state_json FROM tickets WHERE id = ?', [ticketId]);
    expect(row?.openspecState).toEqual(status);
    expect(harness.events.some((e) => e.type === 'ticket.updated' && e.entityId === ticketId)).toBe(true);
  });

  it('runs in the worker worktree when the ticket has a live worker', async () => {
    const { harness, ticketId, clone, bin } = setup(READY_CASES);
    mkdirSync(join(clone, 'openspec'), { recursive: true });
    const workerId = harness.addWorker(ticketId);
    const worktree = harness.db.get<{ worktreePath: string }>('SELECT worktree_path FROM agents WHERE id = ?', [workerId])!.worktreePath;
    mkdirSync(join(worktree, 'openspec', 'changes', CHANGE), { recursive: true });

    await createOpenSpecService(harness.ctx, harness.deps).statusFor(ticketId);
    expect(bin.calls().length).toBeGreaterThan(0);
    for (const c of bin.calls()) expect(c.cwd).toBe(worktree);
  });

  it('returns a zeroed status when the ticket has no change, when openspec/ is absent and when the binary is missing', async () => {
    const zero = { planningComplete: false, artifacts: [], tasks: null, applyState: null, validation: null, archived: false };

    const a = setup(READY_CASES, { changeName: null });
    expect(await createOpenSpecService(a.harness.ctx, a.harness.deps).statusFor(a.ticketId)).toEqual({ changeName: '', ...zero });
    a.harness.cleanup(); h = null;

    const b = setup(READY_CASES);   // no openspec/ directory in the clone
    expect(await createOpenSpecService(b.harness.ctx, b.harness.deps).statusFor(b.ticketId)).toEqual({ changeName: CHANGE, ...zero });
    expect(b.bin.calls()).toEqual([]);
    b.harness.cleanup(); h = null;

    const c = setup(READY_CASES);
    mkdirSync(join(c.clone, 'openspec'), { recursive: true });
    process.env.AC_OPENSPEC_BIN = join(c.clone, 'no-such-openspec');
    expect(await createOpenSpecService(c.harness.ctx, c.harness.deps).statusFor(c.ticketId)).toEqual({ changeName: CHANGE, ...zero });
  });
});

describe('OpenSpecService.validateForProposed', () => {
  it('renders the plan from proposal/tasks/design when planning is complete and validation is clean', async () => {
    const { harness, ticketId, clone } = setup(READY_CASES);
    writeChange(join(clone, 'openspec', 'changes', CHANGE), {
      'proposal.md': '## Why\nUsers want dark mode.\n',
      'tasks.md': '- [x] add tokens\n- [ ] wire the toggle\n',
      'design.md': 'CSS variables per theme.\n',
    });
    const r = await createOpenSpecService(harness.ctx, harness.deps).validateForProposed(ticketId);
    expect(r.ok).toBe(true);
    const plan = (r as { plan: string }).plan;
    expect(plan).toBe([
      `# Plan for ${CHANGE}`, '', '## Proposal', '', '## Why', 'Users want dark mode.', '', '## Tasks', '',
      '- [x] add tokens', '- [ ] wire the toggle', '', '## Design', '', 'CSS variables per theme.', '',
    ].join('\n'));
  });

  it('skips artifact files that do not exist', async () => {
    const { harness, ticketId, clone } = setup(READY_CASES);
    writeChange(join(clone, 'openspec', 'changes', CHANGE), { 'proposal.md': 'only a proposal\n' });
    const r = await createOpenSpecService(harness.ctx, harness.deps).validateForProposed(ticketId);
    expect((r as { plan: string }).plan).toBe(`# Plan for ${CHANGE}\n\n## Proposal\n\nonly a proposal\n`);
  });

  it('reports validation errors and a synthetic issue when planning is incomplete', async () => {
    const { harness, ticketId, clone } = setup([
      { match: ['status', '--change'], json: { changeName: CHANGE, isPlanningComplete: false, artifacts: [{ id: 'proposal', status: 'done' }, { id: 'tasks', status: 'ready' }] } },
      { match: ['validate'], exit: 1, json: { items: [{ issues: [{ level: 'error', message: 'no spec deltas', path: 'specs/' }] }] } },
    ]);
    writeChange(join(clone, 'openspec', 'changes', CHANGE), { 'proposal.md': 'p\n' });
    const r = await createOpenSpecService(harness.ctx, harness.deps).validateForProposed(ticketId);
    expect(r.ok).toBe(false);
    expect((r as { issues: Array<{ level: string; message: string }> }).issues).toEqual([
      { level: 'error', message: `planning is not complete for ${CHANGE}: tasks still is outstanding` },
      { level: 'error', message: 'no spec deltas', path: 'specs/' },
    ]);
  });
});

describe('OpenSpecService.archiveAfterMerge', () => {
  it('skips when the change directory is not in the primary clone', async () => {
    const { harness, ticketId, clone } = setup(READY_CASES);
    mkdirSync(join(clone, 'openspec', 'changes'), { recursive: true });
    await expect(createOpenSpecService(harness.ctx, harness.deps).archiveAfterMerge(ticketId))
      .resolves.toEqual({ archivedAs: null, skipped: 'change directory not present' });
  });

  it('archives, records activity and emits an event', async () => {
    const { harness, ticketId, clone } = setup([
      ...READY_CASES,
      { match: ['archive'], json: { archive: { archivedAs: `2026-09-04-${CHANGE}`, specsUpdated: ['dark-mode'], warnings: [] } } },
    ]);
    writeChange(join(clone, 'openspec', 'changes', CHANGE), { 'proposal.md': 'p\n' });
    const r = await createOpenSpecService(harness.ctx, harness.deps).archiveAfterMerge(ticketId);
    expect(r).toEqual({ archivedAs: `2026-09-04-${CHANGE}`, skipped: null });
    const act = harness.db.get<{ action: string; details: Record<string, unknown> }>('SELECT action, details_json FROM activity WHERE entity_id = ?', [ticketId]);
    expect(act?.action).toBe('openspec.archived');
    expect(act?.details).toMatchObject({ changeName: CHANGE, specsUpdated: ['dark-mode'] });
    expect(harness.events.some((e) => e.type === 'ticket.updated')).toBe(true);
  });

  it('serialises archives per project', async () => {
    const { harness, ticketId, clone, bin } = setup([
      ...READY_CASES,
      { match: ['archive'], json: { archive: { archivedAs: `2026-09-04-${CHANGE}`, specsUpdated: [], warnings: [] } } },
    ]);
    writeChange(join(clone, 'openspec', 'changes', CHANGE), { 'proposal.md': 'p\n' });
    const svc = createOpenSpecService(harness.ctx, harness.deps);
    const results = await Promise.all([svc.archiveAfterMerge(ticketId), svc.archiveAfterMerge(ticketId), svc.archiveAfterMerge(ticketId)]);
    expect(results.every((r) => r.archivedAs !== null)).toBe(true);
    expect(bin.calls().filter((c) => c.argv[0] === 'archive')).toHaveLength(3);
  });
});

describe('OpenSpecService.version', () => {
  it('reads the pinned binary version, and null when it is absent', async () => {
    const { harness, clone } = setup([{ match: ['--version'], stdout: '1.12.0\n' }]);
    mkdirSync(clone, { recursive: true });
    const svc = createOpenSpecService(harness.ctx, harness.deps);
    expect(await svc.version(harness.projectId)).toBe('1.12.0');
    process.env.AC_OPENSPEC_BIN = join(clone, 'no-such-openspec');
    expect(await svc.version(harness.projectId)).toBeNull();
  });
});
