import { describe, expect, it } from 'vitest';
import type { KnowledgeGraph } from '../api/types';
import { buildModel } from '../lib/graph/model';
import { createSimulation, reconcileNodes, type SimNode } from '../lib/graph/simulation';

const SIZE = { width: 800, height: 500 };
const CENTRE = { x: 400, y: 250 };

function graph(ids: string[], edges: Array<[string, string]>): KnowledgeGraph {
  return {
    nodes: ids.map((id) => ({ id, kind: 'doc' as const, scope: 'shared', projectId: null, projectSlug: null, slug: id, title: id, tokens: 100, updatedAt: '' })),
    edges: edges.map(([from, to]) => ({ from, to })),
  };
}

/** Two clusters joined by a single link: linked nodes should end up closer than unlinked ones. */
const CLUSTERED = graph(
  ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'],
  [['a1', 'a2'], ['a2', 'a3'], ['a3', 'a1'], ['b1', 'b2'], ['b2', 'b3'], ['b3', 'b1'], ['a1', 'b1']],
);

function distance(nodes: readonly SimNode[], a: string, b: string): number {
  const na = nodes.find((n) => n.id === a)!;
  const nb = nodes.find((n) => n.id === b)!;
  return Math.hypot(na.x - nb.x, na.y - nb.y);
}

describe('the simulation', () => {
  it('pulls linked nodes together and pushes unlinked ones apart', () => {
    const sim = createSimulation(buildModel(CLUSTERED), SIZE, { animated: false });
    sim.settle();

    const nodes = sim.nodes();
    expect(distance(nodes, 'a1', 'a2')).toBeLessThan(distance(nodes, 'a2', 'b2'));
    expect(distance(nodes, 'b1', 'b2')).toBeLessThan(distance(nodes, 'a3', 'b3'));
    sim.destroy();
  });

  it('settles synchronously and leaves nothing running', () => {
    const sim = createSimulation(buildModel(CLUSTERED), SIZE, { animated: false });
    let ticks = 0;
    sim.onTick(() => { ticks++; });

    sim.settle();

    expect(ticks).toBeGreaterThan(0);
    expect(sim.isRunning()).toBe(false);
    sim.destroy();
  });

  it('holds a pinned node still while the rest of the graph moves', () => {
    const sim = createSimulation(buildModel(CLUSTERED), SIZE, { animated: false });
    sim.settle();
    sim.pin('a1');
    const pinned = { ...sim.node('a1')! };
    const before = { ...sim.node('b3')! };

    sim.drag('b3', 20, 20);
    sim.endDrag('b3');

    expect(sim.isPinned('a1')).toBe(true);
    expect(sim.node('a1')!.x).toBe(pinned.x);
    expect(sim.node('a1')!.y).toBe(pinned.y);
    expect(sim.node('b3')!.x).not.toBe(before.x);
    sim.destroy();
  });

  it('lets a released node settle again once it is unpinned', () => {
    const sim = createSimulation(buildModel(CLUSTERED), SIZE, { animated: false });
    sim.settle();
    sim.drag('a2', 5, 5);
    sim.endDrag('a2');
    expect(sim.node('a2')!.fx).toBeFalsy();

    sim.pin('a3');
    expect(sim.node('a3')!.fx).toBe(sim.node('a3')!.x);
    sim.unpin('a3');
    expect(sim.isPinned('a3')).toBe(false);
    expect(sim.node('a3')!.fx).toBeNull();
    sim.destroy();
  });

  it('keeps neighbouring chips from overlapping after settle', () => {
    const sim = createSimulation(buildModel(CLUSTERED), SIZE, { animated: false });
    sim.settle();
    const nodes = sim.nodes();
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.radius + b.radius);
      }
    }
    sim.destroy();
  });

  it('forgets the pin of a node that has left the graph', () => {
    const sim = createSimulation(buildModel(CLUSTERED), SIZE, { animated: false });
    sim.settle();
    sim.pin('b3');

    sim.update(buildModel(graph(['a1', 'a2', 'a3'], [['a1', 'a2']])), SIZE);

    expect(sim.isPinned('b3')).toBe(false);
    expect(sim.nodes().map((n) => n.id)).toEqual(['a1', 'a2', 'a3']);
    sim.destroy();
  });
});

describe('reconcileNodes', () => {
  const model = buildModel(graph(['a', 'b'], [['a', 'b']]));

  it('seeds a first layout deterministically, away from a single point', () => {
    const first = reconcileNodes([], model, CENTRE);
    const again = reconcileNodes([], model, CENTRE);
    expect(first.map((n) => [n.x, n.y])).toEqual(again.map((n) => [n.x, n.y]));
    expect(first[0]!.x).not.toBe(first[1]!.x);
  });

  it('leaves every position untouched when the data has not changed', () => {
    const before = reconcileNodes([], model, CENTRE);
    before[0]!.x = 111;
    before[0]!.y = 222;
    before[1]!.x = 333;
    before[1]!.y = 444;

    const after = reconcileNodes(before, model, CENTRE);

    expect(after.map((n) => [n.id, n.x, n.y])).toEqual([['a', 111, 222], ['b', 333, 444]]);
  });

  it('brings a new node in beside the neighbour it links to', () => {
    const before = reconcileNodes([], model, CENTRE);
    before[0]!.x = 100;
    before[0]!.y = 100;
    before[1]!.x = 900;
    before[1]!.y = 900;

    const grown = buildModel(graph(['a', 'b', 'c'], [['a', 'b'], ['a', 'c']]));
    const after = reconcileNodes(before, grown, CENTRE);

    expect(after.map((n) => [n.id, n.x, n.y]).slice(0, 2)).toEqual([['a', 100, 100], ['b', 900, 900]]);
    const c = after.find((n) => n.id === 'c')!;
    expect(Math.hypot(c.x - 100, c.y - 100)).toBeLessThan(Math.hypot(c.x - 900, c.y - 900));
  });

  it('drops a node that has gone and keeps the rest where they were', () => {
    const before = reconcileNodes([], buildModel(graph(['a', 'b', 'c'], [['a', 'b']])), CENTRE);
    const positions = before.map((n) => [n.id, n.x, n.y]);

    const after = reconcileNodes(before, model, CENTRE);

    expect(after.map((n) => n.id)).toEqual(['a', 'b']);
    expect(after.map((n) => [n.id, n.x, n.y])).toEqual(positions.slice(0, 2));
  });

  it('refreshes what the data owns without moving anything', () => {
    const before = reconcileNodes([], model, CENTRE);
    before[0]!.x = 10;
    const renamed = buildModel({
      nodes: [
        { id: 'a', kind: 'hub', scope: 'shared', projectId: null, projectSlug: null, slug: null, title: 'Renamed', tokens: 999, updatedAt: '' },
        { id: 'b', kind: 'doc', scope: 'shared', projectId: null, projectSlug: null, slug: 'b', title: 'b', tokens: 100, updatedAt: '' },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });

    const after = reconcileNodes(before, renamed, CENTRE);

    expect(after[0]!.title).toBe('Renamed');
    expect(after[0]!.kind).toBe('hub');
    expect(after[0]!.x).toBe(10);
  });
});
