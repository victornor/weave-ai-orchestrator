/** Whether the phone tab bar is hidden, remembered per device (`lib/barVisibility.ts`). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readBarHidden, writeBarHidden } from '../lib/barVisibility';

const KEY = 'conductor.bar.hidden';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('the remembered choice', () => {
  it('opens with the bar showing when nothing was remembered', () => {
    expect(readBarHidden()).toBe(false);
  });

  it('reads back a bar that was hidden', () => {
    writeBarHidden(true);
    expect(localStorage.getItem(KEY)).toBe('1');
    expect(readBarHidden()).toBe(true);
  });

  it('forgets the key outright when the bar is shown again', () => {
    writeBarHidden(true);
    writeBarHidden(false);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(readBarHidden()).toBe(false);
  });

  it('reads anything unrecognised as showing', () => {
    localStorage.setItem(KEY, 'yes');
    expect(readBarHidden()).toBe(false);
  });

  it('shows the bar when the store cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(readBarHidden()).toBe(false);
  });

  it('honours the choice for the session when the store cannot be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => writeBarHidden(true)).not.toThrow();
  });
});
