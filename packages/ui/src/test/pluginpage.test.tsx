import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceEvent } from '@weave-ai/shared';
import type { WorkspacePlugin } from '../api/types';

type EventHandler = (ev: WorkspaceEvent) => void;
const state = vi.hoisted(() => ({
  plugins: [] as WorkspacePlugin[],
  isLoading: false,
  eventHandler: null as EventHandler | null,
}));
const client = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ pluginId: 'notes' }) }));
vi.mock('../api/context', () => ({
  useWorkspace: () => ({
    ws: 'ws1', connection: { state: 'connected' },
    stream: { onEvent: (fn: EventHandler) => { state.eventHandler = fn; return () => { state.eventHandler = null; }; } },
  }),
}));
vi.mock('../api/hooks', () => ({
  useWorkspaceSummary: () => ({ data: { plugins: state.plugins }, isLoading: state.isLoading, isError: false }),
}));
vi.mock('../api/client', () => ({
  request: (...args: unknown[]) => client.request(...args),
  ApiError: class ApiError extends Error {
    code: string; status: number;
    constructor(status: number, body: { code: string; message: string }) { super(body.message); this.code = body.code; this.status = status; }
  },
}));

const { PluginPageRoute } = await import('../routes/PluginPage');

afterEach(() => {
  cleanup();
  state.plugins = [];
  state.isLoading = false;
  state.eventHandler = null;
  client.request.mockReset();
});

function loadedPlugin(over: Partial<WorkspacePlugin> = {}): WorkspacePlugin {
  return { id: 'notes', version: '0.1.0', name: null, source: 'workspace', loaded: true, error: null, hasPage: true, ...over };
}

describe('PluginPageRoute (VS-334)', () => {
  it('shows a not-found state when the workspace does not load this plugin', () => {
    state.plugins = [];
    render(<PluginPageRoute />);
    expect(screen.getByText('Plugin page not found.')).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('shows a not-found state for a plugin that loaded but registered no page', () => {
    state.plugins = [{ id: 'notes', version: '0.1.0', name: null, source: 'workspace', loaded: true, error: null, hasPage: false }];
    render(<PluginPageRoute />);
    expect(screen.getByText('Plugin page not found.')).toBeInTheDocument();
  });

  it('shows a not-found state for a plugin that failed to load', () => {
    state.plugins = [{ id: 'notes', version: null, name: null, source: 'workspace', loaded: false, error: 'boom', hasPage: true }];
    render(<PluginPageRoute />);
    expect(screen.getByText('Plugin page not found.')).toBeInTheDocument();
  });

  it('renders the opaque-origin sandboxed iframe for a loaded plugin with a page', () => {
    state.plugins = [{ id: 'notes', version: '0.1.0', name: null, source: 'workspace', loaded: true, error: null, hasPage: true }];
    render(<PluginPageRoute />);
    const frame = document.querySelector('iframe');
    expect(frame).toBeTruthy();
    expect(frame?.getAttribute('src')).toBe('/api/w/ws1/plugins/notes/page');
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts allow-forms');
    // No allow-same-origin: the page must never carry the viewer's session.
    expect(frame?.getAttribute('sandbox')).not.toContain('allow-same-origin');
  });
});

describe('PluginPageRoute postMessage bridge (VS-334, task 5.4)', () => {
  it('proxies a same-plugin request from the iframe and posts the response back', async () => {
    client.request.mockResolvedValueOnce({ notes: [] });
    state.plugins = [loadedPlugin()];
    render(<PluginPageRoute />);
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    const postSpy = vi.spyOn(frame.contentWindow!, 'postMessage');

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'request', id: '1', method: 'GET', path: '/notes' }, source: frame.contentWindow! }));
    await vi.waitFor(() => expect(postSpy).toHaveBeenCalled());

    expect(client.request).toHaveBeenCalledWith('/api/w/ws1/plugins/notes/notes', { method: 'GET', body: undefined });
    expect(postSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'response', id: '1', ok: true, status: 200, data: { notes: [] } }), '*');
  });

  it('sends no stylesheet or theme message (VS-385: that push is V2-only)', () => {
    state.plugins = [loadedPlugin()];
    render(<PluginPageRoute />);
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    const postSpy = vi.spyOn(frame.contentWindow!, 'postMessage');
    // V1 wires no `onLoad` at all, but fire one anyway: this must stay a no-op here even if a
    // later change starts using the iframe's load event for something else.
    fireEvent.load(frame);
    expect(postSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'stylesheet' }), '*');
    expect(postSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'theme' }), '*');
  });

  it('ignores a message whose source is not the hosted iframe', () => {
    state.plugins = [loadedPlugin()];
    render(<PluginPageRoute />);
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'request', id: '1', method: 'GET', path: '/notes' }, source: window }));
    expect(client.request).not.toHaveBeenCalled();
  });

  it('rejects a request whose path escapes this plugin\'s prefix, without calling request', () => {
    state.plugins = [loadedPlugin()];
    render(<PluginPageRoute />);
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    const postSpy = vi.spyOn(frame.contentWindow!, 'postMessage');

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'request', id: '2', method: 'DELETE', path: '/../../plugin-data/notes' }, source: frame.contentWindow! }));

    expect(client.request).not.toHaveBeenCalled();
    expect(postSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'response', id: '2', ok: false }), '*');
  });

  it('forwards only a subscribed plugin.event whose payload names this plugin and kind', () => {
    state.plugins = [loadedPlugin()];
    render(<PluginPageRoute />);
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    const postSpy = vi.spyOn(frame.contentWindow!, 'postMessage');

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'subscribe', kind: 'note.created' }, source: frame.contentWindow! }));
    expect(state.eventHandler).not.toBeNull();

    // A different plugin's event: not forwarded.
    state.eventHandler!({ type: 'plugin.event', entityType: 'plugin:other', entityId: 'x', seq: 1, createdAt: '', payload: { pluginId: 'other', kind: 'note.created', payload: {} } } as unknown as WorkspaceEvent);
    expect(postSpy).not.toHaveBeenCalled();

    // An unsubscribed kind, same plugin: not forwarded.
    state.eventHandler!({ type: 'plugin.event', entityType: 'plugin:notes', entityId: 'x', seq: 2, createdAt: '', payload: { pluginId: 'notes', kind: 'other.kind', payload: {} } } as unknown as WorkspaceEvent);
    expect(postSpy).not.toHaveBeenCalled();

    // The subscribed kind, same plugin: forwarded.
    state.eventHandler!({ type: 'plugin.event', entityType: 'plugin:notes', entityId: 'x', seq: 3, createdAt: '', payload: { pluginId: 'notes', kind: 'note.created', payload: { text: 'hi' } } } as unknown as WorkspaceEvent);
    expect(postSpy).toHaveBeenCalledWith({ type: 'event', kind: 'note.created', payload: { text: 'hi' } }, '*');
  });
});
