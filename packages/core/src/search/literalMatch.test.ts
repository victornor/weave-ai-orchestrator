import { describe, expect, it } from 'vitest';
import { literalSnippet, needsLiteralMatch } from './literalMatch.js';

describe('needsLiteralMatch', () => {
  it('is true for a query the tokenizer would separate on', () => {
    expect(needsLiteralMatch('_password')).toBe(true);
    expect(needsLiteralMatch('foo.bar')).toBe(true);
    expect(needsLiteralMatch('foo-bar')).toBe(true);
    expect(needsLiteralMatch('a/b')).toBe(true);
    expect(needsLiteralMatch('user@host')).toBe(true);
  });

  it('is false for a plain word query', () => {
    expect(needsLiteralMatch('password')).toBe(false);
    expect(needsLiteralMatch('two words')).toBe(false);
    expect(needsLiteralMatch('  padded  ')).toBe(false);
  });
});

describe('literalSnippet', () => {
  it('wraps the exact matched substring in STX/ETX delimiters', () => {
    const snippet = literalSnippet('the value is _password here', '_password');
    expect(snippet).toContain('\u0002_password\u0003');
  });

  it('preserves the original casing of the match', () => {
    const snippet = literalSnippet('reset your _PASSWORD now', '_password');
    expect(snippet).toContain('\u0002_PASSWORD\u0003');
  });

  it('truncates with an ellipsis outside the context window', () => {
    const body = `${'x'.repeat(100)}_password${'y'.repeat(100)}`;
    const snippet = literalSnippet(body, '_password', { contextChars: 10 });
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).toContain('\u0002_password\u0003');
  });

  it('does not truncate when the match is near an edge', () => {
    const snippet = literalSnippet('_password at the very start', '_password', { contextChars: 40 });
    expect(snippet.startsWith('…')).toBe(false);
  });

  it('uses the caller-supplied delimiters instead of the default STX/ETX pair', () => {
    const snippet = literalSnippet('reset your _password here', '_password', { open: '[', close: ']' });
    expect(snippet).toContain('[_password]');
  });
});
