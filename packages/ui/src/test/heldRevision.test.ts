/**
 * VS-430: the held card's revision row is a pure function of the worker, its ticket and its latest
 * run, so every worker state is covered here rather than only through a rendered card.
 */
import { describe, expect, it } from 'vitest';
import { agent, run as makeRun, ticket } from './factories';
import { heldRevisionRow } from '../v2/DecisionCard';

const NOW = new Date('2026-09-14T18:00:00.000Z').getTime();

describe('heldRevisionRow', () => {
  it('pulses only for a turn that is actually running, timed from the run start', () => {
    const row = heldRevisionRow({
      worker: agent({ status: 'running' }),
      ticket: ticket(),
      run: makeRun({ status: 'running', startedAt: '2026-09-14T17:00:00.000Z' }),
      now: NOW,
    });
    expect(row.pulse).toBe(true);
    expect(row.text).toBe('Revision in progress · 1h');
  });

  it('does not pulse when the worker is between turns, and counts from the last run', () => {
    const row = heldRevisionRow({
      worker: agent({ status: 'active' }),
      ticket: ticket({ status: 'in_progress' }),
      run: makeRun({ status: 'succeeded', finishedAt: '2026-09-14T01:00:00.000Z' }),
      now: NOW,
    });
    expect(row.pulse).toBe(false);
    expect(row.text).toBe('Held for a revision — waiting on the worker · 17h ago');
  });

  it('does not pulse for a paused worker and carries the reason when there is one', () => {
    const reason = heldRevisionRow({
      worker: agent({ status: 'paused', pauseReason: 'waiting on a prerequisite' }),
      ticket: ticket({ status: 'in_progress' }),
      run: null,
      now: NOW,
    });
    expect(reason).toEqual({ pulse: false, text: 'Held — worker paused: waiting on a prerequisite' });
    const bare = heldRevisionRow({ worker: agent({ status: 'paused' }), ticket: ticket(), run: null, now: NOW });
    expect(bare).toEqual({ pulse: false, text: 'Held — worker paused' });
  });

  it('names the first blocker that is not done when the ticket is blocked', () => {
    const row = heldRevisionRow({
      worker: agent({ status: 'active' }),
      ticket: ticket({ status: 'blocked' }),
      blockers: [ticket({ id: 'tk_a', identifier: 'ACME-1', status: 'done' }), ticket({ id: 'tk_b', identifier: 'ACME-2', status: 'todo' })],
      run: null,
      now: NOW,
    });
    expect(row).toEqual({ pulse: false, text: 'Held — blocked: ACME-2' });
  });

  it('says there is no worker when the ticket has none', () => {
    expect(heldRevisionRow({ worker: null, ticket: ticket(), run: null, now: NOW })).toEqual({
      pulse: false,
      text: 'Held — no worker',
    });
  });
});
