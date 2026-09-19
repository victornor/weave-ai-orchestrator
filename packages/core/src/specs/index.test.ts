import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { newId, nowIso } from '@weave-ai/db';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { writeFakeOpenspec, type FakeCase } from '../openspec/fakeBin.js';
import { createSpecsService, deltaKindOf, ftsQuery, parseDeltaRequirements, parseTasks, readArchivedChanges } from './index.js';

let h: TestHarness | null = null;
const previousBin = process.env.AC_OPENSPEC_BIN;
afterEach(() => {
  h?.cleanup(); h = null;
  if (previousBin === undefined) delete process.env.AC_OPENSPEC_BIN; else process.env.AC_OPENSPEC_BIN = previousBin;
});

const AUTH_SPEC = '# auth Specification\n\n## Purpose\nWho may sign in.\n\n## Requirements\n### Requirement: Password login\nThe system SHALL accept an email and password.\n';

const CASES: FakeCase[] = [
  { match: ['list', '--specs'], json: { specs: [{ id: 'auth', title: 'Auth', path: 'openspec/specs/auth/spec.md', requirementCount: 2 }] } },
  { match: ['show'], json: { id: 'auth', title: 'Auth', overview: 'Who may sign in.', requirementCount: 2, requirements: [{ name: 'Password login', text: 'The system SHALL accept an email and password.', scenarios: [{ name: 'good password' }] }, { name: 'Dark mode toggle', text: 'The UI SHALL remember the chosen theme.', scenarios: [] }] } },
  { match: ['status', '--all'], json: { changes: [{ changeName: 'tst-3-dark-mode', isPlanningComplete: false, artifacts: [{ id: 'proposal', status: 'done', requires: [] }] }] } },
];

function write(path: string, body: string): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); }

function setup(cases: FakeCase[] = CASES): { harness: TestHarness; clone: string; bin: ReturnType<typeof writeFakeOpenspec> } {
  const harness = makeHarness();
  h = harness;
  const clone = join(harness.root, 'projects', 'api');
  mkdirSync(clone, { recursive: true });
  const bin = writeFakeOpenspec(join(harness.root, 'fake-openspec'), cases);
  process.env.AC_OPENSPEC_BIN = bin.path;
  return { harness, clone, bin };
}

/** capability spec + two archived changes + one active change in a worker's worktree. */
function fixture(harness: TestHarness, clone: string): { ticketId: string } {
  write(join(clone, 'openspec', 'specs', 'auth', 'spec.md'), AUTH_SPEC);

  const a1 = join(clone, 'openspec', 'changes', 'archive', '2026-08-01-tst-1-login');
  write(join(a1, 'proposal.md'), '## Why\nPeople need to sign in.\n');
  write(join(a1, 'tasks.md'), '- [x] add the login form\n');
  write(join(a1, 'specs', 'auth', 'spec.md'), '## ADDED Requirements\n### Requirement: Password login\nThe system SHALL accept an email and password.\n');

  const a2 = join(clone, 'openspec', 'changes', 'archive', '2026-09-01-tst-2-sso');
  write(join(a2, 'proposal.md'), '## Why\nEnterprise buyers need SSO.\n');
  write(join(a2, 'design.md'), 'SAML via the identity provider.\n');
  write(join(a2, 'specs', 'auth', 'spec.md'), '## MODIFIED Requirements\n### Requirement: Password login\nNow optional when SSO is on.\n');
  write(join(a2, 'specs', 'sso', 'spec.md'), '## ADDED Requirements\n### Requirement: SAML login\nThe system SHALL accept a SAML assertion.\n');

  const ticketId = newId();
  const ts = nowIso();
  harness.db.insert('tickets', {
    id: ticketId, workspaceId: harness.workspaceId, projectId: harness.projectId, number: 3, identifier: 'TST-3', kind: 'change',
    title: 'Dark mode', status: 'in_progress', createdByKind: 'human', openspecChangeName: 'tst-3-dark-mode', createdAt: ts, updatedAt: ts,
  });
  const workerId = harness.addWorker(ticketId);
  const worktree = harness.db.get<{ worktreePath: string }>('SELECT worktree_path FROM agents WHERE id = ?', [workerId])!.worktreePath;
  const active = join(worktree, 'openspec', 'changes', 'tst-3-dark-mode');
  write(join(active, 'proposal.md'), '## Why\nUsers want dark mode at night.\n');
  write(join(active, 'tasks.md'), '- [ ] add the tokens\n');
  write(join(active, 'specs', 'theme', 'spec.md'), '## ADDED Requirements\n### Requirement: Dark mode toggle\nThe UI SHALL remember the chosen theme.\n');
  return { ticketId };
}

