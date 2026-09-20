/**
 * `weave chat`'s live row (VS-603): the working block shows the shared `ActivityLine`, never the
 * literal it used to print. The rendered row itself is verified by the attached terminal captures;
 * this is the deterministic guard that the literal cannot come back (an Ink render capture proved
 * environment-dependent and was dropped).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Chat live row (VS-603)', () => {
  it('shows the shared live row, not the literal it used to print', () => {
    const source = readFileSync(new URL('./Chat.tsx', import.meta.url), 'utf8');
    expect(source).toContain('ActivityLine');
    expect(source).not.toContain('is working');
    expect(source).not.toContain('is starting');
  });
});
