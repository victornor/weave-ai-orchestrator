import { describe, expect, it } from 'vitest';
import { resolveMergeMethod } from './merge-method.js';

/** VS-584: a promotion never asks for a merge method the repository forbids. */
describe('resolveMergeMethod', () => {
  it('uses the configured method when the repository allows it', () => {
    expect(resolveMergeMethod('merge', { merge: true, squash: true, rebase: true })).toEqual({ method: 'merge', fellBack: false });
  });

  it('falls back to the first allowed method when the configured one is forbidden', () => {
    expect(resolveMergeMethod('merge', { merge: false, squash: true, rebase: true })).toEqual({ method: 'squash', fellBack: true });
    expect(resolveMergeMethod('squash', { merge: true, squash: false, rebase: true })).toEqual({ method: 'merge', fellBack: true });
    expect(resolveMergeMethod('rebase', { merge: false, squash: false, rebase: true })).toEqual({ method: 'rebase', fellBack: false });
  });

  it('holds when the repository allows no method at all', () => {
    expect(resolveMergeMethod('squash', { merge: false, squash: false, rebase: false })).toBeNull();
  });

  it('uses the configured (or squash) method when the forge cannot say', () => {
    expect(resolveMergeMethod('rebase', null)).toEqual({ method: 'rebase', fellBack: false });
    expect(resolveMergeMethod(undefined, null)).toEqual({ method: 'squash', fellBack: false });
    expect(resolveMergeMethod('nonsense', null)).toEqual({ method: 'squash', fellBack: false });
  });

  it('defaults a missing or unknown configured method to squash', () => {
    expect(resolveMergeMethod(null, { merge: true, squash: true, rebase: true })).toEqual({ method: 'squash', fellBack: false });
    expect(resolveMergeMethod('nonsense', { merge: false, squash: true, rebase: false })).toEqual({ method: 'squash', fellBack: false });
  });
});
