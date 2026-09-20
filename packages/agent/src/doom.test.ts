import { describe, expect, it } from 'vitest';
import { DoomGuard } from './doom.js';

const K = DoomGuard.key('bash', { command: 'ls' });
describe('DoomGuard', () => {
  it('lets three identical calls run, refuses the fourth once, then stops', () => {
    const g = new DoomGuard();
    for (let i = 0; i < 3; i++) { expect(g.check(K)).toBe('ok'); g.record(K, 'same'); }
    expect(g.check(K)).toBe('warn');
    expect(g.check(K)).toBe('stop');
  });
  it('is not fooled by argument order', () => {
    expect(DoomGuard.key('t', { a: 1, b: { c: 2, d: 3 } })).toBe(DoomGuard.key('t', { b: { d: 3, c: 2 }, a: 1 }));
  });
  it('does not fire when the results differ (polling a job is not a loop)', () => {
    const g = new DoomGuard();
    for (let i = 0; i < 6; i++) { expect(g.check(K)).toBe('ok'); g.record(K, `progress ${i}`); }
  });
  it('resets after a different call', () => {
    const g = new DoomGuard();
    for (let i = 0; i < 3; i++) g.record(K, 'same');
    expect(g.check(K)).toBe('warn');
    g.record(DoomGuard.key('read', { path: 'x' }), 'other');
    expect(g.check(K)).toBe('ok');
  });
});
