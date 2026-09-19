/** VS-192: radial tree layout for the global Map. */
import { describe, expect, it } from 'vitest';
import type { Role } from '@weave-ai/shared';
import { buildMapModel, type MapWorkspaceInput } from '../lib/map/model';
import { layoutRadial, minSiblingGapByDepth } from '../lib/map/radial';
import { project, ticket } from './factories';

function role(over: Partial<Role> = {}): Role {
  return {
    id: 'r1', workspaceId: 'alpha', projectId: 'p1', slug: 'pe', name: 'Platform Engineer', title: null, icon: null,
    charterSummary: '', scopeText: '', responsibilities: [], capabilities: [], rules: [], permission: {},
    sessionPolicy: 'per_ticket', maxWorkers: 2, memoryLimitMb: null, secrets: [], status: 'active', pauseReason: null, specRevision: 1,
    createdBy: 'c', createdAt: '', updatedAt: '', ...over,
  };
}

function ws(over: Partial<MapWorkspaceInput> & Pick<MapWorkspaceInput, 'id' | 'name'>): MapWorkspaceInput {
  return { projects: [], roles: [], tickets: [], knowledge: [], weaver: null, ...over };
}

describe('layoutRadial', () => {
  it('never overlaps two workspaces of very different sizes', () => {
    const bigTickets = Array.from({ length: 12 }, (_, i) => ticket({ id: `t${i}`, identifier: `VS-${i}`, status: 'in_progress', workspaceId: 'big' }));
    const model = buildMapModel([
      ws({ id: 'big', name: 'Big', projects: [project({ id: 'p1', workspaceId: 'big' })], tickets: bigTickets }),
      ws({ id: 'small', name: 'Small' }),
    ]);
    const layout = layoutRadial(model);
    const big = layout.get('workspace:big')!;
    const small = layout.get('workspace:small')!;
    expect(big.angle).not.toBeCloseTo(small.angle, 3);

    // No two nodes from different workspaces share a point.
    const points = [...layout.values()];
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i]!;
        const b = points[j]!;
        const nodeA = model.byId.get(a.id)!;
        const nodeB = model.byId.get(b.id)!;
        if (nodeA.workspaceId !== nodeB.workspaceId) {
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0);
        }
      }
    }
  });

  it('places children strictly farther from the centre than their parent', () => {
    const model = buildMapModel([ws({
      id: 'alpha',
      name: 'Alpha',
      projects: [project({ id: 'p1', slug: 'api', workspaceId: 'alpha' })],
      roles: [role({ id: 'r1', workspaceId: 'alpha', projectId: 'p1' })],
      tickets: [ticket({ id: 't1', identifier: 'VS-1', status: 'in_progress', assigneeRoleId: 'r1', projectId: 'p1', workspaceId: 'alpha' })],
    })]);
    const layout = layoutRadial(model);
    const wsNode = layout.get('workspace:alpha')!;
    const project1 = layout.get('project:p1')!;
    const roleNode = layout.get('role:r1')!;
    const ticketNode = layout.get('ticket:t1')!;
    expect(project1.radius).toBeGreaterThan(wsNode.radius);
    expect(roleNode.radius).toBeGreaterThan(project1.radius);
    expect(ticketNode.radius).toBeGreaterThan(roleNode.radius);
  });

  it('keeps every sibling pair angularly disjoint even for a lopsided tree', () => {
    const manyTickets = Array.from({ length: 20 }, (_, i) => ticket({ id: `t${i}`, identifier: `VS-${i}`, status: 'in_progress', assigneeRoleId: 'r1', projectId: 'p1', workspaceId: 'alpha' }));
    const model = buildMapModel([ws({
      id: 'alpha',
      name: 'Alpha',
      projects: [project({ id: 'p1', workspaceId: 'alpha' }), project({ id: 'p2', workspaceId: 'alpha' })],
      roles: [role({ id: 'r1', workspaceId: 'alpha', projectId: 'p1' })],
      tickets: manyTickets,
    })]);
    const layout = layoutRadial(model);
    const p1 = layout.get('project:p1')!;
    const p2 = layout.get('project:p2')!;
    expect(p1.angle).not.toBeCloseTo(p2.angle, 6);
  });

  it('does not divide by zero for a single-node map', () => {
    const model = buildMapModel([ws({ id: 'alpha', name: 'Alpha' })]);
    const layout = layoutRadial(model);
    const wsNode = layout.get('workspace:alpha')!;
    expect(Number.isFinite(wsNode.x)).toBe(true);
    expect(Number.isFinite(wsNode.y)).toBe(true);
  });

  it('returns an empty layout for an empty model', () => {
    const model = buildMapModel([]);
    expect(layoutRadial(model).size).toBe(0);
  });
});

describe('minSiblingGapByDepth', () => {
  it('reports a finite positive gap for siblings sharing a parent', () => {
    const model = buildMapModel([ws({
      id: 'alpha',
      name: 'Alpha',
      projects: [project({ id: 'p1', workspaceId: 'alpha' }), project({ id: 'p2', workspaceId: 'alpha' })],
    })]);
    const layout = layoutRadial(model);
    const gaps = minSiblingGapByDepth(model, layout);
    const projectDepth = layout.get('project:p1')!.depth;
    expect(gaps.get(projectDepth)).toBeGreaterThan(0);
  });

  it('has no entry for a depth with no sibling pair', () => {
    const model = buildMapModel([ws({ id: 'alpha', name: 'Alpha' })]);
    const layout = layoutRadial(model);
    expect(minSiblingGapByDepth(model, layout).size).toBe(0);
  });
});
