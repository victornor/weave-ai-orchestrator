/**
 * The changelog is a record for the human, not memory for the agents. It is allowed to grow without
 * bound precisely because nothing ever puts it in a context window, so that guarantee has to be
 * asserted rather than assumed: these tests build the same digests and briefs twice — once in a
 * workspace whose changelog is empty and once in one with a year of entries — and require them to be
 * byte-identical.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@weave-ai/db';
import { COMMON_TOOLS, WEAVER_TOOLS } from '@weave-ai/shared';
import { makeHarness, fakeWake, type TestHarness } from '../testing/context.js';
import { createKnowledgeService } from '../knowledge/service.js';
import { renderBrief } from '../prompts/index.js';
import { createChangelogService } from './index.js';
import type { KnowledgeService } from '../api.js';

/** A distinctive string: if any of it ever leaked into a prompt, a substring check would find it. */
const MARKER = 'ZZQX-changelog-must-never-be-injected';

describe('the changelog never reaches an agent', () => {
  let h: TestHarness;
  let knowledge: KnowledgeService;

  beforeEach(() => {
    h = makeHarness();
    const wake = fakeWake();
    h.services.wake = wake as never;
    h.services.workers = { spawnCurator: vi.fn(), conductor: vi.fn(() => ({ id: h.conductorId })) } as never;
    knowledge = createKnowledgeService(h.ctx, h.deps);
    h.services.knowledge = knowledge;
  });
  afterEach(() => h.cleanup());

  /** A year of changelog-producing activity, every entry carrying the marker somewhere. */
  function seedChangelog(): void {
    for (let i = 0; i < 200; i += 1) {
      const ticketId = newId();
      h.db.insert('tickets', {
        id: ticketId, workspaceId: h.workspaceId, projectId: h.projectId, number: 1000 + i, identifier: `TST-${1000 + i}`,
        kind: 'change', title: `${MARKER} ticket ${i}`, createdByKind: 'human', createdAt: 't0', updatedAt: 't0',
      });
      for (const action of ['ticket.create', 'ticket.delivery_landed', 'ticket.cancel']) {
        h.db.insert('activity', {
          id: newId(), workspaceId: h.workspaceId, actorKind: 'human', actorId: MARKER, entityType: 'ticket',
          entityId: ticketId, ticketId, projectId: h.projectId, detailsJson: { reason: MARKER },
          action, createdAt: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString(),
        });
      }
    }
    // The record really is there, so an identical digest below means it was excluded, not absent.
    expect(createChangelogService(h.ctx, h.deps).list({ limit: 200 }).entries.length).toBe(200);
  }

  const workerId = () => h.addWorker(null);

  it('leaves a worker bootstrap digest byte-identical and the same size', () => {
    const worker = workerId();
    const before = knowledge.bootstrapDigest(worker);
    seedChangelog();
    const after = knowledge.bootstrapDigest(worker);
    expect(after.text).toBe(before.text);
    expect(after.tokens).toBe(before.tokens);
    expect(after.text).not.toContain(MARKER);
  });

  it('leaves the conductor bootstrap digest byte-identical', () => {
    const before = knowledge.bootstrapDigest(h.conductorId);
    seedChangelog();
    const after = knowledge.bootstrapDigest(h.conductorId);
    expect(after.text).toBe(before.text);
    expect(after.tokens).toBe(before.tokens);
    expect(after.text).not.toContain(MARKER);
  });

  it('keeps it out of a worker brief', () => {
    const ticketId = newId();
    h.db.insert('tickets', {
      id: ticketId, workspaceId: h.workspaceId, projectId: h.projectId, number: 1, identifier: 'TST-1', kind: 'change',
      title: 'Add dark mode', status: 'todo', createdByKind: 'human', createdAt: 't0', updatedAt: 't0',
    });
    const worker = h.addWorker(ticketId);
    const agent = h.db.get<Record<string, unknown>>('SELECT * FROM agents WHERE id = ?', [worker])!;
    h.services.tickets = { get: (id: string) => h.db.get('SELECT * FROM tickets WHERE id = ?', [id]) } as never;

    const before = renderBrief(h.ctx, h.deps, agent as never);
    seedChangelog();
    const after = renderBrief(h.ctx, h.deps, agent as never);
    expect(after).toBe(before);
    expect(after).not.toContain(MARKER);
  });

  it('is invisible to the knowledge surfaces: no file, no budget, no search hit', () => {
    seedChangelog();
    // Every knowledge file the workspace has, and none of them is the changelog.
    for (const row of knowledge.lint()) {
      expect(row.path).not.toMatch(/changelog/i);
    }
    expect(knowledge.search(MARKER)).toEqual([]);
    expect(knowledge.search('changelog')).toEqual([]);
    expect(h.db.all("SELECT path FROM knowledge_files WHERE path LIKE '%hangelog%'")).toEqual([]);
  });

  it('has no agent-facing tool that could reach it', () => {
    const tools = [...COMMON_TOOLS, ...WEAVER_TOOLS];
    expect(tools.filter((t) => /changelog|activity/i.test(t))).toEqual([]);
  });

  it('is not a knowledge scope, so no budget or curation applies to it', async () => {
    seedChangelog();
    // Every scope the knowledge service knows; none of them is the changelog.
    for (const scope of ['workspace', 'shared', 'decisions'] as const) {
      expect(knowledge.get(scope).path).not.toMatch(/changelog/i);
    }
    expect(knowledge.get('project', h.projectId).body).not.toContain(MARKER);
    // Curating everything rewrites no changelog entry: the count is untouched.
    const before = h.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM activity')!.n;
    await knowledge.requestCuration({ kind: 'human', id: 'victor' }, 'project', h.projectId).catch(() => undefined);
    expect(h.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM activity')!.n).toBeGreaterThanOrEqual(before);
    expect(createChangelogService(h.ctx, h.deps).list({ limit: 200 }).entries.length).toBe(200);
  });
});
