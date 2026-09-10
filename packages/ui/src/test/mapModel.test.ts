/** VS-176: instance Map membership and ownership edges. */
import { describe, expect, it } from 'vitest';
import type { Role } from '@agent-conductor/shared';
import { buildMapModel, type MapWorkspaceInput } from '../lib/map/model';
import { project, ticket } from './factories';

function role(over: Partial<Role> = {}): Role {
  return {
    id: 'r1',
    workspaceId: 'alpha',
    projectId: 'p1',
    slug: 'platform-engineer',
    name: 'Platform Engineer',
    title: null,
    icon: null,
    charterSummary: '',
    scopeText: '',
    responsibilities: [],
    capabilities: [],
    rules: [],
    permission: {},
    sessionPolicy: 'per_ticket',
    maxWorkers: 2,
    secrets: [],
    status: 'active',
    pauseReason: null,
    specRevision: 1,
    createdBy: 'conductor',
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

function ws(over: Partial<MapWorkspaceInput> & Pick<MapWorkspaceInput, 'id' | 'name'>): MapWorkspaceInput {
  return {
    projects: [],
    roles: [],
    tickets: [],
    knowledge: [],
    conductor: null,
    ...over,
  };
}

describe('buildMapModel', () => {
  it('graphs two workspaces with project, role, in-flight ticket and knowledge', () => {
    const model = buildMapModel([
      ws({
        id: 'alpha',
        name: 'Alpha',
        projects: [project({ id: 'p1', slug: 'api', workspaceId: 'alpha' })],
        roles: [role({ id: 'r1', workspaceId: 'alpha', projectId: 'p1' })],
        tickets: [ticket({ id: 't1', identifier: 'VS-176', title: 'Map', status: 'in_progress', assigneeRoleId: 'r1', projectId: 'p1', workspaceId: 'alpha' })],
        knowledge: [{ projectId: 'p1' }, { projectId: 'p1' }, { projectId: 'p1' }],
        conductor: { id: 'c1', name: 'Conductor' },
      }),
      ws({
        id: 'beta',
        name: 'Beta',
        projects: [project({ id: 'p2', slug: 'web', workspaceId: 'beta' })],
      }),
    ]);

    const kinds = model.nodes.map((n) => `${n.kind}:${n.title}`);
    expect(kinds).toEqual(expect.arrayContaining([
      'workspace:Alpha',
      'workspace:Beta',
      'project:api',
      'project:web',
      'role:Platform Engineer',
      'ticket:VS-176 Map',
      'knowledge:api knowledge',
      'conductor:Conductor',
    ]));
    expect(model.nodes.filter((n) => n.kind === 'knowledge')).toHaveLength(1);

    const edge = (a: string, b: string): boolean => model.edges.some((e) => e.source === a && e.target === b);
    expect(edge('workspace:alpha', 'project:p1')).toBe(true);
    expect(edge('project:p1', 'role:r1')).toBe(true);
    expect(edge('role:r1', 'ticket:t1')).toBe(true);
    expect(edge('project:p1', 'knowledge:project:p1')).toBe(true);
    expect(edge('workspace:alpha', 'conductor:c1')).toBe(true);
    expect(model.edges.every((e) => {
      const s = model.byId.get(e.source);
      const t = model.byId.get(e.target);
      return s && t && s.workspaceId === t.workspaceId;
    })).toBe(true);
  });

  it('excludes todo and done tickets', () => {
    const model = buildMapModel([ws({
      id: 'alpha',
      name: 'Alpha',
      tickets: [
        ticket({ id: 'todo', identifier: 'VS-1', status: 'todo' }),
        ticket({ id: 'done', identifier: 'VS-2', status: 'done' }),
        ticket({ id: 'run', identifier: 'VS-3', status: 'in_progress' }),
      ],
    })]);
    const tickets = model.nodes.filter((n) => n.kind === 'ticket').map((n) => n.id);
    expect(tickets).toEqual(['ticket:run']);
  });

  it('excludes retired roles', () => {
    const model = buildMapModel([ws({
      id: 'alpha',
      name: 'Alpha',
      projects: [project({ id: 'p1' })],
      roles: [role({ id: 'dead', status: 'retired' }), role({ id: 'live', status: 'paused' })],
    })]);
    expect(model.nodes.filter((n) => n.kind === 'role').map((n) => n.id)).toEqual(['role:live']);
  });

  it('one knowledge node per project, not per file', () => {
    const model = buildMapModel([ws({
      id: 'alpha',
      name: 'Alpha',
      projects: [project({ id: 'p1', slug: 'api' })],
      knowledge: [{ projectId: 'p1' }, { projectId: 'p1' }, { projectId: 'p1' }, { projectId: 'p1' }],
    })]);
    expect(model.nodes.filter((n) => n.kind === 'knowledge')).toHaveLength(1);
  });

  it('does not add worker nodes', () => {
    const model = buildMapModel([ws({
      id: 'alpha',
      name: 'Alpha',
      tickets: [ticket({ id: 't1', workerId: 'w1', status: 'in_progress' })],
    })]);
    expect(model.nodes.every((n) => n.kind !== 'role' || n.title !== 'w1')).toBe(true);
    expect(model.nodes.some((n) => n.id.includes('worker'))).toBe(false);
  });

  it('hangs an unassigned blocked ticket off its project', () => {
    const model = buildMapModel([ws({
      id: 'alpha',
      name: 'Alpha',
      projects: [project({ id: 'p1', slug: 'api' })],
      tickets: [ticket({ id: 't1', identifier: 'VS-9', status: 'blocked', assigneeRoleId: null, projectId: 'p1' })],
    })]);
    expect(model.edges.some((e) => e.source === 'project:p1' && e.target === 'ticket:t1')).toBe(true);
    expect(model.edges.some((e) => e.target === 'ticket:t1' && e.source.startsWith('role:'))).toBe(false);
  });

  it('still draws an empty workspace as a lone node', () => {
    const model = buildMapModel([
      ws({ id: 'alpha', name: 'Alpha', projects: [project({ id: 'p1' })] }),
      ws({ id: 'beta', name: 'Beta' }),
    ]);
    expect(model.byId.get('workspace:beta')?.kind).toBe('workspace');
    expect(model.nodes.filter((n) => n.workspaceId === 'beta')).toHaveLength(1);
  });
});
