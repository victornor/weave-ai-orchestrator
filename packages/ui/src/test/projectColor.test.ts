import { describe, expect, it } from 'vitest';
import { PALETTE, projectColorVar } from '../lib/projectColor';

function collidingPair(): [string, string] {
  const bySlot = new Map<string, string>();
  for (let i = 0; i < 10_000; i++) {
    const id = `c${i}`;
    const slot = projectColorVar(id);
    const other = bySlot.get(slot);
    if (other) return other < id ? [other, id] : [id, other];
    bySlot.set(slot, id);
  }
  throw new Error('no hash collision in 10000 ids');
}

function occupyingAllSlots(): string[] {
  const bySlot = new Map<string, string>();
  for (let i = 0; i < 10_000 && bySlot.size < PALETTE.length; i++) {
    const id = `u${i}`;
    const slot = projectColorVar(id);
    if (!bySlot.has(slot)) bySlot.set(slot, id);
  }
  if (bySlot.size !== PALETTE.length) throw new Error('could not occupy every slot');
  return [...bySlot.values()].sort();
}

function after(ids: readonly string[]): string {
  return `${[...ids].sort().at(-1)!}z`;
}

describe('projectColorVar', () => {
  it('returns the same value for the same id on every call', () => {
    const a = projectColorVar('01M1Q5F50N40BNCVFQZ68NZ9D0');
    const b = projectColorVar('01M1Q5F50N40BNCVFQZ68NZ9D0');
    expect(a).toBe(b);
    expect(PALETTE).toContain(a);
  });

  it('spreads a small set of distinct ids across more than one palette slot', () => {
    const ids = ['p-web', 'p-api', 'p-infra', 'p-docs', 'p-mobile'];
    const colours = new Set(ids.map((id) => projectColorVar(id, ids)));
    expect(colours.size).toBeGreaterThan(1);
    for (const c of colours) expect(PALETTE).toContain(c);
  });

  it('is a pure function of the id: no Date, no Math.random, no globals', () => {
    const source = projectColorVar.toString();
    expect(source).not.toMatch(/Math\.random/);
    expect(source).not.toMatch(/\bDate\b/);
    expect(source).not.toMatch(/localStorage|sessionStorage/);
  });

  it('gives two ids that hash to the same slot different colours when a slot is free', () => {
    const [earlier, later] = collidingPair();
    expect(projectColorVar(earlier)).toBe(projectColorVar(later));
    const siblings = [earlier, later];
    expect(projectColorVar(earlier, siblings)).not.toBe(projectColorVar(later, siblings));
    expect(PALETTE).toContain(projectColorVar(earlier, siblings));
    expect(PALETTE).toContain(projectColorVar(later, siblings));
  });

  it('does not change an earlier id’s colour when a later sibling is added', () => {
    const [earlier, later] = collidingPair();
    expect(projectColorVar(earlier, [earlier, later])).toBe(projectColorVar(earlier));
  });

  it('never reuses a colour already in the set while a slot is free', () => {
    const [earlier, later] = collidingPair();
    const taken = [earlier, later];
    const third = after(taken);
    const all = [...taken, third];
    const colours = new Set(all.map((id) => projectColorVar(id, all)));
    expect(colours.size).toBe(3);
  });

  it('gives a new id a least-used colour when every slot is taken', () => {
    const five = occupyingAllSlots();
    expect(new Set(five.map((id) => projectColorVar(id, five))).size).toBe(PALETTE.length);
    const sixth = after(five);
    const six = [...five, sixth];
    const counts = new Map<string, number>();
    for (const id of six) {
      const c = projectColorVar(id, six);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(6);
    expect(Math.max(...counts.values())).toBe(2);
    expect(Math.min(...counts.values())).toBe(1);
    expect(projectColorVar(sixth, six)).toBe(projectColorVar(sixth));
  });

  it('is stable for the same id and sibling set', () => {
    const ids = ['p-web', 'p-api', 'p-infra'];
    expect(projectColorVar('p-api', ids)).toBe(projectColorVar('p-api', [...ids].reverse()));
  });
});
