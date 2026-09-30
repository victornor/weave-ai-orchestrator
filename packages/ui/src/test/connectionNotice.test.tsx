/** VS-765: the shell shows the daemon-wide stream's state on every page, and Details says why it reopened. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGlobalConnection } from '../api/globalConnection';
import { BACKOFF, CONNECT_TIMEOUT_MS, recordReopen, resetReconnectLog } from '../api/sseStream';
import { resetGlobalStream } from '../api/streams';
import { ConnectionBanner } from '../components/ConnectionBanner';

class FakeEventSource {
  static open: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) { FakeEventSource.open.push(this); }
  addEventListener(): void { /* named event types */ }
  close(): void { this.closed = true; }
}
const last = (): FakeEventSource => FakeEventSource.open[FakeEventSource.open.length - 1]!;

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.open = [];
  resetReconnectLog();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200 })));
});
afterEach(() => {
  resetGlobalStream();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useGlobalConnection', () => {
  const wrapper = ({ children }: { children: ReactNode }): React.ReactElement => (
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
  );

  it('follows the daemon-wide stream through a drop and a recovery, opening one connection', () => {
    const { result } = renderHook(() => useGlobalConnection(), { wrapper });
    expect(FakeEventSource.open).toHaveLength(1);
    act(() => { last().onopen?.(); });
    expect(result.current.state).toBe('connected');
    act(() => { last().onerror?.(); });
    expect(result.current.state).toBe('reconnecting');
    act(() => { vi.advanceTimersByTime(BACKOFF[0]!); });
    act(() => { last().onopen?.(); });
    expect(result.current.state).toBe('connected');
    expect(FakeEventSource.open).toHaveLength(2);
  });

  it('shows reconnecting while an attempt hangs with no error', () => {
    const { result } = renderHook(() => useGlobalConnection(), { wrapper });
    act(() => { last().onopen?.(); });
    act(() => { last().onerror?.(); vi.advanceTimersByTime(BACKOFF[0]!); });
    act(() => { vi.advanceTimersByTime(CONNECT_TIMEOUT_MS); });
    expect(result.current.state).toBe('reconnecting');
  });
});

describe('ConnectionBanner details', () => {
  it('is silent while connected and offers Details once the stream is down', () => {
    const { container, rerender } = render(<ConnectionBanner state="connected" capturedAt={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ConnectionBanner state="reconnecting" capturedAt={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');
    expect(screen.queryByLabelText('Recent reconnects')).toBeNull();
  });

  it('lists the recorded reopens with their cause, last-frame age and health probe', () => {
    const entry = recordReopen('workspace:acme', 'silence', 0, Date.now() - 41_000);
    entry.probe = 'network';
    render(<ConnectionBanner state="stale" capturedAt={null} lastFrameAt={Date.now() - 41_000} />);
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    const list = screen.getByLabelText('Recent reconnects');
    expect(list).toHaveTextContent('workspace:acme');
    expect(list).toHaveTextContent('nothing received');
    expect(list).toHaveTextContent('last frame 41s earlier');
    expect(list).toHaveTextContent('daemon check: network');
    fireEvent.click(screen.getByRole('button', { name: 'Hide details' }));
    expect(screen.queryByLabelText('Recent reconnects')).toBeNull();
  });
});