describe('spec index', () => {
  it('indexes capabilities, requirements, archived and active changes with their delta kinds', async () => {
    const { harness, clone } = setup();
    const { ticketId } = fixture(harness, clone);
    const svc = createSpecsService(harness.ctx, harness.deps);

    expect(await svc.index(harness.projectId)).toEqual({ capabilities: 1, changes: 3 });
    expect(harness.events.some((e) => e.type === 'spec.indexed' && e.entityId === harness.projectId)).toBe(true);

    const caps = svc.listCapabilities(harness.projectId);
    expect(caps).toHaveLength(1);
    expect(caps[0]).toMatchObject({ capability: 'auth', title: 'Auth', requirementCount: 2, lastArchivedChange: 'tst-2-sso', pendingChanges: [] });

    const cap = svc.getCapability(harness.projectId, 'auth');
    expect(cap.body).toBe(AUTH_SPEC);
    expect(cap.requirements.map((r) => r.name)).toEqual(['Password login', 'Dark mode toggle']);
    expect(cap.requirements[0]!.scenarios).toEqual([{ name: 'good password' }]);
    expect(cap.requirements.every((r) => r.delta === null)).toBe(true);   // the archived changes touching auth are history, not pending
    expect(cap.history).toEqual([
      { changeName: 'tst-2-sso', ticketId: null, ticketIdentifier: null, state: 'archived', archivedAs: '2026-09-01-tst-2-sso', archivedAt: '2026-09-01T00:00:00.000Z' },
      { changeName: 'tst-1-login', ticketId: null, ticketIdentifier: null, state: 'archived', archivedAs: '2026-08-01-tst-1-login', archivedAt: '2026-08-01T00:00:00.000Z' },
    ]);

    const archived = svc.listChanges(harness.projectId, 'archived');
    expect(archived.map((c) => c.changeName)).toEqual(['tst-2-sso', 'tst-1-login']);
    expect(archived[0]!.capabilities).toEqual([{ capability: 'auth', deltaKind: 'modified' }, { capability: 'sso', deltaKind: 'added' }]);
    expect(archived[0]).toMatchObject({ ticketIdentifier: null, archivedAs: '2026-09-01-tst-2-sso', taskProgress: { done: 0, total: 0 } });
    expect(archived[0]).not.toHaveProperty('artifacts');

    const active = svc.listChanges(harness.projectId, 'active');
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      changeName: 'tst-3-dark-mode', state: 'active', ticketId, ticketIdentifier: 'TST-3',
      capabilities: [{ capability: 'theme', deltaKind: 'added' }], taskProgress: { done: 0, total: 1 },
    });

    const change = svc.getChange(harness.projectId, 'tst-1-login');
    expect(change.archivedAs).toBe('2026-08-01-tst-1-login');
    expect(change.proposal).toContain('People need to sign in.');
    expect(change.design).toBeNull();
    expect(change.tasks).toEqual([{ text: 'add the login form', done: true }]);
    expect(change.taskProgress).toEqual({ done: 1, total: 1 });
    expect(change.deltas).toEqual([{ capability: 'auth', kind: 'added', body: expect.stringContaining('Password login') }]);
    expect(() => svc.getChange(harness.projectId, 'nope')).toThrow(/not indexed/);
  });

  it('lists and opens a nested capability with the archived changes in its history', async () => {
    const NESTED = 'conductor-chat/dispatch-labels';
    const NESTED_SPEC = '# dispatch-labels Specification\n\n## Requirements\n### Requirement: Anchored labels\nThe label SHALL stay anchored to its message.\n';
    const { harness, clone } = setup([
      { match: ['list', '--specs'], json: { specs: [{ id: NESTED, title: 'Dispatch labels', path: `openspec/specs/${NESTED}/spec.md`, requirementCount: 1 }] } },
      { match: ['show'], json: { id: NESTED, title: 'Dispatch labels', requirementCount: 1, requirements: [{ name: 'Anchored labels', text: 'The label SHALL stay anchored to its message.', scenarios: [] }] } },
      { match: ['status', '--all'], json: { changes: [] } },
    ]);
    write(join(clone, 'openspec', 'specs', 'conductor-chat', 'dispatch-labels', 'spec.md'), NESTED_SPEC);
    const archived = join(clone, 'openspec', 'changes', 'archive', '2026-09-05-tst-4-labels');
    write(join(archived, 'proposal.md'), '## Why\nLabels drift when the transcript scrolls.\n');
    write(join(archived, 'specs', 'conductor-chat', 'dispatch-labels', 'spec.md'), '## ADDED Requirements\n### Requirement: Anchored labels\nThe label SHALL stay anchored to its message.\n');

    const svc = createSpecsService(harness.ctx, harness.deps);
    expect(await svc.index(harness.projectId)).toEqual({ capabilities: 1, changes: 1 });

    expect(svc.listCapabilities(harness.projectId).map((c) => c.capability)).toEqual([NESTED]);

    const cap = svc.getCapability(harness.projectId, NESTED);
    expect(cap.capability).toBe(NESTED);
    expect(cap.body).toBe(NESTED_SPEC);
    expect(cap.requirements.map((r) => r.name)).toEqual(['Anchored labels']);
    expect(cap.history).toEqual([
      { changeName: 'tst-4-labels', ticketId: null, ticketIdentifier: null, state: 'archived', archivedAs: '2026-09-05-tst-4-labels', archivedAt: '2026-09-05T00:00:00.000Z' },
    ]);
  });

  it('is idempotent and keeps capability ids stable across reindexing', async () => {
    const { harness, clone } = setup();
    fixture(harness, clone);
    const svc = createSpecsService(harness.ctx, harness.deps);
    await svc.index(harness.projectId);
    const first = svc.listCapabilities(harness.projectId)[0]!;
    await svc.index(harness.projectId);
    const second = svc.listCapabilities(harness.projectId);
    expect(second).toHaveLength(1);
    expect(second[0]!.id).toBe(first.id);
    expect(harness.db.get<{ n: number }>('SELECT COUNT(*) n FROM spec_requirements')!.n).toBe(2);
    expect(harness.db.get<{ n: number }>('SELECT COUNT(*) n FROM spec_changes')!.n).toBe(3);
  });

  it('marks the requirements an active change adds, modifies or removes, and leaves the rest alone', async () => {
    const { harness, clone } = setup();
    fixture(harness, clone);
    const worktree = harness.db.get<{ worktreePath: string }>("SELECT worktree_path FROM agents WHERE kind = 'worker'")!.worktreePath;
    write(join(worktree, 'openspec', 'changes', 'tst-3-dark-mode', 'specs', 'auth', 'spec.md'), [
      '## Purpose', 'Signing in, in the dark.', '',
      '## MODIFIED Requirements', '',
      '### Requirement: Password login', 'The system SHALL accept an email and password, or a magic link.', '',
      '## ADDED Requirements', '',
      '### Requirement: Magic link login', 'The system SHALL accept a signed link sent by email.', '',
      '#### Scenario: A fresh link', '- **WHEN** the link is under an hour old', '- **THEN** the session is created', '',
      '## REMOVED Requirements', '',
      '### Requirement: Dark mode toggle', '',
    ].join('\n'));

    const svc = createSpecsService(harness.ctx, harness.deps);
    await svc.index(harness.projectId);

    const cap = svc.getCapability(harness.projectId, 'auth');
    expect(cap.requirements.map((r) => [r.name, r.delta?.kind ?? null])).toEqual([
      ['Password login', 'MODIFIED'],
      ['Dark mode toggle', 'REMOVED'],
      ['Magic link login', 'ADDED'],
    ]);
    expect(cap.requirements[0]!.delta).toEqual({ kind: 'MODIFIED', changeName: 'tst-3-dark-mode', ticketIdentifier: 'TST-3', state: 'pending' });
    // the added requirement is not on the default branch yet, so its wording comes from the delta spec
    expect(cap.requirements[2]).toMatchObject({
      text: 'The system SHALL accept a signed link sent by email.',
      scenarios: [{ text: 'A fresh link', steps: [{ word: 'WHEN', text: 'the link is under an hour old' }, { word: 'THEN', text: 'the session is created' }] }],
    });
    expect(cap.pending).toEqual([{ changeName: 'tst-3-dark-mode', ticketId: expect.any(String), ticketIdentifier: 'TST-3', deltaKind: 'modified' }]);
  });

  it('searches capabilities, requirements and change artifacts without touching knowledge rows', async () => {
    const { harness, clone } = setup();
    fixture(harness, clone);
    harness.db.insert('knowledge_search', { kind: 'knowledge', projectId: harness.projectId, ref: 'kb:project', title: 'Project KB', body: 'dark mode is owned by the frontend role' });
    const svc = createSpecsService(harness.ctx, harness.deps);
    await svc.index(harness.projectId);

    const hits = svc.search('dark mode', harness.projectId);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((r) => r.kind === 'spec' || r.kind === 'change')).toBe(true);
    expect(hits.some((r) => r.ref === 'change:tst-3-dark-mode')).toBe(true);
    expect(hits.some((r) => r.ref === 'spec:auth#Dark mode toggle')).toBe(true);
    expect(hits.every((r) => r.snippet.length > 0)).toBe(true);

    expect(harness.db.get<{ n: number }>("SELECT COUNT(*) n FROM knowledge_search WHERE kind = 'knowledge'")!.n).toBe(1);
    expect(svc.search('saml', harness.projectId).map((r) => r.ref)).toEqual(['change:tst-2-sso']);
    expect(svc.search('   ', harness.projectId)).toEqual([]);
    expect(svc.search('NEAR("a" "b") OR *', harness.projectId)).toEqual([]);
  });

  it('builds a capability/change/ticket graph', async () => {
    const { harness, clone } = setup();
    const { ticketId } = fixture(harness, clone);
    const svc = createSpecsService(harness.ctx, harness.deps);
    await svc.index(harness.projectId);

    const g = svc.graph(harness.projectId);
    expect(g.nodes.filter((n) => n.kind === 'capability').map((n) => n.id)).toEqual(['capability:auth']);
    expect(g.nodes.filter((n) => n.kind === 'change').map((n) => n.label).sort()).toEqual(['tst-1-login', 'tst-2-sso', 'tst-3-dark-mode']);
    expect(g.nodes.filter((n) => n.kind === 'ticket')).toEqual([{ id: `ticket:${ticketId}`, kind: 'ticket', label: 'TST-3 Dark mode', status: 'in_progress' }]);
    expect(g.edges).toContainEqual({ from: 'change:tst-2-sso', to: 'capability:auth', kind: 'touches' });
    expect(g.edges).toContainEqual({ from: 'change:tst-3-dark-mode', to: `ticket:${ticketId}`, kind: 'belongs_to' });
  });

  it('indexes nothing when the binary is missing or openspec/ does not exist', async () => {
    const a = setup();
    fixture(a.harness, a.clone);
    process.env.AC_OPENSPEC_BIN = join(a.clone, 'no-such-openspec');
    await expect(createSpecsService(a.harness.ctx, a.harness.deps).index(a.harness.projectId)).resolves.toEqual({ capabilities: 0, changes: 0 });
    expect(a.harness.db.get<{ n: number }>('SELECT COUNT(*) n FROM spec_changes')!.n).toBe(0);
    expect(a.harness.db.get<{ n: number }>('SELECT COUNT(*) n FROM knowledge_search')!.n).toBe(0);
    a.harness.cleanup(); h = null;

    const b = setup();   // clone exists but has no openspec/ tree
    await expect(createSpecsService(b.harness.ctx, b.harness.deps).index(b.harness.projectId)).resolves.toEqual({ capabilities: 0, changes: 0 });
    expect(b.bin.calls()).toEqual([]);
    expect(b.harness.db.get<{ n: number }>('SELECT COUNT(*) n FROM spec_capabilities')!.n).toBe(0);
  });

  it('treats a project whose OpenSpec mode is off as nothing to index or read (VS-578)', async () => {
    const a = setup();
    fixture(a.harness, a.clone);
    const svc = createSpecsService(a.harness.ctx, a.harness.deps);
    await svc.index(a.harness.projectId);
    expect(a.harness.db.get<{ n: number }>('SELECT COUNT(*) n FROM spec_capabilities')!.n).toBeGreaterThan(0);

    a.harness.db.update('projects', a.harness.projectId, { openspecEnabled: 0 });
    await expect(svc.index(a.harness.projectId)).resolves.toEqual({ capabilities: 0, changes: 0 });
    expect(a.harness.db.get<{ n: number }>('SELECT COUNT(*) n FROM spec_capabilities')!.n).toBe(0);
    expect(a.harness.db.get<{ n: number }>('SELECT COUNT(*) n FROM spec_changes')!.n).toBe(0);

    expect(() => svc.listCapabilities(a.harness.projectId)).toThrow(expect.objectContaining({ code: 'openspec_disabled' }));
    expect(() => svc.getCapability(a.harness.projectId, 'auth')).toThrow(expect.objectContaining({ code: 'openspec_disabled' }));
    expect(() => svc.search('login', a.harness.projectId)).toThrow(expect.objectContaining({ code: 'openspec_disabled' }));
  });

  it('drops capabilities that disappeared from the project', async () => {
    const { harness, clone } = setup([
      { match: ['list', '--specs'], json: { specs: [] } },
      { match: ['status', '--all'], json: { changes: [] } },
    ]);
    fixture(harness, clone);
    harness.db.insert('spec_capabilities', { id: 'cap-old', projectId: harness.projectId, capability: 'legacy', title: 'Legacy', requirementCount: 1, bodyHash: 'x', body: 'old', path: 'openspec/specs/legacy/spec.md', updatedAt: nowIso() });
    harness.db.insert('spec_requirements', { id: 'req-old', capabilityId: 'cap-old', name: 'R', text: 't', scenariosJson: [] });
    await createSpecsService(harness.ctx, harness.deps).index(harness.projectId);
    expect(harness.db.get<{ n: number }>('SELECT COUNT(*) n FROM spec_capabilities')!.n).toBe(0);
    expect(harness.db.get<{ n: number }>('SELECT COUNT(*) n FROM spec_requirements')!.n).toBe(0);
  });
});

