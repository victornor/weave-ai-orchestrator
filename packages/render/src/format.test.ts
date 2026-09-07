import { describe, expect, it } from 'vitest';
import { formatAge, formatCents, formatCost, formatCountdown, formatDelta, formatDiffStat, formatDuration, formatRelative, formatReportedShare, formatTokens, initials, joinMeta, oneLine } from './format.js';

describe('formatTokens', () => {
  it('formats the design contract sample', () => {
    expect(formatTokens(18_400)).toBe('18.4k');
  });
  it('keeps small counts exact and drops trailing .0', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1000)).toBe('1k');
    expect(formatTokens(1250)).toBe('1.3k');
    expect(formatTokens(120_000)).toBe('120k');
    expect(formatTokens(1_240_000)).toBe('1.2M');
  });
  it('degrades on missing values', () => {
    expect(formatTokens(null)).toBe('—');
    expect(formatTokens(undefined)).toBe('—');
    expect(formatTokens(Number.NaN)).toBe('—');
  });
});

describe('formatCents / formatCost', () => {
  it('formats the design contract sample', () => {
    expect(formatCents(41)).toBe('$0.41');
  });
  it('labels estimated cost and hides unpriced', () => {
    expect(formatCost(41, 'estimated')).toBe('$0.41 est');
    expect(formatCost(41, 'reported')).toBe('$0.41');
    expect(formatCost(41, 'unpriced')).toBe('—');
    expect(formatCost(null)).toBe('—');
  });
  it('handles zero and sub-cent', () => {
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(0.4)).toBe('<$0.01');
    expect(formatCents(123456)).toBe('$1,235');
  });
});

describe('formatDuration', () => {
  it('matches the transcript samples', () => {
    expect(formatDuration(400)).toBe('400ms');
    expect(formatDuration(4000)).toBe('4s');
    expect(formatDuration(4400)).toBe('4.4s');
    expect(formatDuration(252_000)).toBe('4m12s');
    expect(formatDuration(3_720_000)).toBe('1h02m');
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(-1)).toBe('—');
  });
});

describe('relative time', () => {
  const now = new Date('2026-09-04T12:00:00Z');
  it('formats ages', () => {
    expect(formatRelative('2026-09-04T11:58:00Z', now)).toBe('2m ago');
    expect(formatRelative('2026-09-04T09:00:00Z', now)).toBe('3h ago');
    expect(formatRelative('2026-08-29T12:00:00Z', now)).toBe('6d ago');
    expect(formatRelative('2026-09-04T11:59:59Z', now)).toBe('just now');
    expect(formatRelative(null, now)).toBe('—');
    expect(formatRelative('not a date', now)).toBe('—');
  });
  it('formats short ages', () => {
    expect(formatAge('2026-09-04T11:56:00Z', now)).toBe('4m');
    expect(formatAge('2026-07-04T12:00:00Z', now)).toBe('8w');
  });
});

describe('misc formatters', () => {
  it('formats deltas with a real minus sign', () => {
    expect(formatDelta(120, 100)).toBe('+20%');
    expect(formatDelta(92, 100)).toBe('−8%');
    expect(formatDelta(100, 100)).toBe('±0%');
    expect(formatDelta(5, 0)).toBe('new');
    expect(formatDelta(0, 0)).toBe('—');
  });
  it('formats the reported share and diff stats', () => {
    expect(formatReportedShare(0.79)).toBe('79% reported');
    expect(formatReportedShare(null)).toBeNull();
    expect(formatDiffStat(18, 2)).toBe('+18 −2');
    expect(formatDiffStat(null, null)).toBeNull();
  });
  it('joins meta parts with an interpunct and skips blanks', () => {
    expect(joinMeta('ACME-42', null, '18.4k tok', '', '$0.41')).toBe('ACME-42 · 18.4k tok · $0.41');
  });
  it('collapses and ellipsises text', () => {
    expect(oneLine('  a\n\n  b  ')).toBe('a b');
    expect(oneLine('abcdef', 4)).toBe('abc…');
    expect(oneLine(null)).toBe('');
  });
  it('derives initials', () => {
    expect(initials('Backend Engineer')).toBe('BE');
    expect(initials('conductor')).toBe('CO');
    expect(initials(null)).toBe('··');
  });
});

describe('formatCountdown', () => {
  const now = new Date('2026-09-05T17:35:00.000Z');
  it('keeps minutes visible inside the hour and the day', () => {
    expect(formatCountdown('2026-09-05T18:22:00.000Z', now)).toBe('47m');
    expect(formatCountdown('2026-09-05T19:45:00.000Z', now)).toBe('2h 10m');
    expect(formatCountdown('2026-09-05T19:35:00.000Z', now)).toBe('2h');
    expect(formatCountdown('2026-09-10T01:59:59.000Z', now)).toBe('4d 8h');
  });
  it('says now once the moment has passed, and nothing when there is no moment', () => {
    expect(formatCountdown('2026-09-05T17:35:00.000Z', now)).toBe('now');
    expect(formatCountdown('2026-09-05T10:00:00.000Z', now)).toBe('now');
    expect(formatCountdown(null, now)).toBeNull();
    expect(formatCountdown('not a date', now)).toBeNull();
  });
});
