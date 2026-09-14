/**
 * The host-side half of the postMessage bridge (VS-334, design.md Decision 5): a plugin's page runs
 * in an opaque-origin sandboxed iframe with `connect-src 'none'`, so it can reach the daemon only
 * through this bridge, scoped to that one plugin's own route prefix. `resolveBridgePath` is the
 * whole security boundary — pure and unit-tested on its own, since a bug here is the highest-value
 * place for one.
 */

export interface PluginBridgeRequestMessage { type: 'request'; id: string; method: string; path: string; body?: unknown }
export interface PluginBridgeSubscribeMessage { type: 'subscribe'; kind: string }
export type PluginBridgeMessage = PluginBridgeRequestMessage | PluginBridgeSubscribeMessage;

/** Host→page only (VS-385): the generated plugin stylesheet, pushed once when the page becomes available. Never validated by `isPluginBridgeMessage`, which guards page→host traffic only. */
export interface PluginBridgeStylesheetMessage { type: 'stylesheet'; css: string }
/** Host→page only (VS-385): the app's current theme, pushed on load and on every later change. */
export interface PluginBridgeThemeMessage { type: 'theme'; theme: 'dark' | 'light' }

export function isPluginBridgeMessage(v: unknown): v is PluginBridgeMessage {
  if (!v || typeof v !== 'object') return false;
  const t = (v as { type?: unknown }).type;
  if (t === 'subscribe') return typeof (v as { kind?: unknown }).kind === 'string';
  if (t === 'request') {
    const m = v as { id?: unknown; method?: unknown; path?: unknown };
    return typeof m.id === 'string' && typeof m.method === 'string' && typeof m.path === 'string';
  }
  return false;
}

/**
 * Resolves a plugin page's requested `path` (bare, e.g. `/notes`) against its own route prefix
 * `/api/w/:ws/plugins/:pluginId/`, rejecting anything that would resolve outside it: a `..` escape,
 * an absolute URL (a different origin entirely), or a path naming a different plugin's prefix.
 * Returns the full request path (`/api/w/:ws/plugins/:pluginId/...`) or `null` when rejected.
 */
export function resolveBridgePath(ws: string, pluginId: string, rawPath: string): string | null {
  if (typeof rawPath !== 'string' || rawPath.length === 0) return null;
  // A scheme (`http:`, `javascript:`, …) or protocol-relative `//host/...` names another origin outright.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawPath) || rawPath.startsWith('//')) return null;
  const prefix = `/api/w/${encodeURIComponent(ws)}/plugins/${encodeURIComponent(pluginId)}`;
  // Concatenated *before* parsing, so the URL parser's own dot-segment normalisation (RFC 3986 §5.2.4)
  // resolves a `..` against the full path, including the prefix — the only way a leading `/notes`
  // (the calling convention every plugin uses) still lands inside the plugin's own prefix, while a
  // `..` that climbs out of it is caught by the prefix check below rather than silently accepted.
  const normalized = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  let resolved: URL;
  try {
    resolved = new URL(`http://plugin-bridge.internal${prefix}${normalized}`);
  } catch {
    return null;
  }
  if (resolved.pathname !== prefix && !resolved.pathname.startsWith(`${prefix}/`)) return null;
  return resolved.pathname + resolved.search;
}
