import { describe, expect, it } from 'vitest';
import { SUPERVISOR_STALL_NO_TICK_MS, SUPERVISOR_STALL_STEP_MS, supervisorState, type SupervisorStateInput } from './supervisor-health.js';

const NOW = Date.parse('2026-11-01T12:00:00.000Z');
const base: SupervisorStateInput = { now: NOW, startedAt: NOW - 3_600_000, lastTickFinishedAt: NOW - 15_000, stepsInFlight: [], activeRuns: 0, queuedWakes: 0, openHumanDecisions: 0 };

describe('supervisorState (VS-952)', () => {
  it('is idle when ticks finish and nothing is pending', () => {
    expect(supervisorState(base)).toBe('idle');
  });

  it('is idle_waiting_on_human when the only open work is a human-owned decision', () => {
    expect(supervisorState({ ...base, openHumanDecisions: 1 })).toBe('idle_waiting_on_human');
  });

  it('is active when a run is running or a wake is pending, even with a human decision open', () => {
    expect(supervisorState({ ...base, activeRuns: 1, openHumanDecisions: 2 })).toBe('active');
    expect(supervisorState({ ...base, queuedWakes: 1 })).toBe('active');
  });

  it('is starting before the first tick finishes', () => {
    expect(supervisorState({ ...base, startedAt: NOW - 5_000, lastTickFinishedAt: null, activeRuns: 3 })).toBe('starting');
  });

  it('is stalled when no tick has finished for the stall window, whatever else holds', () => {
    expect(supervisorState({ ...base, lastTickFinishedAt: NOW - SUPERVISOR_STALL_NO_TICK_MS, activeRuns: 1 })).toBe('stalled');
    expect(supervisorState({ ...base, lastTickFinishedAt: NOW - SUPERVISOR_STALL_NO_TICK_MS + 1 })).toBe('idle');
  });

  it('is stalled when the first tick never finishes', () => {
    expect(supervisorState({ ...base, startedAt: NOW - SUPERVISOR_STALL_NO_TICK_MS, lastTickFinishedAt: null })).toBe('stalled');
  });

  it('is stalled when one step has been in flight for the step window', () => {
    expect(supervisorState({ ...base, stepsInFlight: [{ step: 'merge queue pump', sinceMs: SUPERVISOR_STALL_STEP_MS }] })).toBe('stalled');
    expect(supervisorState({ ...base, stepsInFlight: [{ step: 'merge queue pump', sinceMs: SUPERVISOR_STALL_STEP_MS - 1 }] })).toBe('idle');
  });

  it('never reports a stopped supervisor as stalled', () => {
    expect(supervisorState({ ...base, startedAt: null, lastTickFinishedAt: NOW - 86_400_000 })).toBe('idle');
  });
});
