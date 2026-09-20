import { describe, expect, it } from 'vitest';
import { draftSummary } from './planDrafts.js';

describe('draftSummary', () => {
  it('prefers the draft summary when set', () => {
    expect(draftSummary({ summary: 'A short note.', description: 'Full text. More.' })).toBe('A short note.');
  });

  it('trims a whitespace-padded summary', () => {
    expect(draftSummary({ summary: '  spaced  ', description: '' })).toBe('spaced');
  });

  it('falls back to the first sentence of the description', () => {
    expect(draftSummary({ summary: null, description: 'First one. Second one. Third.' })).toBe('First one.');
  });

  it('collapses newlines before taking the first sentence', () => {
    expect(draftSummary({ summary: null, description: 'First line\nsecond line. Rest.' })).toBe('First line second line.');
  });

  it('treats an empty or whitespace summary as unset', () => {
    expect(draftSummary({ summary: '   ', description: 'Only a description' })).toBe('Only a description');
  });

  it('returns the whole description when it has no sentence terminator', () => {
    expect(draftSummary({ summary: null, description: 'no terminator here' })).toBe('no terminator here');
  });

  it('returns empty for a draft with neither summary nor description', () => {
    expect(draftSummary({ summary: null, description: '' })).toBe('');
  });
});
