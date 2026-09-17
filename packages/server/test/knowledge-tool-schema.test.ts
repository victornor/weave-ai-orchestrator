import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { runTokenSecret, signRunToken } from '../src/runtoken.js';
import { makeHarness, type Harness } from './fakes.js';

type ToolPayload = {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; details?: { issues?: Array<{ path: string; message: string }> } };
};

const workerClaims = {
  workspaceId: 'ws1', runId: 'knowledge-schema-run', agentId: 'ag_1', agentKind: 'worker' as const,
  projectId: 'proj1', ticketId: 'tk_1', roleId: 'role_1',
};

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

async function callTool(name: string, input: Record<string, unknown>): Promise<ToolPayload> {
  const token = await signRunToken(runTokenSecret(harness!.runtime.ctx.db), workerClaims);
  const app = createApp(harness!.deps);
  const response = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/agent/tools/${name}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ input }),
  }));
  return response.json() as Promise<ToolPayload>;
}

describe('published knowledge-tool schemas', () => {
  it('match the public handlers for every knowledge tool', async () => {
    harness = makeHarness({ listener: 'loopback' });
    harness.impls.workers.get = () => ({ worktreePath: null });
    harness.impls.knowledge.get = () => ({ tokenEstimate: 1, body: '# Project\n' });
    harness.impls.knowledge.note = () => ({ remainingTokens: 100 });
    harness.impls.knowledge.listDocs = () => [];
    harness.impls.knowledge.getDoc = () => ({ slug: 'schema-doc', body: '# Schema doc\n', tokenEstimate: 1, linksTo: [], linkedFrom: [] });
    harness.impls.knowledge.putDoc = () => ({ slug: 'schema-write', revision: 1, remainingTokens: 100 });
    harness.impls.knowledge.search = () => [];
    harness.impls.knowledge.semanticSearch = async () => [];
    harness.impls.knowledge.replace = () => ({ remainingTokens: 100 });

    const token = await signRunToken(runTokenSecret(harness.runtime.ctx.db), workerClaims);
    const app = createApp(harness.deps);
    const listResponse = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/agent/tools', {
      headers: { authorization: `Bearer ${token}` },
    }));
    const tools = await listResponse.json() as Array<{ name: string; inputSchema: { type: string; properties?: Record<string, unknown>; required?: string[] } }>;

    const expected = {
      weave_knowledge_get: { properties: ['scope', 'projectId'], required: ['scope'], input: { scope: 'project' } },
      weave_knowledge_note: { properties: ['scope', 'section', 'text', 'projectId', 'doc'], required: ['scope', 'section', 'text'], input: { scope: 'project', section: 'Learnings', text: 'schema contract' } },
      weave_knowledge_docs: { properties: ['scope', 'projectId'], required: [], input: {} },
      weave_knowledge_doc_get: { properties: ['slug', 'scope', 'projectId'], required: ['slug'], input: { slug: 'schema-doc', scope: 'project' } },
      weave_knowledge_doc_put: { properties: ['slug', 'body', 'scope', 'projectId', 'folder'], required: ['slug', 'body'], input: { slug: 'schema-write', body: '# Schema write\n', scope: 'project' } },
      weave_knowledge_search: { properties: ['query', 'limit'], required: ['query'], input: { query: 'schema' } },
      weave_knowledge_semantic_search: { properties: ['query', 'limit'], required: ['query'], input: { query: 'schema' } },
      weave_knowledge_replace: { properties: ['scope', 'body', 'projectId', 'supersedes'], required: ['scope', 'body'], input: { scope: 'project', body: '# Project\n' } },
    } as const;

    for (const [name, contract] of Object.entries(expected)) {
      const published = tools.find((tool) => tool.name === name);
      expect(published, `${name} must be published`).toBeDefined();
      expect(published!.inputSchema.type).toBe('object');
      expect(Object.keys(published!.inputSchema.properties ?? {}).sort()).toEqual([...contract.properties].sort());
      expect([...(published!.inputSchema.required ?? [])].sort()).toEqual([...contract.required].sort());

      const result = await callTool(name, contract.input);
      expect(result.ok, `${name} schema-shaped call should reach its handler: ${JSON.stringify(result)}`).toBe(true);
    }
  });

  it('keeps document reads on slug and identifies the expected field on mismatch', async () => {
    harness = makeHarness({ listener: 'loopback' });
    harness.impls.knowledge.getDoc = () => ({ slug: 'schema-doc', body: '# Schema doc\n', tokenEstimate: 1, linksTo: [], linkedFrom: [] });

    const valid = await callTool('weave_knowledge_doc_get', { slug: 'schema-doc', scope: 'project' });
    expect(valid.ok).toBe(true);
    expect(valid.data).toMatchObject({ slug: 'schema-doc' });

    const renamed = await callTool('weave_knowledge_doc_get', { key: 'schema-doc', scope: 'project' });
    expect(renamed.ok).toBe(false);
    expect(renamed.error?.code).toBe('validation');
    expect(renamed.error?.details?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'slug' }),
    ]));
  });
});
