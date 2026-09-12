/** VS-192: worker beams are a decorative overlay only, never a graph node. */
import { describe, expect, it } from 'vitest';
import { beamsFor } from '../lib/map/beams';
import { buildMapModel, type MapWorkspaceInput } from '../lib/map/model';
import { agent, project, ticket } from './factories';

function ws(over: Partial<MapWorkspaceInput> & Pick<MapWorkspaceInput, 'id' | 'name'>): MapWorkspaceInput {
  return { projects: [], roles: [], tickets: [], knowledge: [], weaver: null, ...over };
}

describe('beamsFor', () => {
  it('draws a beam from the ticket\'s own parent to the ticket', () => {
    const model = buildMapModel([ws({
      id: 'alpha',
      name: 'Alpha',
      projects: [project({ id: 'p1', workspaceId: 'alpha' })],
      tickets: [ticket({ id: 't1', identifier: 'VS-1', status: 'in_progress', projectId: 'p1', workspaceId: 'alpha' })],
    })]);
    const worker = agent({ id: 'w1', kind: 'worker', ticketId: 't1', status: 'running' });
    const beams = beamsFor([worker], model);
    expect(beams).toEqual([{ workerId: 'w1', from: 'project:p1', to: 'ticket:t1' }]);
  });

  it('is dropped, not crashed, when the ticket has no node on the map', () => {
    const model = buildMapModel([ws({ id: 'alpha', name: 'Alpha' })]);
    const worker = agent({ id: 'w1', kind: 'worker', ticketId: 'gone', status: 'running' });
    expect(beamsFor([worker], model)).toEqual([]);
  });

  it('is dropped for a worker with no ticket', () => {
    const model = buildMapModel([ws({ id: 'alpha', name: 'Alpha' })]);
    const worker = agent({ id: 'w1', kind: 'worker', ticketId: null, status: 'running' });
    expect(beamsFor([worker], model)).toEqual([]);
  });
});
