/**
 * `WEAVE_PLUGIN_CLIENT_JS` (VS-334) is plain JS meant to be inlined into a plugin's page with a
 * `<script>` tag — no bundler, no import. Evaluated here against a fake `window` (this package's
 * tests run under Node, not jsdom) to prove the page-side half of the postMessage bridge actually
 * does what design.md Decision 5 describes, without needing a real browser.
 */
import { describe, expect, it, vi } from 'vitest';
import { WEAVE_PLUGIN_CLIENT_JS } from './index.js';

interface FakeStyleElement { id: string; textContent: string }
interface FakeDocument {
  elements: Record<string, FakeStyleElement>;
  documentElement: { dataset: Record<string, string> };
  head: { appendChild: (el: FakeStyleElement) => void };
  getElementById(id: string): FakeStyleElement | null;
  createElement(tag: string): FakeStyleElement;
}
interface FakeWindow {
  listeners: Array<(e: { data: unknown }) => void>;
  addEventListener(type: string, fn: (e: { data: unknown }) => void): void;
  parent: { postMessage: ReturnType<typeof vi.fn> };
  document: FakeDocument;
  weavePluginClient?: () => {
    request: (m: string, p: string, b?: unknown) => Promise<unknown>;
    onEvent: (k: string, h: (p: unknown) => void) => void;
    onTheme: (h: (t: string) => void) => void;
  };
}

function makeDocument(): FakeDocument {
  const elements: Record<string, FakeStyleElement> = {};
  return {
    elements,
    documentElement: { dataset: {} },
    head: { appendChild: (el) => { elements[el.id] = el; } },
    getElementById: (id) => elements[id] ?? null,
    createElement: () => ({ id: '', textContent: '' }),
  };
}

function makeWindow(): FakeWindow {
  const w: FakeWindow = {
    listeners: [],
    addEventListener(type, fn) { if (type === 'message') this.listeners.push(fn); },
    parent: { postMessage: vi.fn() },
    document: makeDocument(),
  };
  return w;
}

function evalClient(w: FakeWindow): void {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('window', WEAVE_PLUGIN_CLIENT_JS)(w);
}

describe('WEAVE_PLUGIN_CLIENT_JS (VS-334)', () => {
  it('request() posts a request message to window.parent and resolves on the matching response', async () => {
    const w = makeWindow();
    evalClient(w);
    const client = w.weavePluginClient!();

    const pending = client.request('GET', '/notes');
    expect(w.parent.postMessage).toHaveBeenCalledTimes(1);
    const sent = w.parent.postMessage.mock.calls[0]![0] as { type: string; id: string; method: string; path: string };
    expect(sent).toMatchObject({ type: 'request', method: 'GET', path: '/notes' });

    for (const l of w.listeners) l({ data: { type: 'response', id: sent.id, ok: true, status: 200, data: { notes: [] } } });
    await expect(pending).resolves.toEqual({ status: 200, data: { notes: [] } });
  });

  it('request() rejects with the error payload on a failure response', async () => {
    const w = makeWindow();
    evalClient(w);
    const client = w.weavePluginClient!();

    const pending = client.request('POST', '/notes', { text: '' });
    const sent = w.parent.postMessage.mock.calls[0]![0] as { id: string };
    for (const l of w.listeners) l({ data: { type: 'response', id: sent.id, ok: false, error: { code: 'validation', message: 'text is required' } } });
    await expect(pending).rejects.toEqual({ code: 'validation', message: 'text is required' });
  });

  it('onEvent() posts a subscribe message and invokes the handler only for its own kind', () => {
    const w = makeWindow();
    evalClient(w);
    const client = w.weavePluginClient!();

    const handler = vi.fn();
    client.onEvent('note.created', handler);
    expect(w.parent.postMessage).toHaveBeenCalledWith({ type: 'subscribe', kind: 'note.created' }, '*');

    for (const l of w.listeners) l({ data: { type: 'event', kind: 'note.created', payload: { text: 'hi' } } });
    expect(handler).toHaveBeenCalledWith({ text: 'hi' });

    handler.mockClear();
    for (const l of w.listeners) l({ data: { type: 'event', kind: 'other.kind', payload: {} } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores a message with no recognizable shape', () => {
    const w = makeWindow();
    evalClient(w);
    w.weavePluginClient!();
    expect(() => { for (const l of w.listeners) l({ data: 'garbage' }); }).not.toThrow();
    expect(() => { for (const l of w.listeners) l({ data: null }); }).not.toThrow();
  });

  it('a stylesheet message sets the injected <style> element\'s content, with no plugin callback', () => {
    const w = makeWindow();
    evalClient(w);
    w.weavePluginClient!();

    for (const l of w.listeners) l({ data: { type: 'stylesheet', css: '.v2-card { background: red; }' } });
    expect(w.document.elements['weave-plugin-styles']?.textContent).toBe('.v2-card { background: red; }');
  });

  it('a theme message sets documentElement.dataset.theme automatically, with no onTheme registered', () => {
    const w = makeWindow();
    evalClient(w);
    w.weavePluginClient!();

    for (const l of w.listeners) l({ data: { type: 'theme', theme: 'light' } });
    expect(w.document.documentElement.dataset.theme).toBe('light');
  });

  it('onTheme is an additional subscription, invoked alongside the automatic application', () => {
    const w = makeWindow();
    evalClient(w);
    const client = w.weavePluginClient!();
    const handler = vi.fn();
    client.onTheme(handler);

    for (const l of w.listeners) l({ data: { type: 'theme', theme: 'dark' } });
    expect(w.document.documentElement.dataset.theme).toBe('dark');
    expect(handler).toHaveBeenCalledWith('dark');
  });
});
