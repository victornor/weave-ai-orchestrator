import { describe, expect, it } from 'vitest';
import { compactRpcScript } from '../src/compact.js';

describe('codex compact RPC sequence', () => {
  it('initialises, resumes the thread, then asks it to compact', () => {
    const script = compactRpcScript('01a0ad50-5893-7892-9690-c096e6f95731');
    expect(script.map((s) => s.method)).toEqual(['initialize', 'initialized', 'thread/resume', 'thread/compact/start']);
    expect(script[0]!.params?.['clientInfo']).toBeTruthy();
    expect(script[2]!.params).toEqual({ threadId: '01a0ad50-5893-7892-9690-c096e6f95731' });
    expect(script[3]!.params).toEqual({ threadId: '01a0ad50-5893-7892-9690-c096e6f95731' });
  });

  it('marks only the notification without an id', () => {
    const script = compactRpcScript('t');
    expect(script.filter((s) => s.id === undefined).map((s) => s.method)).toEqual(['initialized']);
    expect(script.filter((s) => s.id !== undefined).map((s) => s.id)).toEqual([1, 2, 3]);
  });
});
