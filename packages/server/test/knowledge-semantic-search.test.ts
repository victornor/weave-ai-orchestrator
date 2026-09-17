import { describe, expect, it } from 'vitest';
import { TOOLS, type ToolCtx } from '../src/tools.js';

/**
 * VS-493: the semantic search tool must be scoped exactly as the keyword tool is. These tests drive
 * the real tool handler with a stubbed knowledge service returning hits from three scopes, and
 * assert what a worker can and cannot see.
 */
const tool = TOOLS.find((t) => t.name === 'weave_knowledge_semantic_search')!;

const HITS = [
  { ref: 'projects/api/docs/run-engine.md', scope: 'project', projectId: 'api', title: 'Run engine', section: 'Landmines', kind: 'entry', text: 'own project', score: 0.9 },
  { ref: 'projects/other/docs/run-engine.md', scope: 'project', projectId: 'other', title: 'Other', section: 'Landmines', kind: 'entry', text: 'another project', score: 0.8 },
  { ref: 'workspace/WORKSPACE.md', scope: 'workspace', projectId: null, title: 'Workspace', section: null, kind: 'section', text: 'workspace only', score: 0.7 },
  { ref: 'workspace/decisions.md', scope: 'decisions', projectId: null, title: 'Decisions', section: 'Decisions', kind: 'entry', text: 'decisions only', score: 0.6 },
  { ref: 'workspace/docs/policy.md', scope: 'workspace', projectId: null, title: 'Policy', section: null, kind: 'entry', text: 'workspace doc', score: 0.5 },
  { ref: 'workspace/shared/conventions.md', scope: 'shared', projectId: null, title: 'Conventions', section: null, kind: 'entry', text: 'shared', score: 0.4 },
];

function ctxFor(agentKind: string, projectId: string | null): ToolCtx {
  return {
    ws: { services: { knowledge: { semanticSearch: async (_q: string, projectId: string | null) => HITS.filter((h) => !projectId || h.projectId === projectId || h.projectId === null) } } },
    claims: { agentKind, projectId },
    actor: { kind: 'agent', id: 'agent-1' },
    incidents: {},
  } as unknown as ToolCtx;
}

const refs = (hits: unknown): string[] => (hits as Array<{ ref: string }>).map((h) => h.ref);

describe('weave_knowledge_semantic_search scoping (VS-493)', () => {
  it('is registered as an agent tool', () => {
    expect(tool).toBeDefined();
    expect(tool!.scope).toBe('all');
  });

  it('a worker sees its own project and shared knowledge only', async () => {
    const hits = await tool!.handler(ctxFor('worker', 'api'), { query: 'run engine' });
    expect(refs(hits).sort()).toEqual(['projects/api/docs/run-engine.md', 'workspace/shared/conventions.md']);
  });

  it('a worker never sees another project or workspace-only knowledge', async () => {
    const hits = refs(await tool!.handler(ctxFor('worker', 'api'), { query: 'anything' }));
    expect(hits).not.toContain('projects/other/docs/run-engine.md');
    expect(hits.some((ref) => ref.startsWith('workspace/WORKSPACE'))).toBe(false);
    expect(hits.some((ref) => ref.startsWith('workspace/decisions'))).toBe(false);
    expect(hits.some((ref) => ref.startsWith('workspace/docs/'))).toBe(false);
  });

  it('the weaver reaches every scope', async () => {
    const hits = await tool!.handler(ctxFor('weaver', null), { query: 'anything' });
    expect(refs(hits)).toHaveLength(HITS.length);
  });
});
