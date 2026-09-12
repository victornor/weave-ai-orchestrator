import { describe, expect, it } from 'vitest';
import { READABLE_MIN_PX, READABLE_MIN_RATIO, pinnedOpenDecisions, readablyVisible } from '../lib/decisionVisibility';
import { decisionFingerprint } from '../lib/hiddenDecisions';
import { decision } from './factories';

describe('readablyVisible', () => {
  it('does not count a one-pixel sliver as readable', () => {
    expect(readablyVisible({ ratio: 0.01, heightPx: 300, visiblePx: 1 })).toBe(false);
  });

  it('counts a card half showing', () => {
    expect(readablyVisible({ ratio: READABLE_MIN_RATIO, heightPx: 300, visiblePx: 150 })).toBe(true);
  });

  it('counts a card taller than the viewport once a readable slice of it shows', () => {
    expect(readablyVisible({ ratio: 0.2, heightPx: 2000, visiblePx: READABLE_MIN_PX })).toBe(true);
    expect(readablyVisible({ ratio: 0.2, heightPx: 2000, visiblePx: READABLE_MIN_PX - 1 })).toBe(false);
  });

  it('falls back to the ratio when the height is not measured', () => {
    expect(readablyVisible({ ratio: 0.9, heightPx: 0, visiblePx: 0 })).toBe(true);
    expect(readablyVisible({ ratio: 0.1, heightPx: 0, visiblePx: 0 })).toBe(false);
  });
});

describe('pinnedOpenDecisions', () => {
  const open = [decision({ id: 'd_on' }), decision({ id: 'd_off' }), decision({ id: 'd_hidden' })];

  it('drops an open decision whose inline card is readably on screen', () => {
    expect(pinnedOpenDecisions(open, {}, new Set(['d_on'])).map((d) => d.id)).toEqual(['d_off', 'd_hidden']);
  });

  it('keeps an open decision whose card is not on screen, so it stays reachable', () => {
    expect(pinnedOpenDecisions(open, {}, new Set()).map((d) => d.id)).toEqual(['d_on', 'd_off', 'd_hidden']);
  });

  it('drops a hidden decision even when it is not on screen', () => {
    const d = decision({ id: 'd_hidden' });
    const hidden = { [d.id]: { fingerprint: decisionFingerprint(d), at: new Date().toISOString() } };
    expect(pinnedOpenDecisions(open, hidden, new Set()).map((x) => x.id)).toEqual(['d_on', 'd_off']);
  });

  it('never drops a decision the on-screen set cannot contain (no inline card)', () => {
    expect(pinnedOpenDecisions(open, {}, new Set(['d_someone_else'])).map((d) => d.id)).toEqual(['d_on', 'd_off', 'd_hidden']);
  });
});
