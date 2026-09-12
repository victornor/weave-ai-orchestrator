import { describe, expect, it } from 'vitest';
import { UI_STATUSES } from '@weave-ai/shared';
import { STATUS_COLORS, STATUS_GLYPHS, STATUS_INK_COLORS, STATUS_LABELS, statusBadge, statusGlyph, statusRank } from './status.js';

describe('status tokens', () => {
  it('covers all nine UI statuses in every map', () => {
    for (const s of UI_STATUSES) {
      expect(STATUS_GLYPHS[s]).toBeTruthy();
      expect(STATUS_COLORS[s]).toMatch(/^#[0-9A-F]{6}$/i);
      expect(STATUS_INK_COLORS[s]).toBeTruthy();
      expect(STATUS_LABELS[s]).toBeTruthy();
    }
    expect(Object.keys(STATUS_GLYPHS)).toHaveLength(9);
  });

  it('uses the agreed glyphs', () => {
    expect(STATUS_GLYPHS).toEqual({
      idle: '○', working: '▲', stalled: '△', blocked: '■', 'needs-you': '◆',
      merging: '⬢', done: '●', failed: '✕', paused: '‖',
    });
  });

  it('gives every status a distinct glyph', () => {
    expect(new Set(Object.values(STATUS_GLYPHS)).size).toBe(9);
  });

  it('never throws on unknown input', () => {
    expect(statusGlyph('nonsense')).toBe('○');
    expect(statusGlyph(undefined)).toBe('○');
    expect(statusBadge('needs-you')).toBe('◆ needs you');
  });

  it('sorts needs-you first and done last', () => {
    expect(statusRank('needs-you')).toBeLessThan(statusRank('working'));
    expect(statusRank('done')).toBeGreaterThan(statusRank('failed'));
  });
});
