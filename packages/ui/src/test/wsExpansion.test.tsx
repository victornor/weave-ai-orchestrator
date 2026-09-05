/** The sidebar's per-device expansion memory (`lib/wsExpansion.ts`). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readExpanded, toggleExpanded, writeExpanded } from '../lib/wsExpansion';

const KEY = 'conductor.ws.expanded';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('reading', () => {
  it('reads nothing remembered as an empty set', () => {
    expect(readExpanded()).toEqual([]);
  });

  it('reads back what was written', () => {
    writeExpanded(['alpha', 'beta']);
    expect(readExpanded()).toEqual(['alpha', 'beta']);
  });

  it('treats an unparseable value as nothing remembered', () => {
    localStorage.setItem(KEY, '{not json');
    expect(readExpanded()).toEqual([]);
  });

  it('drops non-string entries rather than rendering them', () => {
    localStorage.setItem(KEY, JSON.stringify(['alpha', 3, null]));
    expect(readExpanded()).toEqual(['alpha']);
  });

  it('survives a localStorage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('private mode'); });
    expect(readExpanded()).toEqual([]);
  });
});

describe('toggling', () => {
  it('adds a workspace and persists it', () => {
    expect(toggleExpanded([], 'alpha')).toEqual(['alpha']);
    expect(readExpanded()).toEqual(['alpha']);
  });

  it('removes one that was open, leaving the others', () => {
    expect(toggleExpanded(['alpha', 'beta'], 'alpha')).toEqual(['beta']);
    expect(readExpanded()).toEqual(['beta']);
  });

  it('carries a key for a workspace that is no longer reported', () => {
    expect(toggleExpanded(['gone', 'alpha'], 'alpha')).toEqual(['gone']);
  });

  it('does not throw when the write is refused', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(toggleExpanded([], 'alpha')).toEqual(['alpha']);
  });
});
