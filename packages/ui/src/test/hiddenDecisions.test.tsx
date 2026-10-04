import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decision } from './factories';
import { clearHiddenCache, decisionFingerprint, isHiddenFromChat, readHidden, writeHidden, EXPIRY_WINDOW_MS } from '../lib/hiddenDecisions';

const at = '2026-09-01T09:00:00.000Z';
const NOW = Date.parse('2026-09-01T12:00:00.000Z');

/** The store as the chat writes it when the human hides a card. */
const hiddenFor = (d: ReturnType<typeof decision>): Record<string, { fingerprint: string; at: string }> => ({
  [d.id]: { fingerprint: decisionFingerprint(d), at },
});

beforeEach(() => {
  // The store prunes entries over a month old against the real clock; freeze it at NOW so the dated
  // fixtures above do not age out as the calendar moves.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  localStorage.clear();
  clearHiddenCache();
});

afterEach(() => { vi.useRealTimers(); });

describe('hidden decisions', () => {
  it('hides only the decision the entry was taken against', () => {
    const d = decision({ id: 'd1' });
    expect(isHiddenFromChat(d, hiddenFor(d), NOW)).toBe(true);
    expect(isHiddenFromChat(decision({ id: 'd2' }), hiddenFor(d), NOW)).toBe(false);
  });

  it('shows a decision again once its options or its ask have changed', () => {
    const d = decision({ id: 'd1' });
    const store = hiddenFor(d);
    expect(isHiddenFromChat({ ...d, title: 'Approve a different plan?' }, store, NOW)).toBe(false);
    expect(isHiddenFromChat({ ...d, context: 'It touches three files after all.' }, store, NOW)).toBe(false);
    expect(isHiddenFromChat({ ...d, recommendation: 'revise' }, store, NOW)).toBe(false);
    expect(isHiddenFromChat({ ...d, options: [...d.options, { key: 'hold', label: 'Hold' }] }, store, NOW)).toBe(false);
  });

  it('shows a decision that is about to expire whatever was hidden', () => {
    const soon = decision({ id: 'd1', expiresAt: new Date(NOW + EXPIRY_WINDOW_MS - 60_000).toISOString() });
    const later = decision({ id: 'd1', expiresAt: new Date(NOW + EXPIRY_WINDOW_MS + 60_000).toISOString() });
    expect(isHiddenFromChat(soon, hiddenFor(soon), NOW)).toBe(false);
    expect(isHiddenFromChat(later, hiddenFor(later), NOW)).toBe(true);
  });

  it('keeps one workspace’s hidden set out of another’s', () => {
    const d = decision({ id: 'd1' });
    writeHidden('ws1', hiddenFor(d));
    expect(readHidden('ws1')).toEqual(hiddenFor(d));
    expect(readHidden('ws2')).toEqual({});
  });

  it('reads a malformed or emptied store as nothing hidden', () => {
    localStorage.setItem('conductor.decisions.hidden.ws1', '{"d1":');
    expect(readHidden('ws1')).toEqual({});
    writeHidden('ws1', {});
    expect(localStorage.getItem('conductor.decisions.hidden.ws1')).toBeNull();
  });

  it('drops entries older than a month rather than growing forever', () => {
    const d = decision({ id: 'd_old' });
    writeHidden('ws1', { d_old: { fingerprint: decisionFingerprint(d), at: '2020-01-01T00:00:00.000Z' } });
    expect(readHidden('ws1')).toEqual({});
  });
});
