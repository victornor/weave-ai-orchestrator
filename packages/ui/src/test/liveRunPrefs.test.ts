/** VS-616: the weaver chat's live-output preference — off by default, remembered, and published. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readShowLiveRunOutput, writeShowLiveRunOutput } from '../lib/liveRunPrefs';

const KEY = 'conductor.chat.liveRunOutput';

describe('the live weaver output preference (VS-616)', () => {
  beforeEach(() => localStorage.removeItem(KEY));
  afterEach(() => localStorage.removeItem(KEY));

  it('defaults to off, so unsent text is not shown until asked for', () => {
    expect(readShowLiveRunOutput()).toBe(false);
  });

  it('remembers the choice across reads', () => {
    writeShowLiveRunOutput(true);
    expect(readShowLiveRunOutput()).toBe(true);
    writeShowLiveRunOutput(false);
    expect(readShowLiveRunOutput()).toBe(false);
  });

  it('publishes a same-document event so an open chat follows without a reload', () => {
    const seen = vi.fn();
    window.addEventListener('conductor:chat-live-run-output', seen);
    writeShowLiveRunOutput(true);
    expect(seen).toHaveBeenCalledTimes(1);
    window.removeEventListener('conductor:chat-live-run-output', seen);
  });
});