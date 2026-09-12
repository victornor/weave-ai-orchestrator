import { describe, expect, it } from 'vitest';
import { centeringForce, clusterForce, type ClusterableNode } from './cluster';

function settle(nodes: ClusterableNode[], strength: number, ticks: number): void {
  const force = clusterForce(strength);
  force.initialize(nodes);
  for (let i = 0; i < ticks; i++) {
    force(0.3);
    for (const n of nodes) {
      n.x += n.vx ?? 0;
      n.y += n.vy ?? 0;
      n.vx = 0;
      n.vy = 0;
    }
  }
}

describe('clusterForce', () => {
  it('pulls a group\'s scattered nodes toward their shared centroid', () => {
    const nodes: ClusterableNode[] = [
      { x: -100, y: 0, group: 'a' },
      { x: 100, y: 0, group: 'a' },
      { x: 0, y: 500, group: 'b' },
    ];
    settle(nodes, 0.5, 60);

    const [a1, a2] = nodes;
    expect(Math.abs(a1!.x - a2!.x)).toBeLessThan(200);
  });

  it('does not pull different groups toward each other', () => {
    const nodes: ClusterableNode[] = [
      { x: 0, y: 0, group: 'a' },
      { x: 1000, y: 0, group: 'b' },
    ];
    settle(nodes, 0.5, 30);
    expect(nodes[0]!.x).toBeCloseTo(0, 5);
    expect(nodes[1]!.x).toBeCloseTo(1000, 5);
  });

  it('eases as a group grows, dividing the pull by the square root of its size', () => {
    const small: ClusterableNode[] = [{ x: -50, y: 0, group: 'a' }, { x: 50, y: 0, group: 'a' }];
    const forceSmall = clusterForce(1);
    forceSmall.initialize(small);
    forceSmall(1);
    const movedSmall = Math.abs(small[0]!.vx ?? 0);

    const big: ClusterableNode[] = Array.from({ length: 8 }, (_, i) => ({ x: i % 2 === 0 ? -50 : 50, y: 0, group: 'b' }));
    const forceBig = clusterForce(1);
    forceBig.initialize(big);
    forceBig(1);
    const movedBig = Math.abs(big[0]!.vx ?? 0);

    expect(movedBig).toBeLessThan(movedSmall);
  });
});

describe('centeringForce', () => {
  it('pulls every node toward the one shared point, regardless of group', () => {
    const nodes: ClusterableNode[] = [
      { x: -1000, y: -1000, group: 'a' },
      { x: 1000, y: 1000, group: 'b' },
    ];
    const force = centeringForce(0, 0, 0.1);
    force.initialize(nodes);
    for (let i = 0; i < 200; i++) {
      force(0.3);
      for (const n of nodes) {
        n.x += n.vx ?? 0;
        n.y += n.vy ?? 0;
        n.vx = 0;
        n.vy = 0;
      }
    }
    expect(Math.abs(nodes[0]!.x)).toBeLessThan(50);
    expect(Math.abs(nodes[1]!.x)).toBeLessThan(50);
  });

  it('does not distinguish between groups the way clusterForce does', () => {
    const nodes: ClusterableNode[] = [
      { x: -500, y: 0, group: 'a' },
      { x: 500, y: 0, group: 'b' },
    ];
    const force = centeringForce(0, 0, 0.2);
    force.initialize(nodes);
    force(1);
    // Both move toward the shared centre by the same fraction of their own distance from it,
    // unlike `clusterForce`'s per-group centroid, which would leave them exactly where they are.
    expect(nodes[0]!.vx).toBeGreaterThan(0);
    expect(nodes[1]!.vx).toBeLessThan(0);
  });
});
