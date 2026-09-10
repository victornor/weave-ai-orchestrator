/**
 * Switching workspace is a navigation, not a reload: `WorkspaceProvider` swaps the event stream and
 * the remembered workspace when the route's `ws` changes (VS-46).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceProvider } from '../api/context';

interface Opened { url: string; closed: boolean }
const opened: Opened[] = [];

class TrackingEventSource {
  private readonly record: Opened;
  onopen: unknown = null;
  onerror: unknown = null;
  onmessage: unknown = null;
  constructor(url: string) {
    this.record = { url, closed: false };
    opened.push(this.record);
  }
  addEventListener(): void { /* named frames are not what this test is about */ }
  close(): void { this.record.closed = true; }
}

beforeEach(() => {
  opened.length = 0;
  localStorage.clear();
  (globalThis as unknown as { EventSource: unknown }).EventSource = TrackingEventSource;
});

const shell = (ws: string): React.ReactElement => (
  <QueryClientProvider client={new QueryClient()}>
    <WorkspaceProvider ws={ws}>
      <div>body</div>
    </WorkspaceProvider>
  </QueryClientProvider>
);

describe('changing the workspace', () => {
  it('opens that workspace’s stream and closes the previous one', () => {
    const view = render(shell('alpha'));
    expect(opened.map((o) => o.url)).toEqual(['/api/w/alpha/events']);

    view.rerender(shell('beta'));
    expect(opened[0]?.closed).toBe(true);
    expect(opened[1]?.url).toBe('/api/w/beta/events');
    expect(opened[1]?.closed).toBe(false);
  });

  it('remembers the workspace it switched to', () => {
    const view = render(shell('alpha'));
    expect(localStorage.getItem('conductor.ws')).toBe('alpha');
    view.rerender(shell('beta'));
    expect(localStorage.getItem('conductor.ws')).toBe('beta');
  });

  it('does not write conductor.ws when remember is false', () => {
    localStorage.setItem('conductor.ws', 'kept');
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkspaceProvider ws="alpha" remember={false}>
          <div>body</div>
        </WorkspaceProvider>
      </QueryClientProvider>,
    );
    expect(localStorage.getItem('conductor.ws')).toBe('kept');
  });

  it('keeps the children mounted across the switch', () => {
    const view = render(shell('alpha'));
    const body = view.getByText('body');
    view.rerender(shell('beta'));
    expect(view.getByText('body')).toBe(body);
  });
});

describe('the live prop (VS-199)', () => {
  it('opens no stream when live is false', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkspaceProvider ws="alpha" live={false}>
          <div>body</div>
        </WorkspaceProvider>
      </QueryClientProvider>,
    );
    expect(opened).toHaveLength(0);
  });

  it('still opens a stream when live is omitted', () => {
    render(shell('alpha'));
    expect(opened.map((o) => o.url)).toEqual(['/api/w/alpha/events']);
  });

  it('opens a stream on becoming live, and closes it on becoming unfocused again', () => {
    const withLive = (live: boolean): React.ReactElement => (
      <QueryClientProvider client={new QueryClient()}>
        <WorkspaceProvider ws="alpha" live={live}>
          <div>body</div>
        </WorkspaceProvider>
      </QueryClientProvider>
    );
    const view = render(withLive(false));
    expect(opened).toHaveLength(0);

    view.rerender(withLive(true));
    expect(opened.map((o) => o.url)).toEqual(['/api/w/alpha/events']);
    expect(opened[0]?.closed).toBe(false);

    view.rerender(withLive(false));
    expect(opened[0]?.closed).toBe(true);
  });
});
