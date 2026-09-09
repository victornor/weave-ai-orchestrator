import { describe, expect, it } from 'vitest';
import { PALETTE, projectColorVar } from '../lib/projectColor';

describe('projectColorVar', () => {
  it('returns the same value for the same id on every call', () => {
    const a = projectColorVar('01M1Q5F50N40BNCVFQZ68NZ9D0');
    const b = projectColorVar('01M1Q5F50N40BNCVFQZ68NZ9D0');
    expect(a).toBe(b);
    expect(PALETTE).toContain(a);
  });

  it('spreads a small set of distinct ids across more than one palette slot', () => {
    const ids = ['p-web', 'p-api', 'p-infra', 'p-docs', 'p-mobile'];
    const colours = new Set(ids.map(projectColorVar));
    expect(colours.size).toBeGreaterThan(1);
    for (const c of colours) expect(PALETTE).toContain(c);
  });

  it('is a pure function of the id: no Date, no Math.random, no globals', () => {
    const source = projectColorVar.toString();
    expect(source).not.toMatch(/Math\.random/);
    expect(source).not.toMatch(/\bDate\b/);
    expect(source).not.toMatch(/localStorage|sessionStorage/);
  });
});
