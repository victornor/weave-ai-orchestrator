/**
 * The V2 destination registry — one description of every place V2 can go, from which the expanded
 * rail, the collapsed rail, the phone tab bar and the More list are all derived. Paths are relative
 * to `/v2` and carry `$ws` where the destination is workspace-scoped.
 *
 * This module is pure so the rail, the highlighting rule and the scope rule can be tested without a
 * router or a browser.
 */
import type { CSSProperties } from 'react';

export type V2GlyphName =
  | 'needs'
  | 'live'
  | 'incidents'
  | 'map'
  | 'runs'
  | 'scheduled'
  | 'settings'
  | 'chats'
  | 'chat'
  | 'work'
  | 'roles'
  | 'knowledge'
  | 'plugin';

export interface V2Dest {
  key: string;
  label: string;
  glyph: V2GlyphName;
  scopeKind: 'everywhere' | 'workspace';
  /** Relative to `/v2`; `$ws` where workspace-scoped. */
  path: string;
  /** Which one-source count the row carries, if any. */
  count?: 'needs' | 'live' | 'incidents';
  /** A kept-V1 screen the desktop rail also carries; the rest stay in More only (VS-384). */
  rail?: boolean;
}

/** Everywhere: the daemon-wide destinations, above the workspace groups (HANDOFF §4). */
export const V2_EVERYWHERE: V2Dest[] = [
  { key: 'global-needs', label: 'Needs you', glyph: 'needs', scopeKind: 'everywhere', path: '/needs', count: 'needs' },
  { key: 'global-live', label: 'Live', glyph: 'live', scopeKind: 'everywhere', path: '/live', count: 'live' },
  { key: 'global-incidents', label: 'Incidents', glyph: 'incidents', scopeKind: 'everywhere', path: '/incidents', count: 'incidents' },
  { key: 'global-map', label: 'Map', glyph: 'map', scopeKind: 'everywhere', path: '/map' },
  { key: 'global-runs', label: 'Runs', glyph: 'runs', scopeKind: 'everywhere', path: '/runs' },
  { key: 'global-scheduled', label: 'Scheduled', glyph: 'scheduled', scopeKind: 'everywhere', path: '/scheduled' },
  { key: 'global-settings', label: 'Settings', glyph: 'settings', scopeKind: 'everywhere', path: '/settings' },
];

/** A workspace's own sections (HANDOFF §4). Work replaces the old Board. */
export const V2_WORKSPACE: V2Dest[] = [
  { key: 'ws-chat', label: 'Chat', glyph: 'chat', scopeKind: 'workspace', path: '/w/$ws/chat' },
  { key: 'ws-needs', label: 'Needs you', glyph: 'needs', scopeKind: 'workspace', path: '/w/$ws/needs', count: 'needs' },
  { key: 'ws-work', label: 'Work', glyph: 'work', scopeKind: 'workspace', path: '/w/$ws/work' },
  { key: 'ws-roles', label: 'Roles', glyph: 'roles', scopeKind: 'workspace', path: '/w/$ws/roles' },
  { key: 'ws-knowledge', label: 'Knowledge', glyph: 'knowledge', scopeKind: 'workspace', path: '/w/$ws/knowledge' },
];

/**
 * The V1 screens captain kept that the design's rail leaves out. They are not rail rows by default;
 * the More list (desktop and phone) and their owning screens reach them, and each keeps its own
 * route. The knowledge graph and explorer are *not* here: they are reachable only as the Knowledge
 * screen's Graph and Explorer tabs (VS-371), with the rail's Knowledge row highlighted. The ones
 * marked `rail` are carried by the desktop rail too (VS-384).
 */
export const V2_KEPT: V2Dest[] = [
  { key: 'global-chats', label: 'Chats', glyph: 'chats', scopeKind: 'everywhere', path: '/chats', rail: true },
  { key: 'ws-usage', label: 'Usage', glyph: 'runs', scopeKind: 'workspace', path: '/w/$ws/usage', rail: true },
  { key: 'ws-changelog', label: 'Changelog', glyph: 'scheduled', scopeKind: 'workspace', path: '/w/$ws/changelog', rail: true },
];

/**
 * The desktop rail's Everywhere group: the design's global rows plus the kept Chats entry, placed
 * after Live as in V1 (VS-384). The phone tab bar and More list read `V2_EVERYWHERE`/`V2_KEPT`.
 */
export const V2_RAIL_EVERYWHERE: V2Dest[] = [
  ...V2_EVERYWHERE.slice(0, 2),
  ...V2_KEPT.filter((d) => d.rail && d.scopeKind === 'everywhere'),
  ...V2_EVERYWHERE.slice(2),
];

/** A workspace group in the desktop rail: its own sections plus the kept Usage and Changelog. */
export const V2_RAIL_WORKSPACE: V2Dest[] = [
  ...V2_WORKSPACE,
  ...V2_KEPT.filter((d) => d.rail && d.scopeKind === 'workspace'),
];

export type V2Scope = { kind: 'everywhere' } | { kind: 'workspace'; ws: string };

/** The workspace named in a `/v2/w/<ws>…` path, or `null` for an Everywhere path. */
export function workspaceFromV2Path(pathname: string): string | null {
  const m = /^\/v2\/w\/([^/]+)(?:\/|$)/.exec(pathname);
  return m ? decodeURIComponent(m[1] ?? '') : null;
}

