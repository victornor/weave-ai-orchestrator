/**
 * VS-360: `putDocument`'s optional `mirror` — the worker-write-path and repo-write-boundary
 * mechanics inside `packages/core/src/tickets/service.ts`, tested directly against the core service
 * rather than through the HTTP tool layer (`packages/server/test/integration.test.ts` covers the
 * end-to-end tool behavior, including republish-replaces and the weaver's structural isolation).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId } from '@weave-ai/db';
import { makeHarness, fakeWake, fakeSpecs, type TestHarness } from '../testing/context.js';
import { createTicketsService } from './service.js';
import type { Actor, TicketsService } from '../api.js';

const AGENT: Actor = { kind: 'agent', id: 'agent-1', runId: 'run-1' };
const HUMAN: Actor = { kind: 'human', id: 'victor' };

describe('putDocument artifact mirror (VS-360)', () => {
  let h: TestHarness;
  let tickets: TicketsService;
  let worktreePath: string;

  beforeEach(() => {
    h = makeHarness();
    h.services.wake = fakeWake() as never;
    h.services.decisions = { create: vi.fn(() => ({ id: newId() })), supersedeForTarget: vi.fn(() => 0), withdrawForTicket: vi.fn(() => 0) } as never;
    h.services.openspec = {
      validateForProposed: vi.fn(async () => ({ ok: true as const, plan: '# Plan\n\n## Proposal\nbody' })),
      archiveAfterMerge: vi.fn(async () => ({ archivedAs: null, skipped: 'no change' })),
    } as never;
    h.services.specs = fakeSpecs() as never;
    h.services.workers = {
      spawnForTicket: vi.fn(async (_a: Actor, ticketId: string) => ({ id: h.addWorker(ticketId) })),
      retireIfLanded: vi.fn(async () => ({ retired: true })),
    } as never;
    tickets = createTicketsService(h.ctx, h.deps);
    h.services.tickets = tickets;
    worktreePath = mkdtempSync(join(tmpdir(), 'ac-artifact-mirror-'));
  });
  afterEach(async () => { await tickets.stop(); h.cleanup(); });

  function ticket(title = 'Publish an artifact') {
    return tickets.create(HUMAN, { kind: 'task', title, projectId: h.projectId, assigneeRoleId: h.roleId });
  }

  it('writes exactly the expected two files at the expected path when mirror is set', () => {
    const t = ticket();
    const html = '<html><body>v1</body></html>';
    tickets.putDocument(AGENT, t.id, 'artifact:overview', html, { system: true, mirror: { worktreePath, title: 'Overview', kind: 'diagram' } });

    const htmlPath = join(worktreePath, '.weave', 'artifacts', t.identifier, 'overview.html');
    const metaPath = join(worktreePath, '.weave', 'artifacts', t.identifier, 'overview.meta.json');
    expect(readFileSync(htmlPath, 'utf8')).toBe(html);
    expect(JSON.parse(readFileSync(metaPath, 'utf8'))).toEqual({ title: 'Overview', kind: 'diagram' });
  });

  it('writes nothing extra when mirror is omitted', () => {
    const t = ticket();
    tickets.putDocument(AGENT, t.id, 'artifact:overview', '<html><body>v1</body></html>', { system: true });
    expect(existsSync(join(worktreePath, '.weave'))).toBe(false);
  });

  it('refuses a secret-shaped body when mirror is set, recording nothing', () => {
    const t = ticket();
    const secretHtml = `<html><body>${'-'.repeat(0)}-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----</body></html>`;
    expect(() => tickets.putDocument(AGENT, t.id, 'artifact:leaky', secretHtml, { system: true, mirror: { worktreePath } })).toThrow(/secret/);
    expect(tickets.documents(t.id)).toHaveLength(0);
    expect(existsSync(join(worktreePath, '.weave'))).toBe(false);
  });

  it('accepts the identical secret-shaped body unchanged when mirror is omitted', () => {
    const t = ticket();
    const secretHtml = '<html><body>-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----</body></html>';
    expect(() => tickets.putDocument(AGENT, t.id, 'artifact:leaky', secretHtml, { system: true })).not.toThrow();
  });

  it('refuses to mirror at a path outside the publishing ticket\'s own identifier (internal misuse)', () => {
    const t = ticket();
    // `key` here is shaped so it could never have passed `weave_ticket_artifact_put`'s own Zod schema
    // (which is the real defense) — this proves `repoArtifactPath`'s own re-check independently.
    expect(() => tickets.putDocument(AGENT, t.id, 'artifact:BAD KEY!', '<html><body>x</body></html>', { system: true, mirror: { worktreePath } }))
      .toThrow(/not the shape/);
    expect(existsSync(join(worktreePath, '.weave'))).toBe(false);
  });
});
