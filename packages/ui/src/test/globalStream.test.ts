import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalEventStream } from '../api/events';
import { qk } from '../api/keys';
import { resetDocumentVisible, setDocumentHidden } from './visibility';

class FakeEventSource {
  static open: FakeEventSource[] = [];
  readonly listeners = new Map<string, Array<(m: MessageEvent<string>) => void>>();
  onopen: (() => void) | null = null;
  onmessage: ((m: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) { FakeEventSource.open.push(this); }
  addEventListener(type: string, fn: (m: MessageEvent<string>) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  close(): void { this.closed = true; }
  emit(type: string, message: MessageEvent<string>): void { for (const listener of this.listeners.get(type) ?? []) listener(message); }
}

beforeEach(() => {
  FakeEventSource.open = [];
  resetDocumentVisible();
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => {
  resetDocumentVisible();
  vi.unstubAllGlobals();
});

describe('global event stream', () => {
  it('resumes with the opaque cursor from the last durable frame', () => {
    const stream = new GlobalEventStream(new QueryClient());
    stream.start();
    const source = FakeEventSource.open[0]!;
    source.emit('ticket.created', { data: JSON.stringify({ seq: 3, workspaceId: 'ws1', type: 'ticket.created', entityId: 't1', createdAt: 'now' }), lastEventId: 'eyJ3czEiOjN9' } as MessageEvent<string>);
    source.onerror!();
    stream.retryNow();
    expect(FakeEventSource.open.at(-1)?.url).toBe('/api/events?after=eyJ3czEiOjN9');
    stream.stop();
  });

  it('refreshes every workspace it saw an event for on a reconnect (VS-641)', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries').mockReturnValue(Promise.resolve());
    const stream = new GlobalEventStream(qc);
    stream.start();
    const first = FakeEventSource.open[0]!;
    first.emit('ticket.created', { data: JSON.stringify({ seq: 1, workspaceId: 'ws1', type: 'ticket.created', entityId: 't1', createdAt: 'now' }) } as MessageEvent<string>);
    first.emit('ticket.created', { data: JSON.stringify({ seq: 2, workspaceId: 'ws2', type: 'ticket.created', entityId: 't2', createdAt: 'now' }) } as MessageEvent<string>);
    first.onopen!();
    spy.mockClear();

    stream.retryNow();
    FakeEventSource.open.at(-1)!.onopen!();

    expect(spy).toHaveBeenCalledWith({ queryKey: qk.workers('ws1') });
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.workers('ws2') });
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.workspaces() });
    stream.stop();
  });

  it('invalidates the slug the page fetched when the frame carries the row id (VS-706)', () => {
    const qc = new QueryClient();
    qc.setQueryData(qk.workspaces(), [{ id: 'vs706', internalId: '01ULIDWORKSPACE000000000', name: 'VS-706' }]);
    const ticketKey = [...qk.tickets('vs706'), { limit: 300 }];
    qc.setQueryData(ticketKey, [{ id: 't1', title: 'STALE-TITLE' }]);
    const stream = new GlobalEventStream(qc);
    stream.start();
    try {
      const source = FakeEventSource.open[0]!;
      source.onopen!();
      let seenId = '';
      stream.onEvent((e) => { seenId = e.workspaceId; });
      source.emit('ticket.updated', {
        data: JSON.stringify({ seq: 4, workspaceId: '01ULIDWORKSPACE000000000', type: 'ticket.updated', entityId: 't1', createdAt: 'now' }),
        lastEventId: 'cursor',
      } as MessageEvent<string>);
      expect(seenId).toBe('vs706');
      expect(qc.getQueryState(ticketKey)?.isInvalidated).toBe(true);
      expect(qc.getQueryState([...qk.tickets('01ULIDWORKSPACE000000000')])?.isInvalidated).not.toBe(true);
    } finally {
      stream.stop();
    }
  });

  it('refetches a held workspace on reconnect even when no frame has named it yet (VS-706)', () => {
    const qc = new QueryClient();
    qc.setQueryData(qk.workspaces(), [{ id: 'vs706', internalId: '01ULIDWORKSPACE000000000', name: 'VS-706' }]);
    const workerKey = [...qk.workers('vs706'), {}];
    qc.setQueryData(workerKey, [{ id: 'a1', status: 'running' }]);
    const stream = new GlobalEventStream(qc);
    stream.start();
    FakeEventSource.open[0]!.onopen!();
    stream.retryNow();
    FakeEventSource.open.at(-1)!.onopen!();
    expect(qc.getQueryState(workerKey)?.isInvalidated).toBe(true);
    stream.stop();
  });

  it('closes while hidden and reconnects with its cursor on refocus', () => {
    const stream = new GlobalEventStream(new QueryClient());
    stream.start();
    const source = FakeEventSource.open[0]!;
    source.emit('worker.activity', { data: JSON.stringify({ seq: 0, workspaceId: 'ws1', type: 'worker.activity', entityId: 'a1', createdAt: 'now' }) } as MessageEvent<string>);
    setDocumentHidden(true);
    expect(source.closed).toBe(true);
    expect(stream.getStatus().state).toBe('hidden');
    setDocumentHidden(false);
    expect(FakeEventSource.open).toHaveLength(2);
    expect(FakeEventSource.open[1]?.url).toBe('/api/events');
    stream.stop();
  });
});