/** The single highlighted row for a V2 path. Drill-downs map to the destination that owns them. */
export function activeNavKey(pathname: string): string | null {
  const m = /^\/v2\/w\/([^/]+)\/?(.*)$/.exec(pathname);
  if (m) {
    const rest = m[2] ?? '';
    const [section = '', second = ''] = rest.split('/');
    switch (section) {
      case '':
      case 'needs':
        return 'ws-needs';
      case 'chat':
        return 'ws-chat';
      case 'work':
      case 'board':
      case 'tickets':
        return 'ws-work';
      case 'roles':
      case 'workers':
        return 'ws-roles';
      case 'knowledge':
      case 'artifacts':
        return 'ws-knowledge';
      case 'usage':
        return 'ws-usage';
      case 'changelog':
        return 'ws-changelog';
      case 'p':
        return `project:${second}`;
      case 'plugins':
        return `plugin:${second}`;
      default:
        return 'ws-work';
    }
  }
  if (/^\/v2\/runs\/[^/]+$/.test(pathname)) return 'global-runs';
  switch (pathname) {
    case '/v2/needs':
      return 'global-needs';
    case '/v2/live':
      return 'global-live';
    case '/v2/incidents':
      return 'global-incidents';
    case '/v2/map':
      return 'global-map';
    case '/v2/runs':
      return 'global-runs';
    case '/v2/scheduled':
      return 'global-scheduled';
    case '/v2/settings':
      return 'global-settings';
    case '/v2/chats':
      return 'global-chats';
    default:
      return null;
  }
}

/** A destination's address, filling `$ws` from the current scope. */
export function v2Href(dest: V2Dest, scope: V2Scope, fallbackWs = ''): string {
  const ws = scope.kind === 'workspace' ? scope.ws : fallbackWs;
  // With no workspace to name, a workspace-scoped destination cannot build `/v2/w//…`; onboarding is
  // where a workspace is created, so that is where it points (VS-353).
  if (!ws && dest.scopeKind === 'workspace') return '/v2/onboarding';
  return `/v2${dest.path.replace('$ws', encodeURIComponent(ws))}`;
}

export const V2_WORK_PATH = '/w/$ws/work';
export const V2_PROJECT_PATH = '/w/$ws/p/$project';

/** The project row key, so a project page highlights that project's own rail row. */
export function projectRowKey(slug: string): string {
  return `project:${slug}`;
}

export const V2_GLYPH_STYLE: Record<V2GlyphName, CSSProperties> = {
  needs: { width: 13, height: 13, borderRadius: 999, border: '1.5px solid currentColor' },
  live: {
    width: 13,
    height: 13,
    borderRadius: 2,
    border: '1.5px solid currentColor',
    background: 'radial-gradient(circle at 50% 50%, currentColor 0 2px, transparent 2.5px)',
  },
  incidents: { width: 13, height: 12, background: 'currentColor', clipPath: 'polygon(50% 0,100% 100%,0 100%)' },
  map: {
    width: 13,
    height: 13,
    borderRadius: 2,
    border: '1.5px solid currentColor',
    background: 'linear-gradient(to right, transparent 45%, currentColor 45%, currentColor 55%, transparent 55%)',
  },
  scheduled: { width: 13, height: 13, borderRadius: 999, border: '1.5px solid currentColor', borderTopColor: 'transparent' },
  runs: {
    width: 13,
    height: 11,
    borderRadius: 2,
    border: '1.5px solid currentColor',
    background:
      'linear-gradient(to bottom, transparent 3px, currentColor 3px, currentColor 4.5px, transparent 4.5px, transparent 7px, currentColor 7px, currentColor 8.5px, transparent 8.5px)',
  },
  chats: { width: 13, height: 11, borderRadius: '3px 3px 3px 1px', border: '1.5px solid currentColor' },
  chat: { width: 13, height: 11, borderRadius: '2px 2px 2px 1px', border: '1.5px solid currentColor' },
  work: {
    width: 13,
    height: 11,
    borderLeft: '2.5px solid currentColor',
    borderRight: '2.5px solid currentColor',
    borderTop: '1.5px solid currentColor',
    borderBottom: '1.5px solid currentColor',
    borderRadius: 2,
  },
  roles: {
    width: 13,
    height: 11,
    borderRadius: 2,
    border: '1.5px solid currentColor',
    background:
      'linear-gradient(to bottom, transparent 3.5px, currentColor 3.5px 5px, transparent 5px 7.5px, currentColor 7.5px 9px, transparent 9px)',
  },
  knowledge: { width: 11, height: 13, border: '1.5px solid currentColor', borderRadius: 2, borderLeftWidth: 3 },
  settings: {
    width: 13,
    height: 13,
    borderRadius: 999,
    border: '1.5px solid currentColor',
    background: 'radial-gradient(circle at 50% 50%, currentColor 0 1.5px, transparent 2px)',
  },
  plugin: {
    width: 13,
    height: 13,
    border: '1.5px solid currentColor',
    borderRadius: 2,
    clipPath: 'polygon(0 0, 65% 0, 100% 35%, 100% 100%, 0 100%)',
  },
};
