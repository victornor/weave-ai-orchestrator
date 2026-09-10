import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'ac:scroll-diag';
const SAMPLE = { event: 'scroll' as const, scrollTop: 0, scrollHeight: 0, clientHeight: 0, atBottom: true, following: true, opened: true };

describe('scrollDiagnostics', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });
  afterEach(() => {
    localStorage.clear();
    delete (window as unknown as { __acScrollDiagnostics?: unknown }).__acScrollDiagnostics;
  });

  it('records nothing when the flag was never set', async () => {
    const { record, diagnostics } = await import('./scrollDiagnostics');
    record(SAMPLE);
    record(SAMPLE);
    expect(diagnostics()).toEqual([]);
  });

  it('records once enabled before the module loads', async () => {
    localStorage.setItem(KEY, '1');
    const { record, diagnostics } = await import('./scrollDiagnostics');
    record(SAMPLE);
    expect(diagnostics()).toHaveLength(1);
    expect(diagnostics()[0]).toMatchObject(SAMPLE);
  });

  it('ignores the flag flipped on after the module already loaded', async () => {
    const { record, diagnostics } = await import('./scrollDiagnostics');
    localStorage.setItem(KEY, '1');
    record(SAMPLE);
    expect(diagnostics()).toEqual([]);
  });

  it('caps the buffer, dropping the oldest sample first', async () => {
    localStorage.setItem(KEY, '1');
    const { record, diagnostics } = await import('./scrollDiagnostics');
    for (let i = 0; i < 305; i++) record({ ...SAMPLE, scrollTop: i });
    const all = diagnostics();
    expect(all).toHaveLength(300);
    expect(all[0]!.scrollTop).toBe(5);
    expect(all[all.length - 1]!.scrollTop).toBe(304);
  });

  it('exposes the capture on window for a devtools console to reach', async () => {
    localStorage.setItem(KEY, '1');
    const { record } = await import('./scrollDiagnostics');
    record(SAMPLE);
    const exported = (window as unknown as { __acScrollDiagnostics: () => unknown[] }).__acScrollDiagnostics();
    expect(exported).toHaveLength(1);
  });
});
