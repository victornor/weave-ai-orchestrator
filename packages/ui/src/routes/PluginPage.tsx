/**
 * `/w/:ws/plugins/:pluginId` (VS-334): one static route, a dynamic `$pluginId` segment — not a route
 * added per plugin. Iframes the plugin's own page in an opaque-origin sandbox and runs the host-side
 * half of the postMessage bridge (design.md Decision 5): the page can reach the daemon only through
 * it, scoped to that plugin's own route prefix by `resolveBridgePath`.
 */
import { useEffect, useRef, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { Page, PageBody, PageHeader } from '../components/Page';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState } from '../components/States';
import { useWorkspace } from '../api/context';
import { useWorkspaceSummary } from '../api/hooks';
import { request, ApiError } from '../api/client';
import { isPluginBridgeMessage, resolveBridgePath } from '../lib/pluginBridge';

export function PluginPageRoute(): React.ReactElement {
  const { ws, stream } = useWorkspace();
  const { pluginId } = useParams({ strict: false }) as { pluginId: string };
  const summary = useWorkspaceSummary();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [subscribed] = useState(() => new Set<string>());

  const plugin = (summary.data?.plugins ?? []).find((p) => p.id === pluginId);
  const available = Boolean(plugin?.loaded && plugin.hasPage);

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

  return (
    <Page>
      <PageHeader title={plugin?.id ?? pluginId} meta="plugin" />
      <PageBody className="p-0">
        {summary.isLoading ? (
          <div className="p-4"><SkeletonRows rows={3} /></div>
        ) : !available ? (
          <div className="p-4">
            <EmptyState
              title="Plugin page not found."
              detail={`This workspace does not load a plugin with a page at "${pluginId}".`}
            />
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            key={pluginId}
            src={`/api/w/${encodeURIComponent(ws)}/plugins/${encodeURIComponent(pluginId)}/page`}
            sandbox="allow-scripts allow-forms"
            title={plugin?.id ?? pluginId}
            className="h-[85vh] w-full border-0 bg-bg-0"
          />
        )}
      </PageBody>
    </Page>
  );
}
