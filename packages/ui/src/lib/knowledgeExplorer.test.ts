import { describe, expect, it } from 'vitest';
import { buildExplorerTree, hubFileName, type ExplorerHub } from './knowledgeExplorer';
import type { KnowledgeDocSummary } from '../api/types';

function doc(over: Partial<KnowledgeDocSummary>): KnowledgeDocSummary {
  return {
    path: 'projects/api/docs/x.md', scope: 'project', projectId: 'p1', projectSlug: 'api', slug: 'x', folder: null,
    title: 'X', summary: '', tokenEstimate: 1, budgetTokens: 1, links: 0, backlinks: 0, updatedAt: '2026-09-11T00:00:00Z',
    ...over,
  };
}

describe('buildExplorerTree', () => {
  it('places a flat document at the project root, alongside its hub', () => {
    const hubs: ExplorerHub[] = [{ scope: 'project', projectId: 'p1', projectSlug: 'api' }];
    const docs = [doc({ path: 'projects/api/docs/run-engine.md', slug: 'run-engine', folder: null, title: 'Run engine' })];
    const tree = buildExplorerTree(docs, hubs);
    expect(tree).toHaveLength(1);
    const root = tree[0]!;
    expect(root.label).toBe('api');
    expect(root.children.map((c) => c.kind)).toEqual(['hub', 'doc']);
    expect(root.children[0]!.label).toBe('PROJECT.md');
    expect(root.children[1]!.label).toBe('Run engine');
  });

  it('reaches a document nested two folders deep through its folder chain', () => {
    const docs = [doc({ path: 'projects/api/docs/runbooks/incidents/retry-policy.md', slug: 'retry-policy', folder: 'runbooks/incidents', title: 'Retry policy' })];
    const tree = buildExplorerTree(docs, []);
    const root = tree[0]!;
    const runbooks = root.children.find((c) => c.kind === 'folder' && c.label === 'runbooks')!;
    expect(runbooks).toBeTruthy();
    const incidents = runbooks.children.find((c) => c.kind === 'folder' && c.label === 'incidents')!;
    expect(incidents).toBeTruthy();
    expect(incidents.children).toHaveLength(1);
    expect(incidents.children[0]!.kind).toBe('doc');
    expect(incidents.children[0]!.label).toBe('Retry policy');
  });

  it('groups two documents sharing a folder under the same node instead of duplicating it', () => {
    const docs = [
      doc({ path: 'projects/api/docs/runbooks/a.md', slug: 'a', folder: 'runbooks', title: 'A' }),
      doc({ path: 'projects/api/docs/runbooks/b.md', slug: 'b', folder: 'runbooks', title: 'B' }),
    ];
    const tree = buildExplorerTree(docs, []);
    const folders = tree[0]!.children.filter((c) => c.kind === 'folder' && c.label === 'runbooks');
    expect(folders).toHaveLength(1);
    expect(folders[0]!.children.map((c) => c.label)).toEqual(['A', 'B']);
  });

  it('gives shared and workspace their own roots, distinct from any project', () => {
    const hubs: ExplorerHub[] = [
      { scope: 'shared', projectId: null, projectSlug: null },
      { scope: 'workspace', projectId: null, projectSlug: null },
    ];
    const docs = [doc({ path: 'workspace/shared/guides/onboarding.md', scope: 'shared', projectId: null, projectSlug: null, slug: 'onboarding', folder: 'guides', title: 'Onboarding' })];
    const tree = buildExplorerTree(docs, hubs);
    expect(tree.map((r) => r.label).sort()).toEqual(['shared', 'workspace']);
    const shared = tree.find((r) => r.label === 'shared')!;
    expect(shared.children.map((c) => c.kind)).toEqual(['hub', 'folder']);
  });

  it('sorts hub first, then folders, then documents, alphabetically within each rank', () => {
    const hubs: ExplorerHub[] = [{ scope: 'project', projectId: 'p1', projectSlug: 'api' }];
    const docs = [
      doc({ path: 'projects/api/docs/zeta.md', slug: 'zeta', folder: null, title: 'Zeta' }),
      doc({ path: 'projects/api/docs/beta/x.md', slug: 'x', folder: 'beta', title: 'X' }),
      doc({ path: 'projects/api/docs/alpha/y.md', slug: 'y', folder: 'alpha', title: 'Y' }),
    ];
    const tree = buildExplorerTree(docs, hubs);
    expect(tree[0]!.children.map((c) => c.label)).toEqual(['PROJECT.md', 'alpha', 'beta', 'Zeta']);
  });

  it('a document that resolves to no hub for its scope still appears', () => {
    const docs = [doc({ folder: null })];
    const tree = buildExplorerTree(docs, []);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.children.map((c) => c.kind)).toEqual(['doc']);
  });
});

describe('hubFileName', () => {
  it('names each hub scope its real file', () => {
    expect(hubFileName('project')).toBe('PROJECT.md');
    expect(hubFileName('shared')).toBe('SHARED.md');
    expect(hubFileName('decisions')).toBe('decisions.md');
    expect(hubFileName('workspace')).toBe('WORKSPACE.md');
  });
});
