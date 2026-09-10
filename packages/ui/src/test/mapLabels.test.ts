/** VS-192: label decluttering for the global Map. */
import { describe, expect, it } from 'vitest';
import { declutterLabels, type LabelCandidate } from '../lib/map/labels';

describe('declutterLabels', () => {
  it('keeps a lone label', () => {
    const shown = declutterLabels([{ id: 'a', x: 0, y: 0, text: 'Alpha', priority: 0 }]);
    expect(shown.has('a')).toBe(true);
  });

  it('a lower-priority label yields to a higher-priority one it overlaps', () => {
    const candidates: LabelCandidate[] = [
      { id: 'role', x: 0, y: 0, text: 'Platform Engineer', priority: 2 },
      { id: 'ticket', x: 2, y: 0, text: 'VS-1 Something', priority: 3 },
    ];
    const shown = declutterLabels(candidates);
    expect(shown.has('role')).toBe(true);
    expect(shown.has('ticket')).toBe(false);
  });

  it('shows both labels when they do not overlap', () => {
    const candidates: LabelCandidate[] = [
      { id: 'a', x: 0, y: 0, text: 'Alpha', priority: 0 },
      { id: 'b', x: 400, y: 400, text: 'Beta', priority: 0 },
    ];
    const shown = declutterLabels(candidates);
    expect(shown.has('a')).toBe(true);
    expect(shown.has('b')).toBe(true);
  });

  it('never shows two overlapping labels regardless of order', () => {
    const candidates: LabelCandidate[] = [
      { id: 'x', x: 0, y: 0, text: 'X', priority: 1 },
      { id: 'y', x: 1, y: 0, text: 'Y', priority: 1 },
      { id: 'z', x: -1, y: 0, text: 'Z', priority: 1 },
    ];
    const shown = declutterLabels(candidates);
    expect(shown.size).toBe(1);
  });
});
