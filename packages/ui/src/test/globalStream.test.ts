import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalEventStream } from '../api/events';
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
