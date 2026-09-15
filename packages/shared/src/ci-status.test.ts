import { describe, expect, it } from 'vitest';
import { ciChipCopy } from './ci-status.js';

const PR = { prState: 'open', prHead: 'head-1', ciHead: 'head-1' };

describe('ciChipCopy (VS-481)', () => {
  it('waits with the tally while checks run, naming the pending ones', () => {
    expect(ciChipCopy({
      ...PR,
      ciState: 'pending',
      prChecks: { passed: 2, total: 4 },
      ciChecks: [
        { name: 'build', state: 'success' },
        { name: 'lint', state: 'pending' },
        { name: 'test', state: 'pending' },
        { name: 'typecheck', state: 'success' },
      ],
    })).toEqual({ tone: 'pending', line: 'Waiting for CI · 2/4', checks: ['lint', 'test'] });
  });

  it('reports a pass only when the rollup succeeded', () => {
    expect(ciChipCopy({ ...PR, ciState: 'success', prChecks: { passed: 3, total: 3 } }))
      .toEqual({ tone: 'passed', line: 'CI passed', checks: [] });
  });

  it('names the failed check', () => {
    expect(ciChipCopy({
      ...PR,
      ciState: 'failure',
      prChecks: { passed: 2, total: 3 },
      ciChecks: [
        { name: 'build', state: 'success' },
        { name: 'lint', state: 'failure' },
        { name: 'test', state: 'success' },
      ],
    })).toEqual({ tone: 'failed', line: 'CI failed · lint', checks: ['lint'] });
  });

  it('falls back to a bare failed line when no check is named', () => {
    expect(ciChipCopy({ ...PR, ciState: 'failure' }))
      .toEqual({ tone: 'failed', line: 'CI failed', checks: [] });
  });

  it('says skipped plainly, and never reads an all-skipped rollup as a pass', () => {
    expect(ciChipCopy({
      ...PR,
      ciState: 'none',
      prChecks: { passed: 0, total: 5 },
      ciChecks: [{ name: 'build', state: 'none' }],
    })).toEqual({ tone: 'skipped', line: 'CI skipped', checks: [] });
  });

  it('shows no chip when the forge reported no checks', () => {
    expect(ciChipCopy({ ...PR, ciState: 'none' })).toBeNull();
    expect(ciChipCopy({ ...PR, ciState: 'none', prChecks: { passed: 0, total: 0 } })).toBeNull();
  });

  it('marks checks for another commit as stale instead of showing a tally', () => {
    expect(ciChipCopy({
      prState: 'open',
      ciState: 'success',
      prChecks: { passed: 3, total: 3 },
      ciHead: 'old-head',
      prHead: 'new-head',
    })).toEqual({ tone: 'stale', line: 'CI on an older commit', checks: [] });
  });

  it('honours an explicit approved head over the delivery head', () => {
    expect(ciChipCopy({ ...PR, ciState: 'pending', prChecks: { passed: 1, total: 2 } }, { approvedHead: 'other' })
      ?.tone).toBe('stale');
  });

  it('shows nothing for a missing rollup or a pull request that has left open', () => {
    expect(ciChipCopy(null)).toBeNull();
    expect(ciChipCopy({ ...PR, ciState: null })).toBeNull();
    expect(ciChipCopy({ ...PR, ciState: 'success', prState: 'merged' })).toBeNull();
    expect(ciChipCopy({ ...PR, ciState: 'success', prState: 'closed' })).toBeNull();
  });

  it('tolerates a malformed delivery without throwing', () => {
    expect(ciChipCopy({ ciState: 'pending', prChecks: 'nonsense', ciChecks: [1, { name: 2 }] }))
      .toEqual({ tone: 'pending', line: 'Waiting for CI', checks: [] });
  });
});
