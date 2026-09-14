import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId, nowIso } from '@weave-ai/db';
import type { ForgeAdapter, ForgePullRequest } from '@weave-ai/plugin-sdk';
import type { ProjectsService, TicketsService } from '../api.js';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { git } from '../util/git.js';
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

/** A main spec with the placeholder Purpose `openspec archive` writes for a new capability (VS-362). */
function placeholderSpec(capability: string, changeName: string): string {
  return `# ${capability} Specification\n\n## Purpose\nTBD - created by archiving change ${changeName}. Update Purpose after archive.\n\n## Requirements\n\n### Requirement: A gadget exists\nThe system SHALL have a gadget.\n\n#### Scenario: One gadget\n- **WHEN** asked\n- **THEN** a gadget is returned\n`;
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

  it('returns a zeroed status when the ticket has no change and when openspec/ is absent', async () => {
    const zero = { planningComplete: false, artifacts: [], tasks: null, applyState: null, validation: null, archived: false };

    const a = setup(READY_CASES, { changeName: null });
    expect(await createOpenSpecService(a.harness.ctx, a.harness.deps).statusFor(a.ticketId)).toEqual({ changeName: '', ...zero });
    a.harness.cleanup(); h = null;

    const b = setup(READY_CASES);   // no openspec/ directory in the clone
    expect(await createOpenSpecService(b.harness.ctx, b.harness.deps).statusFor(b.ticketId)).toEqual({ changeName: CHANGE, ...zero });
    expect(b.bin.calls()).toEqual([]);
  });

  it('raises the host-tool error, not an empty plan, when the change exists but the binary cannot run (VS-318)', async () => {
    const c = setup(READY_CASES);
    mkdirSync(join(c.clone, 'openspec'), { recursive: true });
    process.env.AC_OPENSPEC_BIN = join(c.clone, 'no-such-openspec');
    await expect(createOpenSpecService(c.harness.ctx, c.harness.deps).statusFor(c.ticketId))
      .rejects.toMatchObject({ code: 'openspec_not_found' });
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

  it('names the daemon PATH when the binary cannot run, rather than saying "not installed" (VS-318)', async () => {
    const { harness, ticketId, clone } = setup(READY_CASES);
    writeChange(join(clone, 'openspec', 'changes', CHANGE), { 'proposal.md': 'p\n' });
    process.env.AC_OPENSPEC_BIN = join(clone, 'no-such-openspec');
    const r = await createOpenSpecService(harness.ctx, harness.deps).validateForProposed(ticketId);
    expect(r.ok).toBe(false);
    const issues = (r as { issues: Array<{ level: string; message: string }> }).issues;
    expect(issues[0]?.message).toContain("not found on the daemon's PATH");
    expect(issues[0]?.message).not.toContain('not installed');
  });

  // VS-293: `openspec validate --strict` validates a delta's own shape, not what merging it would
  // leave behind, so a change that empties a capability without declaring `retire_capabilities`
  // reports clean here (READY_CASES's fake `validate` case) and only fails once `openspec archive`
  // runs, after the PR has merged and closed. These fixtures reuse VS-285's own shape: a delta
  // that `## REMOVED Requirements`-lists every requirement its capability's main spec has.
  const ALL_REMOVED_DELTA = '## REMOVED Requirements\n\n### Requirement: Only one\n\n**Reason**: retired.\n\n**Migration**: none.\n';
  const ONE_REQUIREMENT_MAIN = '# a-capability Specification\n\n## Purpose\n\nOne requirement.\n\n## Requirements\n\n### Requirement: Only one\nThe system SHALL do the one thing.\n\n#### Scenario: It happens\n- **WHEN** asked\n- **THEN** it does the thing\n';

  it('rejects a change that would empty a capability without retire_capabilities set, even though validate itself is clean', async () => {
    const { harness, ticketId, clone } = setup(READY_CASES);
    writeChange(join(clone, 'openspec', 'changes', CHANGE), { 'proposal.md': 'p\n' });
    writeChange(join(clone, 'openspec', 'changes', CHANGE, 'specs', 'a-capability'), { 'spec.md': ALL_REMOVED_DELTA });
    writeChange(join(clone, 'openspec', 'specs', 'a-capability'), { 'spec.md': ONE_REQUIREMENT_MAIN });

    const r = await createOpenSpecService(harness.ctx, harness.deps).validateForProposed(ticketId);
    expect(r.ok).toBe(false);
    const issues = (r as { issues: Array<{ level: string; message: string }> }).issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("'a-capability'");
    expect(issues[0]?.message).toContain('retire_capabilities: true');
  });

  it('accepts the same change once its .openspec.yaml declares retire_capabilities: true', async () => {
    const { harness, ticketId, clone } = setup(READY_CASES);
    writeChange(join(clone, 'openspec', 'changes', CHANGE), {
      'proposal.md': 'p\n',
      '.openspec.yaml': 'schema: spec-driven\nretire_capabilities: true\n',
    });
    writeChange(join(clone, 'openspec', 'changes', CHANGE, 'specs', 'a-capability'), { 'spec.md': ALL_REMOVED_DELTA });
    writeChange(join(clone, 'openspec', 'specs', 'a-capability'), { 'spec.md': ONE_REQUIREMENT_MAIN });

    const r = await createOpenSpecService(harness.ctx, harness.deps).validateForProposed(ticketId);
    expect(r.ok).toBe(true);
  });
});

describe('OpenSpecService.archiveAfterMerge', () => {
  it('skips when the change directory is not in the primary clone', async () => {
    const { harness, ticketId, clone } = setup(READY_CASES);
    mkdirSync(join(clone, 'openspec', 'changes'), { recursive: true });
    await expect(createOpenSpecService(harness.ctx, harness.deps).archiveAfterMerge(ticketId))
      .resolves.toEqual({ archivedAs: null, skipped: 'change directory not present' });
  });

  // VS-327: archiving moved into the merge itself for `pr`-delivery projects (see
  // merge-done-lands.test.ts and archive-before-merge.test.ts). What's left of this direct,
  // fake-bin, no-real-git path is exactly `local-branch` delivery's backfill, which still commits
  // in place with no push and no forge involved — unchanged behavior, just narrowed scope.
  it('archives, records activity and emits an event (local-branch delivery backfill)', async () => {
    const { harness, ticketId, clone } = setup([
      ...READY_CASES,
      { match: ['archive'], json: { archive: { archivedAs: `2026-09-04-${CHANGE}`, specsUpdated: ['dark-mode'], warnings: [] } } },
    ], { policies: { deliveryMode: 'local-branch' } });
    writeChange(join(clone, 'openspec', 'changes', CHANGE), { 'proposal.md': 'p\n' });
    const r = await createOpenSpecService(harness.ctx, harness.deps).archiveAfterMerge(ticketId);
    expect(r).toEqual({ archivedAs: `2026-09-04-${CHANGE}`, skipped: null });
    const act = harness.db.get<{ action: string; details: Record<string, unknown> }>('SELECT action, details_json FROM activity WHERE entity_id = ?', [ticketId]);
    expect(act?.action).toBe('openspec.archived');
    expect(act?.details).toMatchObject({ changeName: CHANGE, specsUpdated: ['dark-mode'] });
    expect(harness.events.some((e) => e.type === 'ticket.updated')).toBe(true);
  });

  it('serialises archives per project (local-branch delivery backfill)', async () => {
    const { harness, ticketId, clone, bin } = setup([
      ...READY_CASES,
      { match: ['archive'], json: { archive: { archivedAs: `2026-09-04-${CHANGE}`, specsUpdated: [], warnings: [] } } },
    ], { policies: { deliveryMode: 'local-branch' } });
    writeChange(join(clone, 'openspec', 'changes', CHANGE), { 'proposal.md': 'p\n' });
    const svc = createOpenSpecService(harness.ctx, harness.deps);
    const results = await Promise.all([svc.archiveAfterMerge(ticketId), svc.archiveAfterMerge(ticketId), svc.archiveAfterMerge(ticketId)]);
    expect(results.every((r) => r.archivedAs !== null)).toBe(true);
    expect(bin.calls().filter((c) => c.argv[0] === 'archive')).toHaveLength(3);
  });

  it('fills a capability the backfill archive created from the proposal Why (VS-362)', async () => {
    const why = 'Gadgets exist so callers can rely on a gadget being present and shaped the way this capability guarantees.';
    const { harness, ticketId, clone } = setup([
      ...READY_CASES,
      { match: ['archive'], json: { archive: { archivedAs: `2026-09-04-${CHANGE}`, specsUpdated: ['gadgets'], warnings: [] } } },
    ], { policies: { deliveryMode: 'local-branch' } });
    writeChange(join(clone, 'openspec', 'changes', CHANGE), { 'proposal.md': 'p\n' });
    writeChange(join(clone, 'openspec', 'specs', 'gadgets'), { 'spec.md': placeholderSpec('gadgets', CHANGE) });
    writeChange(join(clone, 'openspec', 'changes', 'archive', `2026-09-04-${CHANGE}`), { 'proposal.md': `## Why\n\n${why}\n\n## What Changes\n- x\n` });

    const r = await createOpenSpecService(harness.ctx, harness.deps).archiveAfterMerge(ticketId);
    expect(r).toEqual({ archivedAs: `2026-09-04-${CHANGE}`, skipped: null });
    const spec = readFileSync(join(clone, 'openspec', 'specs', 'gadgets', 'spec.md'), 'utf8');
    expect(spec).toContain(why);
    expect(spec).not.toContain('Update Purpose after archive');
  });

  it('fails the backfill instead of committing a placeholder when the proposal has no Why (VS-362)', async () => {
    const { harness, ticketId, clone } = setup([
      ...READY_CASES,
      { match: ['archive'], json: { archive: { archivedAs: `2026-09-04-${CHANGE}`, specsUpdated: ['gadgets'], warnings: [] } } },
    ], { policies: { deliveryMode: 'local-branch' } });
    writeChange(join(clone, 'openspec', 'changes', CHANGE), { 'proposal.md': 'p\n' });
    writeChange(join(clone, 'openspec', 'specs', 'gadgets'), { 'spec.md': placeholderSpec('gadgets', CHANGE) });
    // No archived proposal with a "Why" exists.
    await expect(createOpenSpecService(harness.ctx, harness.deps).archiveAfterMerge(ticketId))
      .rejects.toMatchObject({ code: 'openspec_archive_blocked' });
    expect(readFileSync(join(clone, 'openspec', 'specs', 'gadgets', 'spec.md'), 'utf8')).toContain('Update Purpose after archive');
  });
});

describe('OpenSpecService.archiveAfterMerge (pr delivery backfill, VS-327)', () => {
  async function realGitProject(harness: TestHarness, clone: string): Promise<{ origin: string }> {
    const origin = join(harness.root, 'origin-api');
    await git(['init', '-b', 'main', origin], harness.root);
    await git(['config', 'user.email', 'test@example.com'], origin);
    await git(['config', 'user.name', 'Test'], origin);
    writeFileSync(join(origin, 'README.md'), '# api\n');
    await git(['add', '.'], origin);
    await git(['commit', '-m', 'init'], origin);
    await git(['clone', origin, clone], harness.root);
    await git(['config', 'user.email', 'test@example.com'], clone);
    await git(['config', 'user.name', 'Test'], clone);
    return { origin };
  }

  it('opens a pull request carrying the archive instead of pushing to the landing branch', async () => {
    const { harness, ticketId, clone } = setup([
      ...READY_CASES,
      { match: ['archive'], json: { archive: { archivedAs: `2026-09-04-${CHANGE}`, specsUpdated: ['dark-mode'], warnings: [] } } },
    ], { policies: { deliveryMode: 'pr' } });
    const { origin } = await realGitProject(harness, clone);
    writeChange(join(clone, 'openspec', 'changes', CHANGE), { 'proposal.md': 'p\n' });
    await git(['add', '.'], clone);
    await git(['commit', '-m', 'chore: leave an unarchived change behind'], clone);

    const createPullRequestCalls: Array<{ branch: string; base: string; title: string }> = [];
    harness.ctx.registries.forges.set('github', {
      id: 'github',
      detect: async () => true,
      prState: async () => ({ state: 'open' as const, ciState: 'none' as const }),
      mergePr: async () => ({}),
      createPullRequest: async (_cwd: string, opts: { branch: string; base: string; title: string }) => {
        createPullRequestCalls.push(opts);
        return { url: 'https://example.com/pr/99', number: 99 };
      },
    } satisfies ForgeAdapter);

    const r = await createOpenSpecService(harness.ctx, harness.deps).archiveAfterMerge(ticketId);
    // Not `archivedAs` — the spec is not on the landing branch until the backfill PR merges.
    expect(r).toMatchObject({ archivedAs: null, skipped: null, pendingPrUrl: 'https://example.com/pr/99' });
    expect(createPullRequestCalls).toEqual([expect.objectContaining({ branch: `ac/archive-${CHANGE}`, base: 'main' })]);
    // The landing branch itself never gained a direct commit — only the new branch did.
    const mainLog = await git(['log', '--oneline', 'main'], origin);
    expect(mainLog.stdout.trim().split('\n')).toHaveLength(1);
    const remoteBranches = await git(['branch'], origin);
    expect(remoteBranches.stdout).toMatch(new RegExp(`ac/archive-${CHANGE}`));
  });

  it('recognises an open backfill pull request on the pushed branch and opens nothing (VS-340)', async () => {
    const { harness, ticketId, clone } = setup([
      ...READY_CASES,
      { match: ['archive'], json: { archive: { archivedAs: `2026-09-04-${CHANGE}`, specsUpdated: [], warnings: [] } } },
    ], { policies: { deliveryMode: 'pr' } });
    const { origin } = await realGitProject(harness, clone);
    writeChange(join(clone, 'openspec', 'changes', CHANGE), { 'proposal.md': 'p\n' });
    await git(['add', '.'], clone);
    await git(['commit', '-m', 'chore: leave an unarchived change behind'], clone);
    // A previous sweep already pushed the backfill branch (and, on the forge, its PR).
    await git(['checkout', '-b', `ac/archive-${CHANGE}`], origin);
    await git(['checkout', 'main'], origin);

    const createPullRequest = vi.fn(async () => ({ url: 'https://example.com/pr/99', number: 99 }));
    harness.ctx.registries.forges.set('github', {
      id: 'github', detect: async () => true, prState: async () => ({ state: 'open' as const, ciState: 'none' as const }), mergePr: async () => ({}),
      pullRequestForBranch: vi.fn(async () => ({ url: 'https://example.com/pr/99', number: 99 })),
      createPullRequest,
    } satisfies ForgeAdapter);

    const r = await createOpenSpecService(harness.ctx, harness.deps).archiveAfterMerge(ticketId);
    expect(r).toMatchObject({ archivedAs: null, skipped: null, pendingPrUrl: 'https://example.com/pr/99' });
    expect(createPullRequest).not.toHaveBeenCalled();
    const act = harness.db.get<{ action: string; details: Record<string, unknown> }>('SELECT action, details_json FROM activity WHERE entity_id = ?', [ticketId]);
    expect(act?.action).toBe('openspec.archive_pr_opened');
    expect(act?.details).toMatchObject({ changeName: CHANGE, pendingPrUrl: 'https://example.com/pr/99' });
    // No second archive was attempted: the branch already carries it.
    expect(harness.events.some((e) => e.type === 'ticket.updated')).toBe(true);
  });

  it('opens the pull request from a pushed branch that has no open one yet (VS-340 retry converges)', async () => {
    const { harness, ticketId, clone, bin } = setup([
      ...READY_CASES,
      { match: ['archive'], json: { archive: { archivedAs: `2026-09-04-${CHANGE}`, specsUpdated: [], warnings: [] } } },
    ], { policies: { deliveryMode: 'pr' } });
    const { origin } = await realGitProject(harness, clone);
    writeChange(join(clone, 'openspec', 'changes', CHANGE), { 'proposal.md': 'p\n' });
    await git(['add', '.'], clone);
    await git(['commit', '-m', 'chore: leave an unarchived change behind'], clone);
    // The earlier sweep pushed the branch and then failed before opening a PR.
    await git(['checkout', '-b', `ac/archive-${CHANGE}`], origin);
    await git(['checkout', 'main'], origin);

    const createPullRequest = vi.fn(async () => ({ url: 'https://example.com/pr/100', number: 100 }));
    harness.ctx.registries.forges.set('github', {
      id: 'github', detect: async () => true, prState: async () => ({ state: 'open' as const, ciState: 'none' as const }), mergePr: async () => ({}),
      pullRequestForBranch: vi.fn(async () => null),
      createPullRequest,
    } satisfies ForgeAdapter);

    const r = await createOpenSpecService(harness.ctx, harness.deps).archiveAfterMerge(ticketId);
    expect(r).toMatchObject({ archivedAs: null, skipped: null, pendingPrUrl: 'https://example.com/pr/100' });
    expect(createPullRequest).toHaveBeenCalledWith(clone, expect.objectContaining({ branch: `ac/archive-${CHANGE}`, base: 'main' }));
    // The archive was not re-run or re-pushed — the existing branch was reused.
    expect(bin.calls().filter((c) => c.argv[0] === 'archive')).toHaveLength(0);
  });

  it('propagates a real archive failure rather than reporting it as a missing binary (VS-327 review, PR #272)', async () => {
    const { harness, ticketId, clone } = setup([
      ...READY_CASES,
      { match: ['archive'], exit: 1, json: { status: [{ severity: 'error', code: 'archive_spec_validation_failed', message: 'boom' }] } },
    ], { policies: { deliveryMode: 'pr' } });
    await realGitProject(harness, clone);
    writeChange(join(clone, 'openspec', 'changes', CHANGE), { 'proposal.md': 'p\n' });
    await git(['add', '.'], clone);
    await git(['commit', '-m', 'chore: leave an unarchived change behind'], clone);
    harness.ctx.registries.forges.set('github', {
      id: 'github', detect: async () => true, prState: async () => ({ state: 'open' as const, ciState: 'none' as const }), mergePr: async () => ({}),
      createPullRequest: async () => ({ url: 'https://example.com/pr/99', number: 99 }),
    } satisfies ForgeAdapter);

    await expect(createOpenSpecService(harness.ctx, harness.deps).archiveAfterMerge(ticketId))
      .rejects.toMatchObject({ code: 'openspec_archive_blocked' });
  });

  it('reports a genuinely missing binary as skipped, not thrown (VS-327 review, PR #272)', async () => {
    const { harness, ticketId, clone } = setup([...READY_CASES], { policies: { deliveryMode: 'pr' } });
    await realGitProject(harness, clone);
    writeChange(join(clone, 'openspec', 'changes', CHANGE), { 'proposal.md': 'p\n' });
    await git(['add', '.'], clone);
    await git(['commit', '-m', 'chore: leave an unarchived change behind'], clone);
    process.env.AC_OPENSPEC_BIN = join(clone, 'no-such-openspec');

    await expect(createOpenSpecService(harness.ctx, harness.deps).archiveAfterMerge(ticketId))
      .resolves.toEqual({ archivedAs: null, skipped: 'the openspec binary was not found on the daemon\'s PATH' });
  });

  it('surfaces a failure to open the backfill pull request, never as a silent info log (acceptance #4)', async () => {
    const { harness, ticketId, clone } = setup([
      ...READY_CASES,
      { match: ['archive'], json: { archive: { archivedAs: `2026-09-04-${CHANGE}`, specsUpdated: [], warnings: [] } } },
    ], { policies: { deliveryMode: 'pr' } });
    await realGitProject(harness, clone);
    writeChange(join(clone, 'openspec', 'changes', CHANGE), { 'proposal.md': 'p\n' });
    await git(['add', '.'], clone);
    await git(['commit', '-m', 'chore: leave an unarchived change behind'], clone);

    harness.ctx.registries.forges.set('github', {
      id: 'github',
      detect: async () => true,
      prState: async () => ({ state: 'open' as const, ciState: 'none' as const }),
      mergePr: async () => ({}),
      createPullRequest: async () => { throw new Error('forge rejected the pull request'); },
    } satisfies ForgeAdapter);

    await expect(createOpenSpecService(harness.ctx, harness.deps).archiveAfterMerge(ticketId)).rejects.toThrow();
  });

  it('reports failure rather than pushing when no forge can open a pull request', async () => {
    const { harness, ticketId, clone } = setup([
      ...READY_CASES,
      { match: ['archive'], json: { archive: { archivedAs: `2026-09-04-${CHANGE}`, specsUpdated: [], warnings: [] } } },
    ], { policies: { deliveryMode: 'pr' } });
    const { origin } = await realGitProject(harness, clone);
    writeChange(join(clone, 'openspec', 'changes', CHANGE), { 'proposal.md': 'p\n' });
    await git(['add', '.'], clone);
    await git(['commit', '-m', 'chore: leave an unarchived change behind'], clone);
    // No forge registered at all.

    await expect(createOpenSpecService(harness.ctx, harness.deps).archiveAfterMerge(ticketId)).rejects.toThrow();
    const mainLog = await git(['log', '--oneline', 'main'], origin);
    expect(mainLog.stdout.trim().split('\n')).toHaveLength(1);
  });

  it('fills a capability the backfill archive created before opening the pull request (VS-362)', async () => {
    const why = 'Gadgets exist so callers can rely on a gadget being present and shaped the way this capability guarantees.';
    const { harness, ticketId, clone } = setup([
      ...READY_CASES,
      { match: ['archive'], json: { archive: { archivedAs: `2026-09-04-${CHANGE}`, specsUpdated: ['gadgets'], warnings: [] } } },
    ], { policies: { deliveryMode: 'pr' } });
    const { origin } = await realGitProject(harness, clone);
    writeChange(join(clone, 'openspec', 'changes', CHANGE), { 'proposal.md': 'p\n' });
    writeChange(join(clone, 'openspec', 'specs', 'gadgets'), { 'spec.md': placeholderSpec('gadgets', CHANGE) });
    writeChange(join(clone, 'openspec', 'changes', 'archive', `2026-09-04-${CHANGE}`), { 'proposal.md': `## Why\n\n${why}\n\n## What Changes\n- x\n` });
    await git(['add', '.'], clone);
    await git(['commit', '-m', 'chore: leave an unarchived change behind'], clone);
    harness.ctx.registries.forges.set('github', {
      id: 'github', detect: async () => true, prState: async () => ({ state: 'open' as const, ciState: 'none' as const }), mergePr: async () => ({}),
      createPullRequest: async () => ({ url: 'https://example.com/pr/99', number: 99 }),
    } satisfies ForgeAdapter);

    const r = await createOpenSpecService(harness.ctx, harness.deps).archiveAfterMerge(ticketId);
    expect(r).toMatchObject({ archivedAs: null, skipped: null, pendingPrUrl: 'https://example.com/pr/99' });
    // The pushed backfill branch carries the filled Purpose, not the placeholder.
    const pushed = (await git(['show', `refs/heads/ac/archive-${CHANGE}:openspec/specs/gadgets/spec.md`], origin)).stdout;
    expect(pushed).toContain(why);
    expect(pushed).not.toContain('Update Purpose after archive');
  });

  it('records the pending pull request on the finished ticket delivery (VS-389)', async () => {
    const { harness, ticketId, clone } = setup([
      ...READY_CASES,
      { match: ['archive'], json: { archive: { archivedAs: `2026-09-04-${CHANGE}`, specsUpdated: [], warnings: [] } } },
    ], { policies: { deliveryMode: 'pr' } });
    await realGitProject(harness, clone);
    writeChange(join(clone, 'openspec', 'changes', CHANGE), { 'proposal.md': 'p\n' });
    await git(['add', '.'], clone);
    await git(['commit', '-m', 'chore: leave an unarchived change behind'], clone);
    harness.ctx.registries.forges.set('github', {
      id: 'github', detect: async () => true, prState: async () => ({ state: 'open' as const, ciState: 'none' as const }), mergePr: async () => ({}),
      createPullRequest: async () => ({ url: 'https://example.com/pr/99', number: 99 }),
    } satisfies ForgeAdapter);

    await createOpenSpecService(harness.ctx, harness.deps).archiveAfterMerge(ticketId);
    const row = harness.db.get<{ delivery: Record<string, unknown> | null }>('SELECT delivery_json FROM tickets WHERE id = ?', [ticketId]);
    expect(row?.delivery?.['openspecArchive']).toMatchObject({ changeName: CHANGE, state: 'pending', pendingPrUrl: 'https://example.com/pr/99' });
  });

  it('records a closed-unmerged pull request and opens a fresh one (VS-389)', async () => {
    const { harness, ticketId, clone } = setup([
      ...READY_CASES,
      { match: ['archive'], json: { archive: { archivedAs: `2026-09-04-${CHANGE}`, specsUpdated: [], warnings: [] } } },
    ], { policies: { deliveryMode: 'pr' } });
    const { origin } = await realGitProject(harness, clone);
    writeChange(join(clone, 'openspec', 'changes', CHANGE), { 'proposal.md': 'p\n' });
    await git(['add', '.'], clone);
    await git(['commit', '-m', 'chore: leave an unarchived change behind'], clone);
    await git(['checkout', '-b', `ac/archive-${CHANGE}`], origin);
    await git(['checkout', 'main'], origin);

    const createPullRequest = vi.fn(async () => ({ url: 'https://example.com/pr/200', number: 200 }));
    harness.ctx.registries.forges.set('github', {
      id: 'github', detect: async () => true, prState: async () => ({ state: 'open' as const, ciState: 'none' as const }), mergePr: async () => ({}),
      pullRequestForBranch: vi.fn(async () => null),
      listPullRequests: vi.fn(async () => [{ headRefName: `ac/archive-${CHANGE}`, state: 'closed' as const, url: 'https://example.com/pr/1' }] as unknown as ForgePullRequest[]),
      createPullRequest,
    } satisfies ForgeAdapter);

    const r = await createOpenSpecService(harness.ctx, harness.deps).archiveAfterMerge(ticketId);
    expect(r).toMatchObject({ skipped: null, pendingPrUrl: 'https://example.com/pr/200' });
    expect(createPullRequest).toHaveBeenCalled();
    const closed = harness.db.get<{ action: string }>("SELECT action FROM activity WHERE entity_id = ? AND action = 'openspec.archive_pr_closed'", [ticketId]);
    expect(closed?.action).toBe('openspec.archive_pr_closed');
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
