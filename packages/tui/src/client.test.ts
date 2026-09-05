import { describe, expect, it } from 'vitest';
import { items, unwrap } from './client.js';

interface Agent { id: string; name: string }

describe('unwrap', () => {
  it('resolves the agent from a worker-keyed detail envelope', () => {
    // `/conductor` and `/workers/:id` both key the agent as `worker`; `attach` asks for `agent` first.
    const payload = { worker: { id: 'ag_conductor', name: 'Conductor' }, ticket: null, lastRun: { id: 'run_1' }, usage: null };
    const agent = unwrap<Agent>(payload, 'agent', 'worker');
    expect(agent.id).toBe('ag_conductor');
    expect(agent.name).toBe('Conductor');
  });

  it('prefers the first key that is present', () => {
    const payload = { agent: { id: 'ag_1', name: 'First' }, worker: { id: 'ag_2', name: 'Second' } };
    expect(unwrap<Agent>(payload, 'agent', 'worker').id).toBe('ag_1');
  });

  it('returns the payload itself when no key matches', () => {
    const payload = { id: 'ag_bare', name: 'Bare' };
    expect(unwrap<Agent>(payload, 'agent', 'worker').id).toBe('ag_bare');
  });

  it('ignores a key whose value is not an object', () => {
    const payload = { worker: 'ag_conductor', id: 'ag_bare', name: 'Bare' };
    expect(unwrap<Agent>(payload, 'agent', 'worker').id).toBe('ag_bare');
  });
});

describe('items', () => {
  it('reads a keyed collection, an items envelope and a bare array', () => {
    expect(items<{ id: string }>({ runs: [{ id: 'r1' }] }, 'runs')).toHaveLength(1);
    expect(items<{ id: string }>({ items: [{ id: 'r1' }, { id: 'r2' }] })).toHaveLength(2);
    expect(items<{ id: string }>([{ id: 'r1' }])).toHaveLength(1);
    expect(items<{ id: string }>(null)).toEqual([]);
  });
});
