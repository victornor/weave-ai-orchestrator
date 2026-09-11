import { describe, expect, it } from 'vitest';
import { decodeTime } from 'ulid';
import { newId } from './db.js';

const COUNT = 64;

function batch(): string[] {
  const ids: string[] = [];
  for (let i = 0; i < COUNT; i++) ids.push(newId());
  return ids;
}

describe('newId', () => {
  it('issues strictly increasing ids within a millisecond', () => {
    let ids = batch();
    // A slow machine can span two milliseconds; retry once rather than asserting across a clock tick.
    if (decodeTime(ids[0]!) !== decodeTime(ids.at(-1)!)) ids = batch();
    expect(decodeTime(ids[0]!)).toBe(decodeTime(ids.at(-1)!));
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]! > ids[i - 1]!).toBe(true);
    }
  });
});
