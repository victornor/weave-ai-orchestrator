import { describe, expect, it } from 'vitest';
import type { KnowledgeGraph } from '../api/types';
import { buildModel, neighbourhood, neighboursOf } from '../lib/graph/model';
import { convexHull, hullPath } from '../lib/graph/hull';

function node(id: string, over: Partial<KnowledgeGraph['nodes'][number]> = {}): KnowledgeGraph['nodes'][number] {
  return {
    id,
    kind: 'doc',
    scope: 'shared',
    projectId: null,
    projectSlug: null,
    slug: id,
    title: id,
    tokens: 100,
    updatedAt: '2026-09-05T00:00:00.000Z',
    ...over,
  };
}

describe('buildModel', () => {
  it('counts distinct neighbours as the degree and lists both link directions', () => {
    const model = buildModel({
      nodes: [node('a'), node('b'), node('c')],
      edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }],
    });

    expect(model.byId.get('a')!.degree).toBe(2);
    expect(model.byId.get('b')!.degree).toBe(1);
    expect(model.outgoing.get('a')).toEqual(['b', 'c']);
    expect(model.incoming.get('b')).toEqual(['a']);
    expect(model.outgoing.get('b')).toEqual([]);
    expect([...neighboursOf(model, 'a')]).toEqual(['b', 'c']);
    expect([...neighbourhood(model, 'b')].sort()).toEqual(['a', 'b']);
  });

  it('collapses a reciprocal pair into one undirected edge', () => {
    const model = buildModel({
      nodes: [node('a'), node('b')],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
    });

    expect(model.edges).toHaveLength(1);
    expect(model.edges[0]!.directed).toBe(false);
    expect(model.byId.get('a')!.degree).toBe(1);
    expect(model.outgoing.get('a')).toEqual(['b']);
    expect(model.outgoing.get('b')).toEqual(['a']);
  });

  it('keeps a one-way link directed and pointing at its target', () => {
    const model = buildModel({ nodes: [node('z'), node('a')], edges: [{ from: 'z', to: 'a' }] });

    expect(model.edges).toEqual([{ id: 'a\u0000z', source: 'z', target: 'a', directed: true }]);
  });

  it('drops repeated links, self-links and links to pages that are not there', () => {
    const model = buildModel({
      nodes: [node('a'), node('b')],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'b' },
        { from: 'a', to: 'a' },
        { from: 'a', to: 'gone' },
      ],
    });

    expect(model.edges).toHaveLength(1);
    expect(model.byId.get('a')!.degree).toBe(1);
    expect(model.outgoing.get('a')).toEqual(['b']);
  });

  it('groups by project when there is one and by scope otherwise', () => {
    const model = buildModel({
      nodes: [
        node('p', { scope: 'project', projectId: 'p1', projectSlug: 'api' }),
        node('s', { scope: 'shared' }),
      ],
      edges: [],
    });

    expect(model.byId.get('p')!.group).toBe('api');
    expect(model.byId.get('s')!.group).toBe('shared');
    expect(model.groups).toEqual(['api', 'shared']);
  });
});

describe('hull', () => {
  it('returns the corners of a triangle', () => {
    const hull = convexHull([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }]);
    expect(hull).toHaveLength(3);
  });

  it('reduces a collinear run to its two ends', () => {
    const hull = convexHull([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }]);
    expect(hull).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  });

  it('ignores an interior point', () => {
    const hull = convexHull([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 5, y: 5 }]);
    expect(hull).toHaveLength(4);
  });

  it('draws no region for a group of one', () => {
    expect(hullPath([{ x: 3, y: 4 }], 20)).toBeNull();
  });

  it('draws a region for two nodes sitting on the same spot', () => {
    const d = hullPath([{ x: 3, y: 4 }, { x: 3, y: 4 }], 20);
    expect(d).toMatch(/^M/);
    expect(d).toMatch(/Z$/);
  });

  it('pads the region out past the nodes it encloses', () => {
    const d = hullPath([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 20, y: 30 }], 24)!;
    const xs = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(40);
  });
});
