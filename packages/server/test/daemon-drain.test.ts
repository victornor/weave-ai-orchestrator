/**
 * VS-262: `POST /api/daemon/drain` cancels whatever is still running when its own budget runs out,
 * instead of only reporting it and leaving the kill signal that follows to (fail to) interrupt it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { authed, makeHarness, type Harness, type HarnessOptions } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

const app = (opts: HarnessOptions = {}) => {
  harness = makeHarness(opts);
  return { h: harness, fetch: (path: string, init?: RequestInit) => createApp(harness!.deps).fetch(new Request(`http://127.0.0.1:7433${path}`, init)) };
};

const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { ...authed(), 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('POST /api/daemon/drain', () => {
  it('reports drained with nothing to cancel when the dispatcher drains in time', async () => {
    const { h, fetch } = app();
    h.impls.dispatcher!.stop = vi.fn(async () => true);
    h.impls.runs!.list = () => ({ items: [], total: 0 });
    const cancel = vi.fn(async () => undefined);
    h.impls.runs!.cancel = cancel;

    const res = await fetch('/api/daemon/drain', post({ timeoutSec: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ drained: true, running: [], workspaces: ['ws1'] });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('cancels whatever is still running when its own timeout elapses, before responding', async () => {
    const { h, fetch } = app();
    h.impls.dispatcher!.stop = vi.fn(async () => false);
    h.impls.runs!.list = () => ({ items: [{ id: 'run_1' }], total: 1 });
    const cancel = vi.fn(async () => undefined);
    h.impls.runs!.cancel = cancel;

    const res = await fetch('/api/daemon/drain', post({ timeoutSec: 0 }));
    expect(res.status).toBe(200);
    const bodyOut = await res.json();
    expect(bodyOut.drained).toBe(false);
    expect(bodyOut.running).toEqual([{ workspace: 'ws1', runId: 'run_1' }]);
    // The run is reported as "still running" only after it was already told to stop.
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel.mock.calls[0]![1]).toBe('run_1');
    expect(cancel.mock.calls[0]![2]).toBe('interrupt');
  });

  it('does not cancel anything when the dispatcher is not given a chance to time out', async () => {
    const { h, fetch } = app();
    h.impls.dispatcher!.stop = vi.fn(async () => true);
    h.impls.runs!.list = () => ({ items: [], total: 0 });
    const cancel = vi.fn(async () => undefined);
    h.impls.runs!.cancel = cancel;

    await fetch('/api/daemon/drain', post({ timeoutSec: 30 }));
    expect(h.impls.dispatcher!.stop).toHaveBeenCalledWith(30_000);
    expect(cancel).not.toHaveBeenCalled();
  });
});
