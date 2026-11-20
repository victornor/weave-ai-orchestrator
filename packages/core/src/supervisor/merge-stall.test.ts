import { describe, expect, it } from 'vitest';
import { judgeMergeChecks } from './merge-stall.js';

const NOW = Date.parse('2026-11-20T16:00:00Z');
const ago = (m: number): string => new Date(NOW - m * 60_000).toISOString();
const GRACE = 20 * 60_000;

describe('judgeMergeChecks (VS-991)', () => {
  it('a 37 minute run of one long job among passed ones is not stuck', () => {
    const v = judgeMergeChecks({ nowMs: NOW, slotStartedAtMs: NOW - 37 * 60_000, queuedGraceMs: GRACE, checks: [
      { name: 'lint', state: 'success', url: null, status: 'COMPLETED', startedAt: ago(37) },
      { name: 'dotnet-tests', state: 'pending', url: null, status: 'IN_PROGRESS', startedAt: ago(37) },
    ] });
    expect(v).toEqual({ stuck: false });
  });
  it('a queued check past the grace is stuck, before it is not', () => {
    const mk = (m: number) => judgeMergeChecks({ nowMs: NOW, slotStartedAtMs: NOW - 60 * 60_000, queuedGraceMs: GRACE, checks: [{ name: 'q', state: 'pending', url: null, status: 'QUEUED', startedAt: ago(m) }] });
    expect(mk(5)).toEqual({ stuck: false });
    expect(mk(25)).toEqual({ stuck: true, kind: 'not_started', checks: ['q'] });
  });
  it('a running job past the job limit is stuck', () => {
    const v = judgeMergeChecks({ nowMs: NOW, slotStartedAtMs: NOW - 400 * 60_000, queuedGraceMs: GRACE, checks: [{ name: 'r', state: 'pending', url: null, status: 'IN_PROGRESS', startedAt: ago(361) }] });
    expect(v).toEqual({ stuck: true, kind: 'past_job_timeout', checks: ['r'] });
  });
  it('no pending check falls back to the slot age', () => {
    expect(judgeMergeChecks({ nowMs: NOW, slotStartedAtMs: NOW - 5 * 60_000, queuedGraceMs: GRACE, checks: null })).toEqual({ stuck: false });
    expect(judgeMergeChecks({ nowMs: NOW, slotStartedAtMs: NOW - 25 * 60_000, queuedGraceMs: GRACE, checks: [] })).toMatchObject({ stuck: true, kind: 'no_run' });
  });
  it('VS-993: a slot held long, head whose checks were created seconds ago, is not no_run', () => {
    const v = judgeMergeChecks({ nowMs: NOW, slotStartedAtMs: NOW - 40 * 60_000, headObservedAtMs: NOW, queuedGraceMs: GRACE, checks: [] });
    expect(v).toEqual({ stuck: false });
    expect(judgeMergeChecks({ nowMs: NOW, slotStartedAtMs: NOW - 40 * 60_000, headObservedAtMs: NOW - 5 * 60_000, queuedGraceMs: GRACE, checks: null })).toEqual({ stuck: false });
  });
  it('VS-993: a head with no checks for the full grace is still no_run', () => {
    const v = judgeMergeChecks({ nowMs: NOW, slotStartedAtMs: NOW - 40 * 60_000, headObservedAtMs: NOW - 21 * 60_000, queuedGraceMs: GRACE, checks: [] });
    expect(v).toEqual({ stuck: true, kind: 'no_run', checks: [] });
  });
  it('VS-993: a head observed before the slot began does not shorten the wait', () => {
    expect(judgeMergeChecks({ nowMs: NOW, slotStartedAtMs: NOW - 5 * 60_000, headObservedAtMs: NOW - 60 * 60_000, queuedGraceMs: GRACE, checks: [] })).toEqual({ stuck: false });
  });
});
