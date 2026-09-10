import { describe, expect, it } from 'vitest';
import { buildModel } from './model';
import { chipsOverlap, createSimulation, reconcileNodes, suppressedLabels, type SimNode } from './simulation';
import type { KnowledgeGraph } from '../../api/types';

/**
 * Shaped like this project's own knowledge base at the scale the ticket reported (34 nodes / 67
 * edges across 5 groups of very different sizes, one hub each) — not a handful of uniform nodes,
 * since the seed-time overlap VS-193 traced only shows up once a group has enough real siblings.
 */
function multiGroupGraph(): KnowledgeGraph {
  const groups: Array<{ scope: string; n: number }> = [
    { scope: 'workspace', n: 0 },
    { scope: 'shared', n: 7 },
    { scope: 'decisions', n: 1 },
    { scope: 'agent-conductor', n: 17 },
    { scope: 'fernwood', n: 4 },
  ];
  const nodes: KnowledgeGraph['nodes'] = [];
  const byScope = new Map<string, string[]>();
  for (const g of groups) {
    const hub = `hub:${g.scope}`;
    nodes.push({ id: hub, kind: 'hub', scope: g.scope, projectId: null, projectSlug: null, slug: null, title: g.scope, tokens: 900, updatedAt: '' });
    const ids = [hub];
    for (let i = 0; i < g.n; i++) {
      const id = `doc:${g.scope}:${i}`;
      nodes.push({ id, kind: 'doc', scope: g.scope, projectId: null, projectSlug: null, slug: id, title: `Document ${g.scope} ${i}`, tokens: 300, updatedAt: '' });
      ids.push(id);
    }
    byScope.set(g.scope, ids);
  }
  const edges: KnowledgeGraph['edges'] = [];
  for (const [scope, ids] of byScope) {
    const hub = `hub:${scope}`;
    for (const id of ids) if (id !== hub) edges.push({ from: id, to: hub });
  }
  return { nodes, edges };
}

/**
 * A hub with many siblings that only link to the hub, never to each other — the shape that
 * stresses `clusterForce`'s constant per-node pull once a group has enough of them.
 */
function siblingGraph(count: number): KnowledgeGraph {
  const nodes: KnowledgeGraph['nodes'] = [
    { id: 'hub', kind: 'hub', scope: 'shared', projectId: null, projectSlug: null, slug: null, title: 'Shared conventions', tokens: 900, updatedAt: '' },
  ];
  const edges: KnowledgeGraph['edges'] = [];
  for (let i = 0; i < count; i++) {
    const id = `doc-${i}`;
    nodes.push({ id, kind: 'doc', scope: 'shared', projectId: null, projectSlug: null, slug: id, title: `Sibling document number ${i}`, tokens: 300, updatedAt: '' });
    edges.push({ from: id, to: 'hub' });
  }
  return { nodes, edges };
}

function overlappingPairs(nodes: readonly SimNode[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (chipsOverlap(nodes[i]!, nodes[j]!)) out.push(`${nodes[i]!.id}/${nodes[j]!.id}`);
    }
  }
  return out;
}

describe('a fresh graph seeds without its chips already on top of one another', () => {
  it('places every brand-new node (nothing in `previous`) with no chip overlap', () => {
    // This is the state a reader's first paint draws from, before the simulation has ticked —
    // the ring `reconcileNodes` seeds new nodes on was a flat `40 + n*1.6`, independent of how
    // big the chips actually are; for this graph's 34 real-sized chips that put ~18% of all
    // pairs already overlapping (opaque rects painting over each other's label) before anything
    // had a chance to settle. `seedRing` sizes the ring from the chips' own footprint instead.
    const model = buildModel(multiGroupGraph());
    const nodes = reconcileNodes([], model, { x: 450, y: 260 });

    expect(overlappingPairs(nodes)).toEqual([]);
  });
});

describe('a crowded group settles without its siblings overlapping', () => {
  it('keeps 10 sibling chips (no direct links between them) apart after settling', () => {
    const model = buildModel(siblingGraph(10));
    const sim = createSimulation(model, { width: 900, height: 520 }, { animated: false });
    sim.settle();

    expect(overlappingPairs(sim.nodes())).toEqual([]);
  });

  it('keeps the realistic 34-node / 67-edge graph apart after settling', () => {
    const model = buildModel(multiGroupGraph());
    const sim = createSimulation(model, { width: 900, height: 520 }, { animated: false });
    sim.settle();

    expect(overlappingPairs(sim.nodes())).toEqual([]);
  });
});

/** A minimal, position-only node — the priority rule needs no real layout to test. */
function at(id: string, kind: 'hub' | 'doc', degree: number, x: number, y: number): SimNode {
  return { id, title: id, kind, group: 'g', degree, tokens: 0, radius: 40, x, y, vx: 0, vy: 0 };
}

describe('which label a backstop suppresses when two chips still overlap', () => {
  it('suppresses neither when the chips do not overlap', () => {
    expect(suppressedLabels([at('a', 'doc', 1, 0, 0), at('b', 'doc', 1, 1000, 1000)])).toEqual(new Set());
  });

  it('suppresses the lower-degree of two overlapping documents', () => {
    const suppressed = suppressedLabels([at('a', 'doc', 5, 0, 0), at('b', 'doc', 1, 0, 0)]);
    expect(suppressed).toEqual(new Set(['b']));
  });

  it('never suppresses a hub for a document, even a much better-linked one', () => {
    const suppressed = suppressedLabels([at('hub', 'hub', 0, 0, 0), at('doc', 'doc', 40, 0, 0)]);
    expect(suppressed).toEqual(new Set(['doc']));
  });

  it('keeps the hovered or selected node visible over a better-linked neighbour', () => {
    const suppressed = suppressedLabels(
      [at('a', 'doc', 40, 0, 0), at('b', 'doc', 1, 0, 0)],
      new Set(['b']),
    );
    expect(suppressed).toEqual(new Set(['a']));
  });

  it('is deterministic when every tiebreaker is equal', () => {
    const a = suppressedLabels([at('x', 'doc', 3, 0, 0), at('y', 'doc', 3, 0, 0)]);
    const b = suppressedLabels([at('x', 'doc', 3, 0, 0), at('y', 'doc', 3, 0, 0)]);
    expect(a).toEqual(b);
    expect(a.size).toBe(1);
  });
});
