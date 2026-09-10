import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@agent-conductor/db';
import { estimateTokens } from '@agent-conductor/shared';
import { makeHarness, fakeWake, type TestHarness } from '../testing/context.js';
import { createKnowledgeService } from './service.js';
import { BUDGETS, PROJECT_SECTIONS, parseDoc, parseLinks } from './files.js';
import type { Actor, KnowledgeService } from '../api.js';

const HUMAN: Actor = { kind: 'human', id: 'victor' };
const WORKER: Actor = { kind: 'agent', id: 'worker-1', runId: 'run-1' };
const tick = () => new Promise((r) => setImmediate(r));

describe('knowledge', () => {
  let h: TestHarness;
  let knowledge: KnowledgeService;
  let wake: ReturnType<typeof fakeWake>;
  let workers: { spawnCurator: ReturnType<typeof vi.fn>; conductor: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    h = makeHarness();
    wake = fakeWake();
    workers = {
      spawnCurator: vi.fn(async () => ({ id: 'curator-agent', ticketId: 'curation-ticket' })),
      conductor: vi.fn(() => ({ id: h.conductorId })),
    };
    h.services.wake = wake as never;
    h.services.workers = workers as never;
    knowledge = createKnowledgeService(h.ctx, h.deps);
    h.services.knowledge = knowledge;
  });
  afterEach(() => h.cleanup());

  /** The workspace's configured budgets: changing one is what the human does from settings. */
  const budgets = () => h.ctx.config.defaults.knowledgeBudgetTokens;

  it('seeds every knowledge file with its sections and budget', () => {
    const project = knowledge.get('project', h.projectId);
    expect(project.path).toBe(join(h.ctx.paths.knowledge, 'projects/api/PROJECT.md'));
    expect(existsSync(project.path)).toBe(true);
    expect(parseDoc(project.body).sections.map((s) => s.name)).toEqual([...PROJECT_SECTIONS]);
    expect(project.budgetTokens).toBe(BUDGETS.project);
    expect(knowledge.get('shared').budgetTokens).toBe(BUDGETS.shared);
    expect(knowledge.get('workspace').body).toContain('## Portfolio');
    expect(knowledge.get('decisions').body).toContain('## Decisions');
  });

  it('leaves an existing project knowledge file exactly as it is on disk', () => {
    const path = join(h.ctx.paths.knowledge, 'projects/api/PROJECT.md');
    mkdirSync(dirname(path), { recursive: true });
    const existing = '# api\n\n## Overview\n\n- 2026-09-05 \u00b7 An older knowledge base with no Documents section.\n';
    writeFileSync(path, existing, 'utf8');
    expect(knowledge.get('project', h.projectId).body).toBe(existing);
  });

  it('appends a dated entry under a section and creates a missing one', () => {
    const r = knowledge.note(WORKER, 'project', 'Learnings', 'The migration runner needs DATABASE_URL set before pnpm test.', h.projectId);
    expect(r.revision).toBe(2);
    expect(r.remainingTokens).toBeGreaterThan(0);
    const body = knowledge.get('project', h.projectId).body;
    expect(body).toMatch(/## Learnings\n- \d{4}-\d{2}-\d{2} · The migration runner needs DATABASE_URL/);

    knowledge.note(WORKER, 'project', 'Deploy notes', 'Staging deploys run from the release branch only.', h.projectId);
    expect(knowledge.get('project', h.projectId).body).toContain('## Deploy notes');
  });

  it('records the ticket a note or a document came from, resolved from the writing run (VS-102)', () => {
    const now = new Date().toISOString();
    const ticketId = newId();
    h.db.insert('tickets', {
      id: ticketId, workspaceId: h.workspaceId, projectId: h.projectId, number: 7, identifier: 'API-7', kind: 'task',
      title: 'Do a thing', status: 'in_progress', priority: 'medium', createdByKind: 'human', createdAt: now, updatedAt: now,
    });
    const agentId = h.addWorker(ticketId);
    h.db.insert('runs', {
      id: 'run-1', workspaceId: h.workspaceId, agentId, ticketId, runtimeId: 'claude', turnEpoch: 1, cwd: '/tmp', createdAt: now,
    });

    knowledge.note(WORKER, 'project', 'Learnings', 'A note written while holding a ticket.', h.projectId);
    const noteRevision = knowledge.revisions('project', h.projectId)[0]!;
    expect(noteRevision).toMatchObject({ ticketId, ticketIdentifier: 'API-7' });

    const written = knowledge.putDoc(WORKER, 'project', 'a-doc', '# A doc\n\nSome reasoning.\n', h.projectId);
    const docRevision = h.db.get<{ ticketId: string | null }>(
      'SELECT ticket_id FROM knowledge_revisions WHERE file_id = (SELECT id FROM knowledge_files WHERE path = ?) AND revision = ?',
      [written.path, written.revision],
    );
    expect(docRevision).toMatchObject({ ticketId });
  });

  it('records no ticket for a write with no run behind it — a human edit or a daemon seed', () => {
    knowledge.replace(HUMAN, 'project', '# api\n\n## Overview\n\n- 2026-09-07 · A human edit.\n', 'human', h.projectId);
    const revision = knowledge.revisions('project', h.projectId)[0]!;
    expect(revision).toMatchObject({ ticketId: null, ticketIdentifier: null });
  });

  it('appends under an existing section whose name arrives HTML-escaped', () => {
    knowledge.note(WORKER, 'project', 'Stack &amp; commands', 'Node 26 and pnpm 11 come from mise.', h.projectId);
    const body = knowledge.get('project', h.projectId).body;
    expect(body).not.toContain('&amp;');
    expect(body.match(/^## Stack & commands$/gm)).toHaveLength(1);
    expect(body).toMatch(/## Stack & commands\n- \d{4}-\d{2}-\d{2} · Node 26 and pnpm 11 come from mise\./);
  });

  it('creates a missing section with an entity-decoded heading', () => {
    knowledge.note(WORKER, 'project', 'Builds &amp; releases', 'Releases are cut from the release branch.', h.projectId);
    const body = knowledge.get('project', h.projectId).body;
    expect(body).toContain('## Builds & releases');
    expect(body).not.toContain('&amp;');
  });

  it('rejects entries over 60 words', () => {
    const long = Array.from({ length: 61 }, (_, i) => `word${i}`).join(' ');
    expect(() => knowledge.note(WORKER, 'project', 'Learnings', long, h.projectId)).toThrowError(expect.objectContaining({ code: 'entry_too_long' }));
  });

  it('rejects near-duplicate entries', () => {
    knowledge.note(WORKER, 'project', 'Landmines', 'Never run the seed script against the staging database.', h.projectId);
    expect(() => knowledge.note(WORKER, 'project', 'Landmines', 'Never run the seed script against the staging database', h.projectId))
      .toThrowError(expect.objectContaining({ code: 'duplicate_entry' }));
    expect(() => knowledge.note(WORKER, 'project', 'Learnings', 'never run the seed script against the staging  database.', h.projectId))
      .toThrowError(expect.objectContaining({ code: 'duplicate_entry' }));
    // A genuinely different entry still goes in.
    expect(knowledge.note(WORKER, 'project', 'Landmines', 'The websocket gateway drops idle connections after 30 seconds.', h.projectId).revision).toBeGreaterThan(1);
  });

  it('appends a note into an existing linked document instead of the hub', () => {
    knowledge.putDoc(WORKER, 'project', 'run-engine', '# Run engine\n\nOne turn end to end.\n', h.projectId);
    const r = knowledge.note(WORKER, 'project', 'Landmines', 'A second wake for a busy agent is coalesced into the queued one.', h.projectId, 'run-engine');
    expect(r.revision).toBe(2);
    const doc = knowledge.getDoc('project', 'run-engine', h.projectId);
    expect(doc.body).toMatch(/## Landmines\n- \d{4}-\d{2}-\d{2} · A second wake for a busy agent is coalesced into the queued one\./);
    expect(knowledge.get('project', h.projectId).body).not.toContain('A second wake for a busy agent');
  });

  it('rejects a doc-targeted note when the document does not exist', () => {
    expect(() => knowledge.note(WORKER, 'project', 'Landmines', 'Nowhere to put this yet.', h.projectId, 'no-such-doc'))
      .toThrowError(expect.objectContaining({ code: 'not_found' }));
  });

  it('checks a doc-targeted note for near-duplicates against the document, not the hub', () => {
    knowledge.putDoc(WORKER, 'project', 'run-engine', '# Run engine\n\nOne turn end to end.\n', h.projectId);
    knowledge.note(WORKER, 'project', 'Landmines', 'Never grep the process list for vitest to detect a finished run.', h.projectId, 'run-engine');
    // The exact same fact in the hub is not a duplicate of the one in the document.
    expect(knowledge.note(WORKER, 'project', 'Landmines', 'Never grep the process list for vitest to detect a finished run.', h.projectId).revision).toBeGreaterThan(1);
    // But it is a duplicate of the one already in the document.
    expect(() => knowledge.note(WORKER, 'project', 'Landmines', 'Never grep the process list for vitest to detect a finished run', h.projectId, 'run-engine'))
      .toThrowError(expect.objectContaining({ code: 'duplicate_entry' }));
  });

  it('rejects an over-budget doc-targeted note and schedules curation without touching the hub', async () => {
    const filler = Array.from({ length: 40 }, (_, i) => `- 2026-01-01 · a run-engine fact number ${i} about phases and wakes`).join('\n');
    knowledge.putDoc(WORKER, 'project', 'run-engine', `# Run engine\n\n## Landmines\n${filler}\n`, h.projectId);
    budgets().document = 500;
    expect(() => knowledge.note(WORKER, 'project', 'Landmines', 'One more run-engine fact worth remembering here.', h.projectId, 'run-engine'))
      .toThrowError(expect.objectContaining({ code: 'budget_exceeded' }));
    await tick();
    expect(knowledge.get('project', h.projectId).curationPending).toBe(false);
    expect(workers.spawnCurator).toHaveBeenCalledWith(expect.objectContaining({ kind: 'system' }), h.projectId);
  });

  it('appends a doc-targeted note exactly as before when no doc is given', () => {
    const r = knowledge.note(WORKER, 'project', 'Learnings', 'Unaffected by the doc parameter existing.', h.projectId);
    expect(knowledge.get('project', h.projectId).body).toContain('Unaffected by the doc parameter existing.');
    expect(r.revision).toBe(2);
  });

  it('rejects over-budget writes, flags curation and spawns a curation worker', async () => {
    const filler = Array.from({ length: 400 }, (_, i) => `- 2026-01-01 · durable fact number ${i} about the project internals`).join('\n');
    knowledge.replace(HUMAN, 'project', `# API\n\n## Learnings\n${filler}\n`, 'human', h.projectId);
    budgets().project = 500;
    expect(() => knowledge.note(WORKER, 'project', 'Learnings', 'One more thing worth remembering here.', h.projectId))
      .toThrowError(expect.objectContaining({ code: 'budget_exceeded' }));
    await tick();
    expect(knowledge.get('project', h.projectId).curationPending).toBe(true);
    expect(workers.spawnCurator).toHaveBeenCalledWith(expect.objectContaining({ kind: 'system' }), h.projectId);
  });

  it('measures a write against the configured budget, not the one the file was created with', async () => {
    const entry = 'The billing reconciler runs nightly and reads from the read replica.';
    budgets().project = 500;
    const filler = Array.from({ length: 40 }, (_, i) => `- 2026-01-01 · durable fact number ${i} about the project internals`).join('\n');
    knowledge.replace(HUMAN, 'project', `# API\n\n## Learnings\n${filler}\n`, 'human', h.projectId);
    expect(() => knowledge.note(WORKER, 'project', 'Learnings', entry, h.projectId))
      .toThrowError(expect.objectContaining({ code: 'budget_exceeded' }));

    // The human raises the budget: the same entry goes in on the next write, with no restart.
    budgets().project = 10000;
    expect(knowledge.note(WORKER, 'project', 'Learnings', entry, h.projectId).revision).toBeGreaterThan(1);
    expect(knowledge.get('project', h.projectId).body).toContain(entry);
    await tick();
  });

  it('reports the configured budget everywhere it reports a size, and mirrors it onto the row', async () => {
    knowledge.putDoc(WORKER, 'project', 'billing-data-model', '# Billing data model\n\nOne invoice per period.\n', h.projectId);
    budgets().project = 12345;
    budgets().document = 6789;

    expect(knowledge.get('project', h.projectId).budgetTokens).toBe(12345);
    expect(knowledge.listDocs({ projectId: h.projectId }).map((d) => d.budgetTokens)).toEqual([6789]);
    expect(knowledge.getDoc('project', 'billing-data-model', h.projectId).budgetTokens).toBe(6789);
    const lint = knowledge.lint();
    expect(lint.find((r) => r.path === 'projects/api/PROJECT.md')!.budgetTokens).toBe(12345);
    expect(lint.find((r) => r.path.endsWith('billing-data-model.md'))!.budgetTokens).toBe(6789);

    // The database column and the write event mirror the configured value.
    expect(h.db.get<{ budgetTokens: number }>('SELECT budget_tokens AS budgetTokens FROM knowledge_files WHERE path = ?', ['projects/api/PROJECT.md'])!.budgetTokens).toBe(12345);
    knowledge.note(WORKER, 'project', 'Learnings', 'Invoices are immutable once issued.', h.projectId);
    await tick();
    const updated = h.events.filter((e) => e.type === 'knowledge.updated').at(-1)!;
    expect((updated.payload as { budgetTokens: number }).budgetTokens).toBe(12345);
  });

  it('schedules curation at 80% of the configured budget without rejecting the write', async () => {
    const body = `# API\n\n## Learnings\n${Array.from({ length: 10 }, (_, i) => `- 2026-01-01 · durable fact number ${i} about the project internals`).join('\n')}\n`;
    knowledge.replace(HUMAN, 'project', body, 'human', h.projectId);
    const tokens = knowledge.get('project', h.projectId).tokenEstimate;
    budgets().project = Math.ceil(tokens / 0.85);

    expect(knowledge.note(WORKER, 'project', 'Learnings', 'The gateway retries idempotent calls twice.', h.projectId).revision).toBeGreaterThan(1);
    await tick();
    expect(knowledge.get('project', h.projectId).curationPending).toBe(true);
    expect(workers.spawnCurator).toHaveBeenCalled();
  });

  it('derives the health view\'s four measures from a project with one of each, and reports empty arrays for a clean one (VS-102)', () => {
    // a hub past 80% of its share
    const body = `# API\n\n## Learnings\n${Array.from({ length: 10 }, (_, i) => `- 2026-01-01 · durable fact number ${i} about the project internals`).join('\n')}\n`;
    knowledge.replace(HUMAN, 'project', body, 'human', h.projectId);
    const tokens = knowledge.get('project', h.projectId).tokenEstimate;
    budgets().project = Math.ceil(tokens / 0.85);

    // an orphan document with an unresolved [[link]]
    knowledge.putDoc(WORKER, 'project', 'payments-webhooks', '# Payments webhooks\n\nSee [[nowhere]].\n', h.projectId);

    // a document nobody has touched in a long time
    knowledge.putDoc(WORKER, 'project', 'old-design', '# Old design\n\nA rationale from a while ago.\n', h.projectId);
    const longAgo = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    h.db.run('UPDATE knowledge_files SET updated_at = ? WHERE path = ?', [longAgo, 'projects/api/docs/old-design.md']);

    const dirty = knowledge.health(h.projectId);
    expect(dirty.hubs.find((hub) => hub.path === 'projects/api/PROJECT.md')).toMatchObject({ nearBudget: true });
    expect(dirty.orphans.map((d) => d.slug)).toContain('payments-webhooks');
    expect(dirty.orphans.map((d) => d.slug)).toContain('old-design');
    expect(dirty.stale.map((d) => d.slug)).toEqual(['old-design']);
    expect(dirty.unresolvedLinks).toEqual([{ fromPath: 'projects/api/docs/payments-webhooks.md', fromTitle: 'Payments webhooks', toSlug: 'nowhere' }]);

    // a second, untouched project reports the measures empty rather than omitting them
    const h2 = makeHarness();
    const knowledge2 = createKnowledgeService(h2.ctx, h2.deps);
    const clean = knowledge2.health(h2.projectId);
    expect(clean.orphans).toEqual([]);
    expect(clean.stale).toEqual([]);
    expect(clean.unresolvedLinks).toEqual([]);
    expect(clean.hubs.find((hub) => hub.path === 'projects/api/PROJECT.md')).toMatchObject({ nearBudget: false });
    h2.cleanup();
  });

  it('the workspace-wide health view (no project) reports every project\'s hubs and documents', () => {
    knowledge.putDoc(WORKER, 'project', 'an-orphan', '# An orphan\n\nNothing links here.\n', h.projectId);
    const all = knowledge.health();
    expect(all.hubs.map((hub) => hub.path)).toEqual(expect.arrayContaining(['workspace/WORKSPACE.md', 'workspace/SHARED.md', 'workspace/decisions.md', 'projects/api/PROJECT.md']));
    expect(all.orphans.map((d) => d.slug)).toContain('an-orphan');
  });

  it('rejects a document over the configured document budget', () => {
    budgets().document = 500;
    const long = `# Payments\n\n${'The webhook pipeline verifies, queues and applies each event. '.repeat(60)}\n`;
    expect(() => knowledge.putDoc(WORKER, 'project', 'payments', long, h.projectId))
      .toThrowError(expect.objectContaining({ code: 'budget_exceeded' }));
    budgets().document = 10000;
    expect(knowledge.putDoc(WORKER, 'project', 'payments', long, h.projectId).budgetTokens).toBe(10000);
  });

  it('states the configured budget in a seeded file and corrects a stale one on the next write', () => {
    budgets().project = 9000;
    expect(knowledge.get('project', h.projectId).body).toContain('Budget 9000 tokens');

    const path = join(h.ctx.paths.knowledge, 'projects/api/PROJECT.md');
    const stale = '# api\n\n<!-- The project knowledge base. Budget 1500 tokens. Workers append concise dated learnings. -->\n\n## Learnings\n';
    writeFileSync(path, stale, 'utf8');
    expect(knowledge.get('project', h.projectId).body).toBe(stale);  // reading changes nothing

    knowledge.note(WORKER, 'project', 'Learnings', 'The seed script is not safe to run twice.', h.projectId);
    const body = knowledge.get('project', h.projectId).body;
    expect(body).toContain('<!-- The project knowledge base. Budget 9000 tokens. Workers append concise dated learnings. -->');
    expect(body).not.toContain('1500');
  });

  it('leaves a file with no budget marker alone', () => {
    const path = join(h.ctx.paths.knowledge, 'projects/api/PROJECT.md');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '# api\n\n## Learnings\n', 'utf8');
    knowledge.note(WORKER, 'project', 'Learnings', 'Nothing here states a budget.', h.projectId);
    const body = knowledge.get('project', h.projectId).body;
    expect(body).not.toContain('<!--');
    expect(body).toContain('Nothing here states a budget.');
  });

  it('requests conductor curation for workspace-scoped files', async () => {
    const r = await knowledge.requestCuration(HUMAN, 'workspace');
    expect(r.wakeId).toBeTruthy();
    expect(wake.calls[0]).toMatchObject({ agentId: h.conductorId, input: { source: 'system', reason: 'curate' } });
  });

  it('archives removed entries on replace and supports revert', () => {
    knowledge.note(WORKER, 'project', 'Learnings', 'The build needs Node 22 or newer.', h.projectId);
    const before = knowledge.get('project', h.projectId);
    knowledge.replace(HUMAN, 'project', '# API\n\n## Learnings\n- 2026-01-01 · Something else entirely.\n', 'curation', h.projectId);
    const archive = join(h.ctx.paths.knowledge, 'projects/api/archive');
    const files = readFileSync(join(archive, `${new Date().toISOString().slice(0, 10)}.md`), 'utf8');
    expect(files).toContain('The build needs Node 22 or newer.');
    expect(knowledge.get('project', h.projectId).lastCuratedAt).not.toBeNull();
    expect(knowledge.get('project', h.projectId).curationPending).toBe(false);

    const revs = knowledge.revisions('project', h.projectId);
    expect(revs.map((r) => r.reason)).toContain('curation');
    knowledge.revert(HUMAN, 'project', before.revision, h.projectId);
    expect(knowledge.get('project', h.projectId).body).toContain('The build needs Node 22 or newer.');
  });

  it('clears the pending flag on every file in a scope when that scope is curated', () => {
    const doc = knowledge.putDoc(WORKER, 'project', 'run-engine', '# Run engine\n\nOne turn end to end.\n', h.projectId);
    // A document flagged under the budget in force when it was written (VS-18 raised it since).
    h.db.run("UPDATE knowledge_files SET curation_pending = 1 WHERE path = ?", [doc.path]);
    knowledge.replace(HUMAN, 'project', '# API\n\n## Learnings\n- 2026-01-01 · Curated.\n', 'curation', h.projectId);
    const pending = h.db.get<{ curationPending: number }>('SELECT curation_pending FROM knowledge_files WHERE path = ?', [doc.path])!;
    expect(pending.curationPending).toBe(0);
  });

  it('picks up out-of-band human edits as a revision', () => {
    const { path } = knowledge.get('shared');
    writeFileSync(path, '# Shared knowledge\n\n## Conventions\n- 2026-01-01 · Squash merges only.\n', 'utf8');
    const after = knowledge.get('shared');
    expect(after.body).toContain('Squash merges only');
    expect(knowledge.revisions('shared').some((r) => r.reason === 'human')).toBe(true);
  });

  it('archives expired entries on reindex', () => {
    knowledge.replace(
      HUMAN, 'project',
      '# API\n\n## Current focus\n- 2020-01-01 · Ship the beta. <!--exp:2020-02-01-->\n- 2026-01-01 · Keep this one.\n',
      'human', h.projectId,
    );
    knowledge.reindex();
    const body = knowledge.get('project', h.projectId).body;
    expect(body).not.toContain('Ship the beta');
    expect(body).toContain('Keep this one');
    expect(knowledge.revisions('project', h.projectId).some((r) => r.reason === 'expiry')).toBe(true);
  });

  it('reindex re-derives the links of an unchanged document', () => {
    knowledge.putDoc(WORKER, 'project', 'payments-webhooks', '# Payments webhooks\n\nStripe events. Syntax: `[[example]]`.\n', h.projectId);
    const path = 'projects/api/docs/payments-webhooks.md';
    // a link row left behind by the older parser, which matched inside code spans
    h.db.run('INSERT OR REPLACE INTO knowledge_links (workspace_id, from_path, to_slug, to_path) VALUES (?,?,?,?)', [h.workspaceId, path, 'example', null]);
    expect(knowledge.getDoc('project', 'payments-webhooks', h.projectId).linksTo.map((l) => l.slug)).toEqual(['example']);
    knowledge.reindex();
    expect(knowledge.getDoc('project', 'payments-webhooks', h.projectId).linksTo).toEqual([]);
  });

  it('lints every file with sizes and pending triggers', () => {
    const rows = knowledge.lint();
    expect(rows.map((r) => r.path).sort()).toEqual(['projects/api/PROJECT.md', 'workspace/SHARED.md', 'workspace/WORKSPACE.md', 'workspace/decisions.md']);
    expect(rows.every((r) => r.pct >= 0 && r.budgetTokens > 0)).toBe(true);
  });

  it('searches the knowledge bases through FTS', () => {
    knowledge.note(WORKER, 'project', 'Landmines', 'The payments webhook retries five times with exponential backoff.', h.projectId);
    const hits = knowledge.search('webhook');
    expect(hits.map((x) => x.ref)).toContain('projects/api/PROJECT.md');
    expect(hits[0]?.kind).toBe('knowledge');
    expect(knowledge.search('   ')).toEqual([]);
  });

  it('builds a conductor bootstrap digest from the workspace files and each project overview', () => {
    knowledge.note(HUMAN, 'project', 'Overview', 'The API serves the customer dashboard.', h.projectId);
    knowledge.note(HUMAN, 'project', 'Current focus', 'Shipping billing v2 this month.', h.projectId);
    knowledge.note(HUMAN, 'project', 'Learnings', 'Migrations run with pnpm db:migrate.', h.projectId);
    const d = knowledge.bootstrapDigest(h.conductorId);
    expect(d.text).toContain('workspace knowledge');
    expect(d.text).toContain('Shared knowledge');
    expect(d.text).toContain('The API serves the customer dashboard.');
    expect(d.text).toContain('Shipping billing v2');
    expect(d.text).not.toContain('Migrations run with pnpm db:migrate.');
    expect(d.tokens).toBe(estimateTokens(d.text));
    expect(d.truncated).toBe(false);
    expect(d.parts.map((p) => p.scope)).toEqual(['workspace', 'shared', 'project']);
    const projectPart = d.parts.find((p) => p.scope === 'project')!;
    expect(projectPart.projectId).toBe(h.projectId);
    // The chunk is only Overview + Current focus, not Learnings — measured on that slice, not the
    // full project file's own `tokenEstimate` (VS-110).
    expect(projectPart.tokens).toBeLessThan(knowledge.get('project', h.projectId).tokenEstimate);
  });

  it('gives the conductor one bootstrap-part entry per project, sized to that project\'s own chunk', () => {
    const otherId = newId();
    const now = new Date().toISOString();
    h.db.insert('projects', {
      id: otherId, workspaceId: h.workspaceId, slug: 'web', name: 'Web', gitUrl: 'git@example.com:acme/web.git', defaultBranch: 'main',
      clonePath: '/tmp/web', maxWorkers: 4, worktreeProvider: 'git', openspecEnabled: 1, policiesJson: {}, status: 'ready',
      createdAt: now, updatedAt: now,
    });
    knowledge.note(HUMAN, 'project', 'Overview', 'Short overview.', h.projectId);
    knowledge.note(HUMAN, 'project', 'Overview', 'A much longer overview describing the web app in far more detail than the API project has.', otherId);
    const d = knowledge.bootstrapDigest(h.conductorId);
    const projectParts = d.parts.filter((p) => p.scope === 'project');
    expect(projectParts).toHaveLength(2);
    expect(new Set(projectParts.map((p) => p.projectId))).toEqual(new Set([h.projectId, otherId]));
    const apiPart = projectParts.find((p) => p.projectId === h.projectId)!;
    const webPart = projectParts.find((p) => p.projectId === otherId)!;
    expect(webPart.tokens).toBeGreaterThan(apiPart.tokens);
  });

  it('gives a worker SHARED.md plus its own project knowledge, truncating Learnings when over budget', () => {
    const workerId = h.addWorker(null);
    knowledge.note(WORKER, 'project', 'Learnings', 'Use pnpm, never npm, in this repo.', h.projectId);
    const d = knowledge.bootstrapDigest(workerId);
    expect(d.text).toContain('Shared knowledge');
    expect(d.text).toContain('Use pnpm, never npm');
    expect(d.text).not.toContain('workspace knowledge');

    h.ctx.config.defaults.bootstrapBudgetTokens = 60;
    const small = knowledge.bootstrapDigest(workerId);
    expect(small.truncated).toBe(true);
    expect(small.text).toContain('truncated');
  });

  it('carries full-size knowledge bases into a worker digest without truncating', () => {
    const workerId = h.addWorker(null);
    const lines = (tokens: number) => {
      const line = '- 2026-01-01 · durable fact about the project internals worth keeping in the knowledge base';
      return Array.from({ length: Math.floor((tokens * 3.5) / (line.length + 1)) }, () => line).join('\n');
    };
    knowledge.replace(HUMAN, 'shared', `# Shared knowledge\n\n## Conventions\n${lines(budgets().shared)}\n`, 'human');
    knowledge.replace(HUMAN, 'project', `# API\n\n## Learnings\n${lines(budgets().project)}\n`, 'human', h.projectId);
    expect(knowledge.get('shared').tokenEstimate).toBeGreaterThan(budgets().shared * 0.9);
    expect(knowledge.get('project', h.projectId).tokenEstimate).toBeGreaterThan(budgets().project * 0.9);

    const d = knowledge.bootstrapDigest(workerId);
    expect(d.truncated).toBe(false);
    expect(d.text).not.toContain('truncated');
    expect(d.tokens).toBeLessThanOrEqual(h.ctx.config.defaults.bootstrapBudgetTokens);
  });

  it('appends answered decisions to decisions.md once', () => {
    const decision = {
      id: 'd1', workspaceId: h.workspaceId, ticketId: null, kind: 'plan_approval', owner: 'human', askedByAgentId: null,
      askedInRunId: null, title: 'Use CSS variables for theming', context: '', options: [], allowFreeText: true,
      recommendation: null, status: 'answered', answerKey: 'approve', answerText: 'yes, variables', answeredByKind: 'human',
      answeredById: 'victor', answeredAt: new Date().toISOString(), expiresAt: null, target: null, correlationKey: null,
      createdAt: new Date().toISOString(),
    } as never;
    knowledge.appendDecision(decision);
    knowledge.appendDecision(decision);
    const body = knowledge.get('decisions').body;
    expect(body.match(/Use CSS variables for theming/g)).toHaveLength(1);
    expect(body).toContain('approve — yes, variables');
  });

  it('linked documents: put, links, backlinks, catalogue, graph, delete', () => {
    const first = knowledge.putDoc(WORKER, 'project', 'payments-webhooks', '# Payments webhooks\n\nStripe events land in the API and are applied by a worker. Billing state: [[billing-data-model]].\n\n## Flow\n- verify, queue, apply\n', h.projectId);
    expect(first.unresolvedLinks).toEqual(['billing-data-model']);
    expect(first.orphan).toBe(true);
    const second = knowledge.putDoc(WORKER, 'project', 'billing-data-model', '# Billing data model\n\nTables the webhook worker updates. See [[payments-webhooks]].\n', h.projectId);
    expect(second.unresolvedLinks).toEqual([]);
    expect(second.backlinks).toBe(1);
    // the earlier dangling link now resolves
    const doc = knowledge.getDoc('project', 'payments-webhooks', h.projectId);
    expect(doc.linksTo).toEqual([{ slug: 'billing-data-model', path: 'projects/api/docs/billing-data-model.md', title: 'Billing data model' }]);
    expect(doc.linkedFrom.map((l) => l.slug)).toEqual(['billing-data-model']);
    expect(doc.summary).toContain('Stripe events land');
    // hub files link to documents too
    knowledge.note(WORKER, 'project', 'Documents', '[[payments-webhooks]] — the Stripe pipeline', h.projectId);
    const catalogue = knowledge.listDocs({ projectId: h.projectId });
    expect(catalogue.map((d) => d.slug).sort()).toEqual(['billing-data-model', 'payments-webhooks']);
    expect(catalogue.find((d) => d.slug === 'payments-webhooks')!.backlinks).toBe(2);
    const graph = knowledge.graph(h.projectId);
    expect(graph.nodes.some((n) => n.kind === 'hub' && n.scope === 'project')).toBe(true);
    expect(graph.edges).toContainEqual({ from: 'projects/api/PROJECT.md', to: 'projects/api/docs/payments-webhooks.md' });
    expect(graph.nodes.some((n) => n.scope === 'shared' || n.scope === 'decisions' || n.scope === 'workspace')).toBe(false);
    expect(existsSync(join(h.ctx.paths.knowledge, 'projects/api/docs/payments-webhooks.md'))).toBe(true);
    // rules
    expect(() => knowledge.putDoc(WORKER, 'project', 'Bad Slug', '# x\n', h.projectId)).toThrow(/kebab-case/);
    expect(() => knowledge.putDoc(WORKER, 'project', 'no-title', 'just text\n', h.projectId)).toThrow(/Title/);
    expect(() => knowledge.putDoc(WORKER, 'project', 'leak', '# Leak\n\nhttps://user:pass@host/db\n', h.projectId)).toThrow(/secrets/);
    knowledge.deleteDoc(HUMAN, 'project', 'billing-data-model', h.projectId);
    expect(knowledge.getDoc('project', 'payments-webhooks', h.projectId).linksTo[0]!.path).toBeNull();
    expect(() => knowledge.getDoc('project', 'billing-data-model', h.projectId)).toThrow(/does not exist/);
  });

  it('omits stub workspace hubs and hangs populated shared off the workspace hub', () => {
    knowledge.get('workspace');
    knowledge.get('decisions');
    knowledge.note(HUMAN, 'shared', 'Conventions', 'Ask instead of guessing when a decision changes scope.', null);
    knowledge.get('project', h.projectId);

    const unscoped = knowledge.graph();
    const ids = unscoped.nodes.map((n) => n.id);
    expect(ids).toContain('workspace/SHARED.md');
    expect(ids).toContain('workspace/WORKSPACE.md');
    expect(ids).not.toContain('workspace/decisions.md');
    expect(unscoped.edges).toContainEqual({ from: 'workspace/WORKSPACE.md', to: 'workspace/SHARED.md' });
    expect(unscoped.edges.some((e) => e.from === 'workspace/SHARED.md' || e.to === 'projects/api/PROJECT.md')).toBe(false);

    const scoped = knowledge.graph(h.projectId);
    expect(scoped.nodes.map((n) => n.id)).toEqual(['projects/api/PROJECT.md']);
  });

  it('omits every stub workspace hub when none have entries', () => {
    knowledge.get('workspace');
    knowledge.get('shared');
    knowledge.get('decisions');
    const g = knowledge.graph();
    expect(g.nodes.map((n) => n.id)).not.toEqual(expect.arrayContaining(['workspace/SHARED.md', 'workspace/decisions.md', 'workspace/WORKSPACE.md']));
  });

  it('keeps a stub workspace hub as parent when SHARED has notes', () => {
    knowledge.get('workspace');
    knowledge.note(HUMAN, 'shared', 'Conventions', 'House rules hold everywhere.', null);
    const g = knowledge.graph();
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['workspace/SHARED.md', 'workspace/WORKSPACE.md']);
    expect(g.edges).toEqual([{ from: 'workspace/WORKSPACE.md', to: 'workspace/SHARED.md' }]);
  });

  it('parseLinks ignores wiki links inside code spans and fenced blocks', () => {
    expect(parseLinks('Write `[[in-code]]` to link, as in [[real-doc]].')).toEqual(['real-doc']);
    expect(parseLinks('A ``span with [[nested]] `ticks` `` then [[after-span]].')).toEqual(['after-span']);
    expect(parseLinks('See [[before]].\n\n```md\n[[fenced-one]]\nsee [[fenced-two]] and [x](docs/fenced-three.md)\n```\n\nAnd [[after]].\n')).toEqual(['before', 'after']);
    expect(parseLinks('~~~\n[[tilde-fenced]]\n~~~\n[[outside]]\n')).toEqual(['outside']);
    // markdown links are stripped too, and an unmatched backtick stays literal prose
    expect(parseLinks('`[a](docs/coded.md)` but [b](docs/real.md)')).toEqual(['real']);
    expect(parseLinks('a ` stray tick and [[still-linked]]')).toEqual(['still-linked']);
  });

  it('a document that documents the link syntax reports no links', () => {
    const body = [
      '# Knowledge documents',
      '',
      'Link to another document with `[[slug]]`, or `[[slug|label]]` for a custom label.',
      '',
      '```md',
      'See [[run-engine]] for the turn loop.',
      '```',
      '',
      'The real reference is [[payments-webhooks]].',
      '',
    ].join('\n');
    // only the prose link is reported — none of `slug`, `slug|label` or the fenced example
    expect(knowledge.putDoc(WORKER, 'project', 'knowledge-documents', body, h.projectId).unresolvedLinks).toEqual(['payments-webhooks']);
    const doc = knowledge.getDoc('project', 'knowledge-documents', h.projectId);
    expect(doc.linksTo.map((l) => l.slug)).toEqual(['payments-webhooks']);
    expect(knowledge.listDocs({ projectId: h.projectId }).find((d) => d.slug === 'knowledge-documents')!.links).toBe(1);
  });
});
