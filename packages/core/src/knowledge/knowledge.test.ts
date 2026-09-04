import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { estimateTokens } from '@agent-conductor/shared';
import { makeHarness, fakeWake, type TestHarness } from '../testing/context.js';
import { createKnowledgeService } from './service.js';
import { BUDGETS } from './files.js';
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
    for (const s of ['## Overview', '## Stack & commands', '## Conventions', '## Current focus', '## Landmines', '## Learnings']) {
      expect(project.body).toContain(s);
    }
    expect(project.budgetTokens).toBe(BUDGETS.project);
    expect(knowledge.get('shared').budgetTokens).toBe(BUDGETS.shared);
    expect(knowledge.get('workspace').body).toContain('## Portfolio');
    expect(knowledge.get('decisions').body).toContain('## Decisions');
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
});
