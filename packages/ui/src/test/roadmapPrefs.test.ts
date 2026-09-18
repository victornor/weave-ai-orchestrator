/** The Roadmap page's per-device expanded-block memory (`v2/prefs.ts`, VS-548). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readRoadmapExpanded, writeRoadmapExpanded } from '../v2/prefs';

const KEY = 'weave.v2.roadmap.expanded';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('reading', () => {
  it('reads nothing remembered as an empty set, so every block starts collapsed', () => {
    expect([...readRoadmapExpanded()]).toEqual([]);
  });

  it('reads back what was written', () => {
    writeRoadmapExpanded(new Set(['b1', 'b2']));
    expect([...readRoadmapExpanded()].sort()).toEqual(['b1', 'b2']);
  });

  it('treats an unparseable value as nothing remembered', () => {
    localStorage.setItem(KEY, '{not json');
    expect([...readRoadmapExpanded()]).toEqual([]);
  });

  it('treats a non-array value as nothing remembered', () => {
    localStorage.setItem(KEY, JSON.stringify({ b1: true }));
    expect([...readRoadmapExpanded()]).toEqual([]);
  });

  it('drops non-string entries rather than trusting them', () => {
    localStorage.setItem(KEY, JSON.stringify(['b1', 3, null]));
    expect([...readRoadmapExpanded()]).toEqual(['b1']);
  });

  it('survives a localStorage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('private mode'); });
    expect([...readRoadmapExpanded()]).toEqual([]);
  });
});

describe('writing', () => {
  it('does not throw when the write is refused', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => writeRoadmapExpanded(new Set(['b1']))).not.toThrow();
  });
});
