import { describe, expect, it } from 'vitest';
import { buildModel } from './model';
import { circleIntersection, linksFor, nodeRadius, reconcileNodes, suppressedLabels, type CanvasNode } from './nodes';
import type { KnowledgeGraph } from '../../api/types';

function graph(ids: string[], edges: Array<[string, string]>, hubs: string[] = []): KnowledgeGraph {
  return {
    nodes: ids.map((id) => ({
      id,
      kind: hubs.includes(id) ? 'hub' as const : 'doc' as const,
      scope: 'shared',
      projectId: null,
      projectSlug: null,
      slug: id,
      title: id,
      tokens: 100,
      updatedAt: '',
    })),
    edges: edges.map(([from, to]) => ({ from, to })),
  };
}

describe('nodeRadius', () => {
  it('grows with degree and caps out', () => {
    const low = nodeRadius({ kind: 'doc', degree: 1 });
    const high = nodeRadius({ kind: 'doc', degree: 50 });
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(16);
  });

  it('gives a hub a head start over a document of the same degree', () => {
    expect(nodeRadius({ kind: 'hub', degree: 3 })).toBeGreaterThan(nodeRadius({ kind: 'doc', degree: 3 }));
  });
});

describe('circleIntersection', () => {
  it('lands exactly on the circle boundary toward the target', () => {
    const p = circleIntersection(0, 0, 5, 10, 0);
    expect(p).toEqual({ x: 5, y: 0 });
  });

  it('handles an arrival from any angle, not just axis-aligned', () => {
    const p = circleIntersection(0, 0, 10, 0, -10);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 5);
  });
});

describe('reconcileNodes', () => {
  it('keeps the same object, and its position, for a node that survives a refetch', () => {
    const model = buildModel(graph(['a', 'b'], [['a', 'b']]));
    const first = reconcileNodes([], model, { x: 0, y: 0 });
    first[0]!.x = 123;
    first[0]!.y = 456;

    const second = reconcileNodes(first, model, { x: 0, y: 0 });
    const a = second.find((n) => n.id === 'a')!;
    expect(a).toBe(first[0]);
    expect(a.x).toBe(123);
    expect(a.y).toBe(456);
  });

  it('seeds a newly-added node near the placed neighbour it links to', () => {
    const before = buildModel(graph(['a', 'b'], [['a', 'b']]));
    const prev = reconcileNodes([], before, { x: 0, y: 0 });
    prev.find((n) => n.id === 'a')!.x = 200;
    prev.find((n) => n.id === 'a')!.y = 200;

    const after = buildModel(graph(['a', 'b', 'c'], [['a', 'b'], ['a', 'c']]));
    const next = reconcileNodes(prev, after, { x: 0, y: 0 });
    const c = next.find((n) => n.id === 'c')!;
    expect(Math.hypot(c.x - 200, c.y - 200)).toBeLessThan(50);
  });

  it('drops a node that is no longer in the model', () => {
    const model = buildModel(graph(['a', 'b'], [['a', 'b']]));
    const prev = reconcileNodes([], model, { x: 0, y: 0 });
    const shrunk = buildModel(graph(['a'], []));
    const next = reconcileNodes(prev, shrunk, { x: 0, y: 0 });
    expect(next.map((n) => n.id)).toEqual(['a']);
  });
});

describe('linksFor', () => {
  it('carries the model edges through with their id/source/target/directed shape', () => {
    const model = buildModel(graph(['a', 'b'], [['a', 'b']]));
    expect(linksFor(model)).toEqual([{ id: model.edges[0]!.id, source: 'a', target: 'b', directed: true }]);
  });
});

describe('suppressedLabels', () => {
  function node(id: string, x: number, y: number, over: Partial<CanvasNode> = {}): CanvasNode {
    return { id, title: id, kind: 'doc', group: 'g', degree: 1, radius: 6, x, y, ...over };
  }

  it('suppresses nothing when nodes are far apart', () => {
    const suppressed = suppressedLabels([node('a', 0, 0), node('b', 500, 500)]);
    expect(suppressed.size).toBe(0);
  });

  it('suppresses the lower-degree node when two crowd each other', () => {
    const a = node('a', 0, 0, { degree: 5 });
    const b = node('b', 5, 0, { degree: 1 });
    const suppressed = suppressedLabels([a, b]);
    expect(suppressed.has('b')).toBe(true);
    expect(suppressed.has('a')).toBe(false);
  });

  it('never suppresses a hub sharing a position with a document', () => {
    const hub = node('hub', 0, 0, { kind: 'hub', degree: 1 });
    const doc = node('doc', 3, 0, { kind: 'doc', degree: 20 });
    const suppressed = suppressedLabels([hub, doc]);
    expect(suppressed.has('hub')).toBe(false);
  });

  it('never suppresses a node the reader is pointing at or has selected', () => {
    const hovered = node('hovered', 0, 0, { degree: 1 });
    const other = node('other', 3, 0, { degree: 50 });
    const suppressed = suppressedLabels([hovered, other], new Set(['hovered']));
    expect(suppressed.has('hovered')).toBe(false);
    expect(suppressed.has('other')).toBe(true);
  });
});
