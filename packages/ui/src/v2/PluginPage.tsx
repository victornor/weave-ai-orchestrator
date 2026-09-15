/**
 * `/w/:ws/plugins/:pluginId` (VS-385): the V2 home for a plugin's page, mirroring V1's
 * `routes/PluginPage.tsx` — one static route, a dynamic `$pluginId` segment, the same
 * `resolveBridgePath`-scoped postMessage bridge (design.md Decision 1: the security boundary does
 * not change between V1 and V2, so it is reused verbatim rather than forked).
 *
 * Beyond V1: fetches the generated plugin stylesheet once (`GET /api/w/:ws/plugins/theme.css`) and
 * pushes it, together with the app's current V2 theme, into the iframe as soon as it is available
 * — `stylesheet` once, `theme` again on every later change (design.md Decisions 3(d) and 6). The
 * page's title and rail label use the plugin's own declared name where present, falling back to
 * its id (design.md Decisions 1-2).
 */
import { useEffect, useRef, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useWorkspace } from '../api/context';
import { useWorkspaceSummary } from '../api/hooks';
import { api, request, ApiError } from '../api/client';
import { isPluginBridgeMessage, resolveBridgePath } from '../lib/pluginBridge';
import { V2Page } from './V2Page';
import { useV2ThemeState } from './V2Root';

export function V2PluginPage(): React.ReactElement {
  const { ws, stream } = useWorkspace();
  const { pluginId } = useParams({ strict: false }) as { pluginId: string };
  const { theme } = useV2ThemeState();
  const summary = useWorkspaceSummary();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [subscribed] = useState(() => new Set<string>());

  const plugin = (summary.data?.plugins ?? []).find((p) => p.id === pluginId);
  const available = Boolean(plugin?.loaded && plugin.hasPage);
  const title = plugin?.name ?? plugin?.id ?? pluginId;

  useEffect(() => {
    if (!available) return;
    const onMessage = (event: MessageEvent): void => {
      const iframe = iframeRef.current;
      if (!iframe || event.source !== iframe.contentWindow) return;
      const msg: unknown = event.data;
      if (!isPluginBridgeMessage(msg)) return;

      if (msg.type === 'subscribe') {
        subscribed.add(msg.kind);
        return;
      }

      const path = resolveBridgePath(ws, pluginId, msg.path);
      const post = (payload: Record<string, unknown>): void => {
        iframe.contentWindow?.postMessage({ type: 'response', id: msg.id, ...payload }, '*');
      };
      if (!path) {
        post({ ok: false, error: { code: 'forbidden', message: 'path escapes this plugin\'s own route prefix' } });
        return;
      }
      request(path, { method: msg.method, body: msg.body })
        .then((data) => post({ ok: true, status: 200, data }))
        .catch((e: unknown) => {
          const err = e instanceof ApiError ? { code: e.code, message: e.message } : { code: 'internal', message: 'request failed' };
          post({ ok: false, status: e instanceof ApiError ? e.status : 500, error: err });
        });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [available, ws, pluginId, subscribed]);

  useEffect(() => {
    if (!available || !stream) return;
    return stream.onEvent((ev) => {
      if (ev.type !== 'plugin.event') return;
      const payload = ev.payload as { pluginId?: string; kind?: string; payload?: unknown } | null;
      if (!payload || payload.pluginId !== pluginId || !payload.kind || !subscribed.has(payload.kind)) return;
      iframeRef.current?.contentWindow?.postMessage({ type: 'event', kind: payload.kind, payload: payload.payload }, '*');
    });
  }, [available, stream, pluginId, subscribed]);

  // The generated stylesheet is fetched once per plugin (it changes only across a daemon restart
  // on a new release, never mid-session) and pushed alongside the theme once the iframe's own
  // document has actually loaded — the theme alone repeats on every later change. The iframe's own
  // CSP (`connect-src 'none'`) means it cannot fetch this itself, so the host page always does it
  // on its behalf.
  //
  // Pushing on `iframe.onLoad`, not merely once `available` flips true, matters: `postMessage` does
  // not queue for a listener that has not registered yet, and `available` can turn true (from the
  // workspace summary query) well before the iframe's own document has parsed far enough to have
  // called `weavePluginClient()` and attached its own `message` listener. Pushing early is not an
  // error — it just silently never arrives, which a scratch-daemon rendered check catches and a
  // synthetic/mocked test does not, since a test's fake iframe has no real load timeline to race
  // against.
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const loadedForRef = useRef<string | null>(null);

  const onIframeLoad = (): void => {
    setIframeLoaded(true);
    if (loadedForRef.current === pluginId) return;
    loadedForRef.current = pluginId;
    api.ws<string>(ws, '/plugins/theme.css').then((css) => {
      iframeRef.current?.contentWindow?.postMessage({ type: 'stylesheet', css }, '*');
      iframeRef.current?.contentWindow?.postMessage({ type: 'theme', theme }, '*');
    }).catch(() => { /* the page falls back to host.themeCss()'s optional first-paint inline, if the plugin used it */ });
  };

  useEffect(() => {
    setIframeLoaded(false);
    loadedForRef.current = null;
  }, [pluginId]);

  useEffect(() => {
    if (!iframeLoaded || loadedForRef.current !== pluginId) return;
    iframeRef.current?.contentWindow?.postMessage({ type: 'theme', theme }, '*');
  }, [iframeLoaded, pluginId, theme]);

  return (
    <V2Page title={title} scroll={false}>
      {available ? (
        <iframe
          ref={iframeRef}
          key={pluginId}
          src={`/api/w/${encodeURIComponent(ws)}/plugins/${encodeURIComponent(pluginId)}/page`}
          sandbox="allow-scripts allow-forms"
          title={title}
          className="h-full w-full flex-1 border-0 bg-bg-0"
          onLoad={onIframeLoad}
        />
      ) : (
        <div className="flex h-full items-center justify-center p-8">
          <p className="max-w-md text-center text-ui text-text-3">
            {summary.isLoading
              ? 'Loading…'
              : `This workspace does not load a plugin with a page at "${pluginId}".`}
          </p>
        </div>
      )}
    </V2Page>
  );
}