describe('spec parsing helpers', () => {
  it('reads the delta kind from the requirements header, first one wins', () => {
    expect(deltaKindOf('## ADDED Requirements\n### Requirement: X\n')).toBe('added');
    expect(deltaKindOf('## MODIFIED Requirements\n')).toBe('modified');
    expect(deltaKindOf('## REMOVED Requirements\n')).toBe('removed');
    expect(deltaKindOf('## RENAMED Requirements\n')).toBe('renamed');
    expect(deltaKindOf('# Delta\n\n## REMOVED Requirements\n\n## ADDED Requirements\n')).toBe('removed');
    expect(deltaKindOf('nothing recognisable here')).toBe('modified');
  });

  it('reads every requirement of a delta spec under the section it belongs to', () => {
    const body = [
      '## Purpose', 'Prose that names no requirement.', '',
      '## ADDED Requirements', '### Requirement: New feature', 'The system SHALL do something new.', '',
      '#### Scenario: Basic case', '- **WHEN** the user does X', '- **THEN** the system does Y', '',
      '## MODIFIED Requirements', '### Requirement: Existing feature', 'Now also handling A.', '',
      '## REMOVED Requirements', '### Requirement: Deprecated feature', '',
      '## RENAMED Requirements', '', '- FROM: `### Requirement: Old name`', '- TO: `### Requirement: New name`', '',
    ].join('\n');
    expect(parseDeltaRequirements(body).map((r) => [r.kind, r.name])).toEqual([
      ['added', 'New feature'],
      ['modified', 'Existing feature'],
      ['removed', 'Deprecated feature'],
      ['renamed', 'Old name'],
      ['renamed', 'New name'],
    ]);
    const added = parseDeltaRequirements(body)[0]!;
    expect(added.text).toBe('The system SHALL do something new.');
    expect(added.scenarios).toEqual([{ text: 'Basic case', steps: [{ word: 'WHEN', text: 'the user does X' }, { word: 'THEN', text: 'the system does Y' }] }]);
    expect(parseDeltaRequirements('### Requirement: Outside every section\nnot under a delta header\n')).toEqual([]);
    expect(parseDeltaRequirements('')).toEqual([]);
  });

  it('reads the checklist of a tasks.md and ignores its prose', () => {
    expect(parseTasks('## 1. Tokens\n\n- [x] add the tokens\n- [ ] wire the toggle\n  - [X] nested, done\n\nSome prose.\n')).toEqual([
      { text: 'add the tokens', done: true },
      { text: 'wire the toggle', done: false },
      { text: 'nested, done', done: true },
    ]);
    expect(parseTasks(null)).toEqual([]);
  });

  it('splits archived directory names into a date and a change name', () => {
    const { harness, clone } = setup();
    fixture(harness, clone);
    const archived = readArchivedChanges(clone);
    expect(archived.map((c) => c.changeName)).toEqual(['tst-1-login', 'tst-2-sso']);
    expect(archived[1]!.archivedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(Object.keys(archived[1]!.artifacts.specs).sort()).toEqual(['auth', 'sso']);
  });

  it('quotes every term of a user query for FTS5', () => {
    expect(ftsQuery('dark-mode toggle')).toBe('"dark" "mode" "toggle"');
    expect(ftsQuery('NEAR("a" "b")')).toBe('"NEAR" "a" "b"');
    expect(ftsQuery('  ')).toBe('');
  });
});
