/** V2PluginPage (VS-385): the V2 home for a plugin's page — same bridge as V1, plus the generated stylesheet/theme push. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceEvent } from '@weave-ai/shared';
import type { WorkspacePlugin } from '../api/types';

type EventHandler = (ev: WorkspaceEvent) => void;
const state = vi.hoisted(() => ({
  plugins: [] as WorkspacePlugin[],
  isLoading: false,
  eventHandler: null as EventHandler | null,
  theme: 'dark' as 'dark' | 'light',
}));
const client = vi.hoisted(() => ({ request: vi.fn(), wsGet: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ pluginId: 'notes' }),
  useRouterState: (o?: { select?: (s: { location: { pathname: string } }) => unknown }) =>
    (o?.select ? o.select({ location: { pathname: '/v2/w/ws1/plugins/notes' } }) : '/v2/w/ws1/plugins/notes'),
}));
vi.mock('../api/context', () => ({
  useWorkspace: () => ({
    ws: 'ws1', connection: { state: 'connected' },
    stream: { onEvent: (fn: EventHandler) => { state.eventHandler = fn; return () => { state.eventHandler = null; }; } },
  }),
}));
vi.mock('../api/hooks', () => ({
  useWorkspaceSummary: () => ({ data: { plugins: state.plugins }, isLoading: state.isLoading, isError: false }),
  useWorkspaces: () => ({ data: [{ id: 'ws1', name: 'Acme' }] }),
  useWorkersMany: () => [{ data: [] }],
  useDecisionsMany: () => [{ data: [] }],
  useIncidents: () => ({ data: { items: [] } }),
}));
vi.mock('../api/client', () => ({
  request: (...args: unknown[]) => client.request(...args),
  api: { ws: (...args: unknown[]) => client.wsGet(...args) },
  ApiError: class ApiError extends Error {
    code: string; status: number;
    constructor(status: number, body: { code: string; message: string }) { super(body.message); this.code = body.code; this.status = status; }
  },
}));
vi.mock('../v2/V2Root', () => ({ useV2ThemeState: () => ({ theme: state.theme, setTheme: vi.fn(), toggle: vi.fn() }) }));

const { V2PluginPage } = await import('../v2/PluginPage');

afterEach(() => {
  cleanup();
  state.plugins = [];
  state.isLoading = false;
  state.eventHandler = null;
  state.theme = 'dark';
  client.request.mockReset();
  client.wsGet.mockReset();
});

function loadedPlugin(over: Partial<WorkspacePlugin> = {}): WorkspacePlugin {
  return { id: 'notes', version: '0.1.0', name: null, source: 'workspace', loaded: true, error: null, hasPage: true, ...over };
}

describe('V2PluginPage', () => {
  it('shows a not-found state when the workspace does not load this plugin', () => {
    state.plugins = [];
    render(<V2PluginPage />);
    expect(screen.getByText(/does not load a plugin with a page/)).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('renders the opaque-origin sandboxed iframe for a loaded plugin with a page', () => {
    client.wsGet.mockResolvedValue('.v2-card {}');
    state.plugins = [loadedPlugin()];
    render(<V2PluginPage />);
    const frame = document.querySelector('iframe');
    expect(frame).toBeTruthy();
    expect(frame?.getAttribute('src')).toBe('/api/w/ws1/plugins/notes/page');
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts allow-forms');
    expect(frame?.getAttribute('sandbox')).not.toContain('allow-same-origin');
  });

  it('uses the plugin\'s declared name as the title, falling back to its id', () => {
    client.wsGet.mockResolvedValue('');
    state.plugins = [loadedPlugin({ name: 'Services' })];
    render(<V2PluginPage />);
    expect(screen.getByText('Services')).toBeInTheDocument();

    cleanup();
    state.plugins = [loadedPlugin({ name: null })];
    render(<V2PluginPage />);
    expect(screen.getByText('notes')).toBeInTheDocument();
  });

  it('posts stylesheet then theme once the iframe is available, and theme again (with no repeated stylesheet) on a theme change', async () => {
    client.wsGet.mockResolvedValue('.v2-card { background: red; }');
    state.plugins = [loadedPlugin()];
    const { rerender } = render(<V2PluginPage />);
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    const postSpy = vi.spyOn(frame.contentWindow!, 'postMessage');

    // jsdom never fires a real load for an iframe's `src` (it doesn't fetch it) — the push is
    // keyed on the iframe's own `load` event precisely because a premature push is silently lost
    // (postMessage does not queue for a not-yet-registered listener), so the test fires it too.
    fireEvent.load(frame);
    await vi.waitFor(() => expect(client.wsGet).toHaveBeenCalledWith('ws1', '/plugins/theme.css'));
    await vi.waitFor(() => expect(postSpy).toHaveBeenCalledWith({ type: 'stylesheet', css: '.v2-card { background: red; }' }, '*'));
    expect(postSpy).toHaveBeenCalledWith({ type: 'theme', theme: 'dark' }, '*');

    postSpy.mockClear();
    client.wsGet.mockClear();
    state.theme = 'light';
    rerender(<V2PluginPage />);
    expect(postSpy).toHaveBeenCalledWith({ type: 'theme', theme: 'light' }, '*');
    expect(postSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'stylesheet' }), '*');
    expect(client.wsGet).not.toHaveBeenCalled();
  });

  it('ignores a message whose source is not the hosted iframe', () => {
    client.wsGet.mockResolvedValue('');
    state.plugins = [loadedPlugin()];
    render(<V2PluginPage />);
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'request', id: '1', method: 'GET', path: '/notes' }, source: window }));
    expect(client.request).not.toHaveBeenCalled();
  });

  it('proxies a same-plugin request from the iframe and rejects one that escapes its prefix', async () => {
    client.wsGet.mockResolvedValue('');
    client.request.mockResolvedValueOnce({ notes: [] });
    state.plugins = [loadedPlugin()];
    render(<V2PluginPage />);
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    const postSpy = vi.spyOn(frame.contentWindow!, 'postMessage');

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'request', id: '1', method: 'GET', path: '/notes' }, source: frame.contentWindow! }));
    await vi.waitFor(() => expect(client.request).toHaveBeenCalled());
    expect(client.request).toHaveBeenCalledWith('/api/w/ws1/plugins/notes/notes', { method: 'GET', body: undefined });
    expect(postSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'response', id: '1', ok: true, data: { notes: [] } }), '*');

    postSpy.mockClear();
    client.request.mockClear();
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'request', id: '2', method: 'DELETE', path: '/../../plugin-data/notes' }, source: frame.contentWindow! }));
    expect(client.request).not.toHaveBeenCalled();
    expect(postSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'response', id: '2', ok: false }), '*');
  });

  it('forwards only a subscribed plugin.event naming this plugin', () => {
    client.wsGet.mockResolvedValue('');
    state.plugins = [loadedPlugin()];
    render(<V2PluginPage />);
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    const postSpy = vi.spyOn(frame.contentWindow!, 'postMessage');

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'subscribe', kind: 'note.created' }, source: frame.contentWindow! }));
    expect(state.eventHandler).not.toBeNull();

    state.eventHandler!({ type: 'plugin.event', entityType: 'plugin:other', entityId: 'x', seq: 1, createdAt: '', payload: { pluginId: 'other', kind: 'note.created', payload: {} } } as unknown as WorkspaceEvent);
    expect(postSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'event' }), '*');

    state.eventHandler!({ type: 'plugin.event', entityType: 'plugin:notes', entityId: 'x', seq: 2, createdAt: '', payload: { pluginId: 'notes', kind: 'note.created', payload: { text: 'hi' } } } as unknown as WorkspaceEvent);
    expect(postSpy).toHaveBeenCalledWith({ type: 'event', kind: 'note.created', payload: { text: 'hi' } }, '*');
  });
});
