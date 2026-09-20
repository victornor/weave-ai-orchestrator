/** `weave top`'s per-worker line (VS-603): the live state and elapsed time, never a bare status. */
import { describe, expect, it } from 'vitest';
import { fleetActivityLabel } from './Top.js';

const T0 = Date.parse('2026-09-19T12:00:00.000Z');
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();
const live = (label: string, sec: number) => ({ state: 'tool', label, since: at(sec), toolCount: 1, turnMs: 1000, sinceLastMs: 0, wholeStepsOnly: false });
const activity = (label: string, sec: number) => ({ verb: 'tool', label, target: null, since: at(sec) });

describe('fleetActivityLabel (VS-603)', () => {
  it('shows the live label and how long the state has lasted', () => {
    expect(fleetActivityLabel({ live: live('Running bash sleep 3; ls', 0) }, 'working', T0 + 3000)).toBe('Running bash sleep 3; ls · 3 s');
  });

  it('falls back to the activity line, then to the status label', () => {
    expect(fleetActivityLabel({ activity: activity('Editing src/app.ts', 0) }, 'working', T0 + 5000)).toBe('Editing src/app.ts · 5 s');
    expect(fleetActivityLabel({}, 'working', T0 + 5000)).toBe('working');
  });

  it('does not invent an elapsed time when there is no since', () => {
    expect(fleetActivityLabel({ live: { ...live('Waiting for the model', 0), since: undefined as unknown as string } }, 'working', T0 + 5000)).toBe('Waiting for the model');
  });
});
