/** VS-602: the runs list's live line for an active run — the agent's live state when the daemon has one, else status and elapsed. */
import { describe, expect, it } from 'vitest';
import { activeRunLine } from '../v2/RunsPage';

const NOW = Date.parse('2026-09-20T00:10:00.000Z');

describe('activeRunLine', () => {
  it('shows what the agent is doing and for how long, from the live frame', () => {
    expect(activeRunLine(
      { status: 'running', startedAt: '2026-09-20T00:00:00.000Z' },
      { label: 'Waiting for the model', since: new Date(NOW - 4000).toISOString() },
      NOW,
    )).toBe('Waiting for the model · now');
  });

  it('falls back to the run status and its elapsed time when there is no live frame', () => {
    expect(activeRunLine({ status: 'running', startedAt: '2026-09-20T00:00:00.000Z' }, null, NOW)).toBe('running · 10m00s');
  });

  it('is null for a finished run, which the Turn ended column accounts for', () => {
    expect(activeRunLine({ status: 'succeeded', startedAt: '2026-09-20T00:00:00.000Z' }, null, NOW)).toBeNull();
  });
});