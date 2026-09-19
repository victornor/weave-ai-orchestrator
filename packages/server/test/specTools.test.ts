/**
 * VS-578: the `weave_spec_*` tools against a project whose OpenSpec mode is off. Exercised through
 * `runTool`, the same entry the MCP endpoint uses, over the harness's real `createSpecsService`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createSpecsService } from '@weave-ai/core';
import type { ToolResult } from '@weave-ai/shared';
import { runTool, type ToolCtx } from '../src/tools.js';
import type { RunTokenClaims } from '../src/runtoken.js';
import { makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

const WEAVER: RunTokenClaims = { workspaceId: 'ws1', runId: 'run_c', agentId: 'ag_conductor', agentKind: 'weaver', projectId: null, ticketId: null, roleId: null };

describe('weave_spec_* on an OpenSpec-off project (VS-578)', () => {
  it('returns openspec_disabled rather than an empty list or not_found', async () => {
    const h = makeHarness(); harness = h;
    h.db.run("INSERT INTO projects (id, workspace_id, slug, name, git_url, default_branch, clone_path, max_workers, worktree_provider, openspec_enabled, policies_json, status, created_at, updated_at) VALUES ('proj1','ws1','api','API','git@example.com:acme/api.git','main','/tmp',4,'git',0,'{}','ready','t0','t0')");
    (h.runtime.services as { specs: unknown }).specs = createSpecsService(h.runtime.ctx, () => h.runtime.services);
    const ctx: ToolCtx = { ws: h.runtime, claims: WEAVER, actor: { kind: 'agent', id: 'ag_conductor', runId: 'run_c' } };

    const result = await runTool('weave_spec_get', ctx, { projectId: 'proj1', capability: 'auth' }) as ToolResult<never>;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('openspec_disabled');
  });
});
