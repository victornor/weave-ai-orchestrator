import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('rejects over-budget writes, flags curation and spawns a curation worker', async () => {
    const filler = Array.from({ length: 400 }, (_, i) => `- 2026-01-01 · durable fact number ${i} about the project internals`).join('\n');
    knowledge.replace(HUMAN, 'project', `# API\n\n## Learnings\n${filler}\n`, 'human', h.projectId);
    expect(() => knowledge.note(WORKER, 'project', 'Learnings', 'One more thing worth remembering here.', h.projectId))
      .toThrowError(expect.objectContaining({ code: 'budget_exceeded' }));
    await tick();
    expect(knowledge.get('project', h.projectId).curationPending).toBe(true);
    expect(workers.spawnCurator).toHaveBeenCalledWith(expect.objectContaining({ kind: 'system' }), h.projectId);
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
    expect(existsSync(join(h.ctx.paths.knowledge, 'projects/api/docs/payments-webhooks.md'))).toBe(true);
    // rules
    expect(() => knowledge.putDoc(WORKER, 'project', 'Bad Slug', '# x\n', h.projectId)).toThrow(/kebab-case/);
    expect(() => knowledge.putDoc(WORKER, 'project', 'no-title', 'just text\n', h.projectId)).toThrow(/Title/);
    expect(() => knowledge.putDoc(WORKER, 'project', 'leak', '# Leak\n\nhttps://user:pass@host/db\n', h.projectId)).toThrow(/secrets/);
    knowledge.deleteDoc(HUMAN, 'project', 'billing-data-model', h.projectId);
    expect(knowledge.getDoc('project', 'payments-webhooks', h.projectId).linksTo[0]!.path).toBeNull();
    expect(() => knowledge.getDoc('project', 'billing-data-model', h.projectId)).toThrow(/does not exist/);
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
