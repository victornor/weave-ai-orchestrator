/**
 * `weave_role_update` — the weaver's role spec edit (VS-335). Exercised through `runTool`, the same
 * entry the MCP endpoint and the agent route use, against the real roles service over the harness's
 * real sqlite db.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRolesService } from '@weave-ai/core';
import { nowIso } from '@weave-ai/db';
import type { RoleSpec, ToolResult } from '@weave-ai/shared';
import { runTool, type ToolCtx } from '../src/tools.js';
import type { RunTokenClaims } from '../src/runtoken.js';
import { makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

const CONDUCTOR: RunTokenClaims = { workspaceId: 'ws1', runId: 'run_c', agentId: 'ag_conductor', agentKind: 'weaver', projectId: null, ticketId: null, roleId: null };
const WORKER: RunTokenClaims = { workspaceId: 'ws1', runId: 'run_w', agentId: 'ag_worker', agentKind: 'worker', projectId: 'proj1', ticketId: null, roleId: 'backend' };

const specs: Record<string, RoleSpec> = {};

async function seed(h: Harness): Promise<void> {
  // A real temp directory: the roles service writes role.yaml and CHARTER.md relative to ctx.paths.roles,
  // and the fake harness points that at '' so nothing leaks into the repo.
  h.runtime.ctx.paths.roles = mkdtempSync(join(tmpdir(), 'vs335-roles-'));
  h.db.insert('projects', {
    id: 'proj1', workspaceId: 'ws1', slug: 'api', name: 'API', gitUrl: '', defaultBranch: 'main',
    clonePath: h.runtime.ctx.paths.roles, maxWorkers: 4, worktreeProvider: 'git', openspecEnabled: 1,
    policiesJson: {}, status: 'ready', createdAt: nowIso(), updatedAt: nowIso(),
  });
  h.runtime.services.roles = createRolesService(h.runtime.ctx, () => h.runtime.services);
  specs.backend = {
    id: 'backend', name: 'Backend Engineer', project: 'api',
    charterSummary: 'Owns the api service.', scope: 'Backend work in the api repo.',
    responsibilities: [], capabilities: [], exclusions: [], rules: [],
    sessionPolicy: 'per_ticket', maxWorkers: 2,
    permission: { mode: 'auto', allowed: [], denied: [] }, secrets: [], createdBy: 'weaver',
  };
  await h.runtime.services.roles.hire({ kind: 'agent', id: 'ag_conductor', runId: 'run_c' }, specs.backend!, { autoActivate: true });
}

const ctxFor = (h: Harness, claims: RunTokenClaims): ToolCtx =>
  ({ ws: h.runtime, claims, actor: { kind: 'agent', id: claims.agentId, runId: claims.runId } });
const call = (h: Harness, input: unknown, claims: RunTokenClaims = CONDUCTOR): Promise<ToolResult<Record<string, unknown>>> =>
  runTool('weave_role_update', ctxFor(h, claims), input) as Promise<ToolResult<Record<string, unknown>>>;

describe('weave_role_update (VS-335)', () => {
  it('edits the spec as one role revision and reports the changed keys', async () => {
    const h = makeHarness(); harness = h; await seed(h);
    const res = await call(h, { id: 'backend', patch: { charterSummary: 'Owns billing now.', scope: 'Billing only.' }, reason: 'the role changed' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.changedKeys).toEqual(['charterSummary', 'scope']);
    expect(res.data.applied).toBe(true);
    const role = h.db.get<{ charterSummary: string; scopeText: string }>('SELECT charter_summary AS charterSummary, scope_text AS scopeText FROM roles WHERE id = ?', ['backend'])!;
    expect(role.charterSummary).toBe('Owns billing now.');
    expect(role.scopeText).toBe('Billing only.');
  });

  it('refuses a worker token', async () => {
    const h = makeHarness(); harness = h; await seed(h);
    const res = await call(h, { id: 'backend', patch: { charterSummary: 'nope' }, reason: 'nope' }, WORKER);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('forbidden');
  });

  it('refuses immutable, separately-owned and unknown patch keys', async () => {
    const h = makeHarness(); harness = h; await seed(h);
    for (const patch of [{ id: 'other' }, { project: 'other' }, { secrets: ['X'] }, { maxWorkers: 3 }, { nope: true }, {}]) {
      const res = await call(h, { id: 'backend', patch, reason: 'nope' });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('validation');
    }
  });
});
