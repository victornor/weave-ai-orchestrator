import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId, nowIso } from '@weave-ai/db';
import type { Project } from '@weave-ai/shared';
import type { ForgeAdapter } from '@weave-ai/plugin-sdk';
import { makeHarness, fakeWake, fakeSpecs, type TestHarness } from '../testing/context.js';
import { createTicketsService } from './service.js';
import { createDecisionsService } from '../decisions/service.js';
import { git } from '../util/git.js';
import type { Actor, DecisionsService, TicketsService } from '../api.js';

const AGENT: Actor = { kind: 'agent', id: 'agent-1', runId: 'run-1' };
const HUMAN: Actor = { kind: 'human', id: 'victor' };
const CHANGE = 'add-dark-mode';
const BRANCH = `ac/archive-${CHANGE}`;

/** The archive-backfill merge card and its landing (VS-389). */
describe('archive backfill merge cards (VS-389)', () => {
  let h: TestHarness;
  let tickets: TicketsService;
  let decisions: DecisionsService;
  let dir: string;
  let origin: string;
  let clone: string;
  let wake: ReturnType<typeof fakeWake>;

  const commit = async (repo: string, message: string): Promise<void> => {
    await git(['add', '.'], repo);
    await git(['commit', '-m', message], repo);
  };
  const head = async (repo: string, ref = 'HEAD'): Promise<string> => (await git(['rev-parse', ref], repo)).stdout.trim();

  beforeEach(async () => {
    h = makeHarness();
    wake = fakeWake();
    h.services.wake = wake as never;
    h.services.specs = fakeSpecs() as never;
    h.services.workers = { spawnForTicket: vi.fn(async (_a: Actor, ticketId: string) => ({ id: h.addWorker(ticketId) })), retireIfLanded: vi.fn(async () => ({ retired: true })) } as never;

    dir = mkdtempSync(join(tmpdir(), 'ac-archive-backfill-'));
    origin = join(dir, 'origin');
    clone = join(dir, 'clone');
    await git(['init', '-b', 'main', origin], dir);
    await git(['config', 'user.email', 'test@example.com'], origin);
    await git(['config', 'user.name', 'Test'], origin);
    await git(['config', 'receive.denyCurrentBranch', 'ignore'], origin);
    writeFileSync(join(origin, 'README.md'), '# api\n');
    await commit(origin, 'init');
    await git(['clone', origin, clone], dir);
    await git(['config', 'user.email', 'test@example.com'], clone);
    await git(['config', 'user.name', 'Test'], clone);

    h.services.projects = {
      get: () => ({
        id: h.projectId, workspaceId: h.workspaceId, slug: 'api', name: 'API', gitUrl: 'git@example.com:acme/api.git',
        defaultBranch: 'main', landingBranch: null, clonePath: clone, maxWorkers: 4, setupCommand: null,
        worktreeProvider: 'git', openspecEnabled: true, openspecVersion: null, knowledgeRepoEnabled: false, knowledgeSwitch: null, policies: { deliveryMode: 'pr' },
        status: 'ready', syncState: 'in_sync', lastFetchedAt: null, errorText: null,
      } satisfies Project),
    } as never;

    tickets = createTicketsService(h.ctx, h.deps);
    decisions = createDecisionsService(h.ctx, h.deps);
    h.services.tickets = tickets;
    h.services.decisions = decisions;
  });

  afterEach(async () => {
    await tickets.stop();
    h.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  /** A squash of `origin/<branch>` onto `origin/main`, what `gh pr merge --squash` does. */
  async function realSquashMerge(branch: string = BRANCH): Promise<{ mergeCommit: string }> {
    const src = `squash-src-${branch.replace(/[^a-z0-9]+/gi, '-')}`;
    await git(['fetch', origin, `${branch}:${src}`], clone);
    await git(['fetch', origin, 'main'], clone);
    await git(['checkout', 'main'], clone);
    await git(['merge', '--ff-only', 'origin/main'], clone);
    await git(['merge', '--squash', src], clone);
    await git(['commit', '-m', `chore(openspec): archive ${CHANGE}`], clone);
    await git(['push', 'origin', 'main'], clone);
    return { mergeCommit: await head(clone) };
  }

  function archiveForge(over: Partial<ForgeAdapter> = {}): ForgeAdapter {
    return {
      id: 'github',
      detect: async () => true,
      prState: vi.fn(async () => ({ state: 'open' as const, ciState: 'none' as const })),
      mergePr: vi.fn(async () => realSquashMerge()),
      ...over,
    };
  }

  /** Pushes `ac/archive-<change>` already carrying the archived change, as a backfill would. */
  async function pushArchiveBranch(): Promise<void> {
    await git(['checkout', '-b', BRANCH], clone);
    mkdirSync(join(clone, 'openspec', 'specs', 'widgets'), { recursive: true });
    writeFileSync(join(clone, 'openspec', 'specs', 'widgets', 'spec.md'), '# widgets Specification\n\n## Purpose\nWidgets exist for this archive-backfill test, at least fifty characters.\n\n## Requirements\n\n### Requirement: A widget exists\nThe system SHALL have a widget.\n\n#### Scenario: One widget\n- **WHEN** asked\n- **THEN** a widget is returned\n');
    mkdirSync(join(clone, 'openspec', 'changes', 'archive', `2026-09-13-${CHANGE}`), { recursive: true });
    writeFileSync(join(clone, 'openspec', 'changes', 'archive', `2026-09-13-${CHANGE}`, 'proposal.md'), '## Why\nTest.\n\n## What Changes\n- x\n');
    await commit(clone, `chore(openspec): archive ${CHANGE}`);
    await git(['push', 'origin', BRANCH], clone);
    await git(['checkout', 'main'], clone);
  }

  function doneTicket(): string {
    const t = tickets.create(HUMAN, { kind: 'change', title: 'Add dark mode', projectId: h.projectId, assigneeRoleId: h.roleId });
    h.db.update('tickets', t.id, { status: 'done', openspecChangeName: CHANGE });
    return t.id;
  }

  it('raises exactly one open card and does not land without approval', async () => {
    await pushArchiveBranch();
    const forge = archiveForge();
    h.ctx.registries.forges.set('github', forge);
    const ticketId = doneTicket();

    const first = await tickets.raiseArchiveBackfillCard(AGENT, ticketId, { changeName: CHANGE, branch: BRANCH, prUrl: 'https://example.com/pr/313', number: 313 });
    expect(first.raised).toBe(true);
    const second = await tickets.raiseArchiveBackfillCard(AGENT, ticketId, { changeName: CHANGE, branch: BRANCH, prUrl: 'https://example.com/pr/313', number: 313 });
    expect(second.raised).toBe(false);
    expect(decisions.list({ ticketId, status: ['open'] })).toHaveLength(1);

    await new Promise((r) => setImmediate(r));
    expect(forge.mergePr).not.toHaveBeenCalled();
    expect(tickets.get(ticketId).status).toBe('done');
  });

  it('approving the card lands the pull request and keeps the ticket done', async () => {
    await pushArchiveBranch();
    const forge = archiveForge();
    h.ctx.registries.forges.set('github', forge);
    const ticketId = doneTicket();
    const { decisionId } = await tickets.raiseArchiveBackfillCard(AGENT, ticketId, { changeName: CHANGE, branch: BRANCH, prUrl: 'https://example.com/pr/313', number: 313 });
    const d = decisions.get(decisionId!);
    expect(d.ticketId).toBe(ticketId);

    // VS-281: the weaver must mark a review-carrying card looked before its approving answer is accepted.
    decisions.review({ kind: 'agent', id: h.conductorId, runId: 'run-c' }, d.id, { status: 'looked', note: 'the archive is clean' });
    await decisions.answer(HUMAN, d.id, { key: 'approve' });

    expect(forge.mergePr).toHaveBeenCalledTimes(1);
    const spec = (await git(['show', 'main:openspec/specs/widgets/spec.md'], clone)).stdout;
    expect(spec).toMatch(/A widget exists/);
    const t = tickets.get(ticketId);
    expect(t.status).toBe('done');
    expect(t.delivery?.['openspecArchive']).toMatchObject({ state: 'landed' });
  });

  it('declining the card records the pull request and merges nothing', async () => {
    await pushArchiveBranch();
    const forge = archiveForge();
    h.ctx.registries.forges.set('github', forge);
    const ticketId = doneTicket();
    const { decisionId } = await tickets.raiseArchiveBackfillCard(AGENT, ticketId, { changeName: CHANGE, branch: BRANCH, prUrl: 'https://example.com/pr/313', number: 313 });
    decisions.review({ kind: 'agent', id: h.conductorId, runId: 'run-c' }, decisionId!, { status: 'looked', note: 'looks fine' });
    await decisions.answer(HUMAN, decisionId!, { key: 'changes', text: 'wait for the release' });

    expect(forge.mergePr).not.toHaveBeenCalled();
    expect(tickets.get(ticketId).delivery?.['openspecArchive']).toMatchObject({ state: 'pending', declinedPrUrl: 'https://example.com/pr/313' });
    // Not re-raised for the same pull request.
    const again = await tickets.raiseArchiveBackfillCard(AGENT, ticketId, { changeName: CHANGE, branch: BRANCH, prUrl: 'https://example.com/pr/313', number: 313 });
    expect(again.raised).toBe(false);
  });

  it('YOLO holds the archive card until reviewed, then grants it on the mark', async () => {
    h.db.update('projects', h.projectId, { policiesJson: { deliveryMode: 'pr', yolo: true } });
    await pushArchiveBranch();
    // A fixed archive pull request head, so the recorded review head can be compared against it.
    // (The archive landing itself is covered by the human-approval tests above; here the point is
    // that the daemon's own grant is gated by the review.)
    const ARCHIVE_HEAD = 'c'.repeat(40);
    const forge = archiveForge({ prState: vi.fn(async () => ({ state: 'open' as const, ciState: 'none' as const, headSha: ARCHIVE_HEAD })) });
    h.ctx.registries.forges.set('github', forge);
    const ticketId = doneTicket();

    const { raised, decisionId } = await tickets.raiseArchiveBackfillCard(AGENT, ticketId, { changeName: CHANGE, branch: BRANCH, prUrl: 'https://example.com/pr/313', number: 313 });
    expect(raised).toBe(true);
    // VS-474: the card is left open and unseen — nothing is granted at raise time.
    expect(forge.mergePr).not.toHaveBeenCalled();
    expect(decisions.get(decisionId!)).toMatchObject({ status: 'open', weaverReviewStatus: 'unseen' });

    // The weaver looks: the mark records the archive pull request's head and releases the grant.
    await decisions.review({ kind: 'agent', id: h.conductorId, runId: 'run-c' }, decisionId!, {
      status: 'looked', note: 'the archive is clean', reviewedHead: ARCHIVE_HEAD,
    });
    expect(decisions.get(decisionId!)).toMatchObject({ status: 'answered', answeredByKind: 'system', weaverReviewStatus: 'looked' });
  });

  it('YOLO holds the archive card when its pull request head moved after the mark', async () => {
    h.db.update('projects', h.projectId, { policiesJson: { deliveryMode: 'pr', yolo: true } });
    await pushArchiveBranch();
    const ARCHIVE_HEAD = 'c'.repeat(40);
    const forge = archiveForge({ prState: vi.fn(async () => ({ state: 'open' as const, ciState: 'none' as const, headSha: ARCHIVE_HEAD })) });
    h.ctx.registries.forges.set('github', forge);
    const ticketId = doneTicket();

    const { decisionId } = await tickets.raiseArchiveBackfillCard(AGENT, ticketId, { changeName: CHANGE, branch: BRANCH, prUrl: 'https://example.com/pr/313', number: 313 });
    // Mark looked at a head that is no longer the archive pull request's head.
    await decisions.review({ kind: 'agent', id: h.conductorId, runId: 'run-c' }, decisionId!, {
      status: 'looked', note: 'reviewed the archive', reviewedHead: 'a'.repeat(40),
    });
    expect(decisions.get(decisionId!)?.status).toBe('open');
    expect(forge.mergePr).not.toHaveBeenCalled();

    // Re-marking looked at the current head releases it.
    await decisions.review({ kind: 'agent', id: h.conductorId, runId: 'run-c' }, decisionId!, {
      status: 'looked', note: 're-read at the new head', reviewedHead: ARCHIVE_HEAD,
    });
    expect(decisions.get(decisionId!)).toMatchObject({ status: 'answered', answeredByKind: 'system' });
  });

  it('records a conflict and does not merge', async () => {
    await pushArchiveBranch();
    // A conflicting change lands on main after the archive branch forked.
    mkdirSync(join(origin, 'openspec', 'specs', 'widgets'), { recursive: true });
    writeFileSync(join(origin, 'openspec', 'specs', 'widgets', 'spec.md'), '# conflict\n');
    await commit(origin, 'feat: conflicting change');
    const forge = archiveForge({ mergePr: vi.fn(async () => ({})) });
    h.ctx.registries.forges.set('github', forge);
    const ticketId = doneTicket();

    const r = await tickets.landArchiveBackfill(AGENT, { ticketId, changeName: CHANGE, branch: BRANCH, prUrl: 'https://example.com/pr/313' });
    expect(r.landed).toBe(false);
    expect(forge.mergePr).not.toHaveBeenCalled();
    expect(tickets.comments(ticketId).some((c) => c.body.includes('not landed yet'))).toBe(true);
  });

  it('comments and wakes once for a standing conflict, not on every retry (VS-389 review)', async () => {
    await pushArchiveBranch();
    mkdirSync(join(origin, 'openspec', 'specs', 'widgets'), { recursive: true });
    writeFileSync(join(origin, 'openspec', 'specs', 'widgets', 'spec.md'), '# conflict\n');
    await commit(origin, 'feat: conflicting change');
    h.ctx.registries.forges.set('github', archiveForge({ mergePr: vi.fn(async () => ({})) }));
    const ticketId = doneTicket();
    const input = { ticketId, changeName: CHANGE, branch: BRANCH, prUrl: 'https://example.com/pr/313' };

    for (let i = 0; i < 3; i++) expect((await tickets.landArchiveBackfill(AGENT, input)).landed).toBe(false);

    expect(tickets.comments(ticketId).filter((c) => c.body.includes('not landed yet'))).toHaveLength(1);
    const landingWakes = wake.calls.filter((c) => (c.input as { idempotencyKey?: string }).idempotencyKey === `reconcile-archive-failed:${ticketId}:https://example.com/pr/313`);
    expect(landingWakes).toHaveLength(1);
  });

  it('is silent while required checks are pending, even across retries (VS-389 review)', async () => {
    await pushArchiveBranch();
    const forge = archiveForge({ prState: vi.fn(async () => ({ state: 'open' as const, ciState: 'pending' as const })) });
    h.ctx.registries.forges.set('github', forge);
    const ticketId = doneTicket();
    h.db.update('tickets', ticketId, { deliveryJson: { openspecArchive: { changeName: CHANGE, state: 'pending', pendingPrUrl: 'https://example.com/pr/313' } } });
    const input = { ticketId, changeName: CHANGE, branch: BRANCH, prUrl: 'https://example.com/pr/313' };

    for (let i = 0; i < 3; i++) expect((await tickets.landArchiveBackfill(AGENT, input)).landed).toBe(false);

    expect(forge.mergePr).not.toHaveBeenCalled();
    expect(tickets.comments(ticketId).filter((c) => c.body.includes('not landed yet'))).toHaveLength(0);
    expect(wake.calls).toHaveLength(0);
    // The pending state is still recorded, so a later resolved check retries from the same PR.
    expect(tickets.get(ticketId).delivery?.['openspecArchive']).toMatchObject({
      state: 'pending', pendingPrUrl: 'https://example.com/pr/313', lastFailure: { reason: 'required checks are pending' },
    });
  });

  /** VS-408: main advances with a `widgets` spec the fake archive branch already added, so the rebase conflicts. */
  function addConflictingWidgetsSpec(): void {
    mkdirSync(join(origin, 'openspec', 'specs', 'widgets'), { recursive: true });
    writeFileSync(join(origin, 'openspec', 'specs', 'widgets', 'spec.md'), '# conflict\n');
  }

  /** A new-capability change left on main for a rebuild to archive, with or without a usable proposal Why. */
  function seedGadgetChange(why: string | null): void {
    const changeDir = join(origin, 'openspec', 'changes', CHANGE);
    mkdirSync(join(changeDir, 'specs', 'gadgets'), { recursive: true });
    writeFileSync(join(changeDir, '.openspec.yaml'), 'schema: spec-driven\n');
    const whySection = why === null ? '' : `## Why\n\n${why}\n\n`;
    writeFileSync(join(changeDir, 'proposal.md'), `${whySection}## What Changes\n- Add a gadget.\n\n## Capabilities\n\n### New Capabilities\n- \`gadgets\`: adds a gadget\n`);
    writeFileSync(join(changeDir, 'specs', 'gadgets', 'spec.md'), '## ADDED Requirements\n\n### Requirement: A gadget exists\nThe system SHALL have a gadget.\n\n#### Scenario: One gadget\n- **WHEN** asked\n- **THEN** a gadget is returned\n');
    writeFileSync(join(changeDir, 'tasks.md'), '## 1. Gadget\n\n- [x] 1.1 Add it\n');
  }

  it('lands a conflicting archive branch after rebuilding it from the landing tip (VS-408)', async () => {
    await pushArchiveBranch();
    addConflictingWidgetsSpec();
    seedGadgetChange('Gadgets exist so callers can rely on a gadget being present and shaped the way this capability guarantees.');
    await commit(origin, 'feat: conflicting widgets spec and a left-behind change');
    const forge = archiveForge();
    h.ctx.registries.forges.set('github', forge);
    const ticketId = doneTicket();

    const r = await tickets.landArchiveBackfill(AGENT, { ticketId, changeName: CHANGE, branch: BRANCH, prUrl: 'https://example.com/pr/313' });

    expect(r.landed).toBe(true);
    expect(forge.mergePr).toHaveBeenCalledTimes(1);
    // The rebuilt archive added the change's capability, and did not clobber main's own widgets spec.
    expect((await git(['show', 'main:openspec/specs/gadgets/spec.md'], clone)).stdout).toMatch(/A gadget exists/);
    expect((await git(['show', 'main:openspec/specs/widgets/spec.md'], clone)).stdout).toContain('# conflict');
    expect(tickets.get(ticketId).delivery?.['openspecArchive']).toMatchObject({ state: 'landed' });
  });

  it('records one failure with openspec reason when the rebuild is refused, and does not loop (VS-408)', async () => {
    await pushArchiveBranch();
    addConflictingWidgetsSpec();
    seedGadgetChange(null); // no Why: the archive created by the rebuild keeps the placeholder and is refused
    await commit(origin, 'feat: conflicting widgets spec and an unarchivable change');
    const forge = archiveForge({ mergePr: vi.fn(async () => ({})) });
    h.ctx.registries.forges.set('github', forge);
    const ticketId = doneTicket();
    const input = { ticketId, changeName: CHANGE, branch: BRANCH, prUrl: 'https://example.com/pr/313' };

    for (let i = 0; i < 3; i++) expect((await tickets.landArchiveBackfill(AGENT, input)).landed).toBe(false);

    const failures = tickets.comments(ticketId).filter((c) => c.body.includes('not landed yet'));
    expect(failures).toHaveLength(1);
    expect(failures[0]!.body).toContain('placeholder'); // openspec's own reason, not a generic one
    expect(forge.mergePr).not.toHaveBeenCalled();
    const landingWakes = wake.calls.filter((c) => (c.input as { idempotencyKey?: string }).idempotencyKey === `reconcile-archive-failed:${ticketId}:https://example.com/pr/313`);
    expect(landingWakes).toHaveLength(1);
  });
});
