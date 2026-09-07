/** How tall the pinned decision area is, remembered per device (`lib/decisionHeight.ts`, VS-94). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MIN_LIST_PX,
  MIN_PX,
  clampHeight,
  maxHeight,
  readDecisionHeight,
  writeDecisionHeight,
} from '../lib/decisionHeight';

const KEY = 'conductor.decisions.height';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('the remembered height', () => {
  it('opens unresized when nothing was remembered', () => {
    expect(readDecisionHeight()).toBeNull();
  });

  it('reads back a height that was chosen', () => {
    writeDecisionHeight(320);
    expect(localStorage.getItem(KEY)).toBe('320');
    expect(readDecisionHeight()).toBe(320);
  });

  it('stores whole pixels', () => {
    writeDecisionHeight(320.6);
    expect(readDecisionHeight()).toBe(321);
  });

  it('forgets the key outright when the height is given back', () => {
    writeDecisionHeight(320);
    writeDecisionHeight(null);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(readDecisionHeight()).toBeNull();
  });

  it.each(['abc', '0', '-5', ''])('reads %o as never resized', (stored) => {
    localStorage.setItem(KEY, stored);
    expect(readDecisionHeight()).toBeNull();
  });

  it('is unresized when the store cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(readDecisionHeight()).toBeNull();
  });

  it('honours the choice for the session when the store cannot be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => writeDecisionHeight(320)).not.toThrow();
  });
});

describe('the clamps', () => {
  /** A tall window: the area's bottom edge 800px down, the message list starting at 100px. */
  const roomy = { sectionBottom: 800, pageTop: 100 };

  it('leaves a height inside the range alone, rounded', () => {
    expect(clampHeight(300.4, roomy)).toBe(300);
  });

  it('keeps a card heading and its actions on screen at the small end', () => {
    expect(clampHeight(10, roomy)).toBe(MIN_PX);
    expect(clampHeight(-400, roomy)).toBe(MIN_PX);
  });

  it('keeps the composer and a strip of the conversation on screen at the large end', () => {
    // Everything between the list's top and the area's bottom, less the strip the list keeps.
    expect(maxHeight(roomy)).toBe(800 - 100 - MIN_LIST_PX);
    expect(clampHeight(5000, roomy)).toBe(580);
  });

  it('degenerates rather than inverting when the viewport cannot hold both bounds', () => {
    // A phone with the keyboard open: barely any room above the area at all.
    const cramped = { sectionBottom: 300, pageTop: 260 };
    expect(maxHeight(cramped)).toBe(MIN_PX);
    expect(clampHeight(5000, cramped)).toBe(MIN_PX);
    expect(clampHeight(0, cramped)).toBe(MIN_PX);
  });
});
