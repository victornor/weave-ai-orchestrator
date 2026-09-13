/** VS-350: the V2 map's workspace → project → worker graph with `runs in` edges. */
import { describe, expect, it } from 'vitest';
import { buildWorkerMapModel } from '../v2/map/model';
import { agent, project } from './factories';

describe('buildWorkerMapModel', () => {
  it('hangs each worker under its project with a runs-in edge', () => {
    const model = buildWorkerMapModel([
      {
        id: 'ws1',
        name: 'Acme',
        projects: [project({ id: 'p1', slug: 'web', name: 'web' })],
        workers: [agent({ id: 'a1', name: 'Backend Engineer #7', projectId: 'p1', status: 'running' })],
      },
    ]);

    expect(model.byId.get('workspace:ws1')).toBeTruthy();
    expect(model.byId.get('project:p1')).toBeTruthy();
    const worker = model.byId.get('worker:a1');
    expect(worker?.kind).toBe('worker');
    expect(worker?.workerStatus).toBe('running');
    expect(model.edges.some((e) => e.source === 'project:p1' && e.target === 'worker:a1')).toBe(true);
    expect(model.edges.some((e) => e.source === 'workspace:ws1' && e.target === 'project:p1')).toBe(true);
  });

  it('hangs a worker with no project off the workspace', () => {
    const model = buildWorkerMapModel([
      { id: 'ws1', name: 'Acme', projects: [], workers: [agent({ id: 'a1', projectId: null, status: 'active' })] },
    ]);
    expect(model.edges.some((e) => e.source === 'workspace:ws1' && e.target === 'worker:a1')).toBe(true);
  });

  it('draws every workspace in one graph', () => {
    const model = buildWorkerMapModel([
      { id: 'ws1', name: 'Acme', projects: [project({ id: 'p1', slug: 'web' })], workers: [] },
      { id: 'ws2', name: 'Fernwood', projects: [project({ id: 'p2', slug: 'api' })], workers: [] },
    ]);
    expect(model.byId.has('workspace:ws1')).toBe(true);
    expect(model.byId.has('workspace:ws2')).toBe(true);
    expect(model.byId.has('project:p1')).toBe(true);
    expect(model.byId.has('project:p2')).toBe(true);
  });
});
