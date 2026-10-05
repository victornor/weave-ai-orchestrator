import { demoId } from './ids.js';

/**
 * VS-770: what `pnpm demo:screenshots` captures. To add a view, add an entry to `SHOTS`: a name (it
 * becomes the file name), the route, and optionally what to wait for. Nothing else needs touching —
 * the capture script, the route test and the docs all read this list.
 */
export interface ShotSpec {
  /** File name stem: `<name>--<viewport>--<theme>.png`. Unique across the manifest. */
  name: string;
  /** Route, starting at `/`. `{ws}` is the primary workspace's slug. */
  path: string;
  /** CSS selector that must be on the page before the shot. Defaults to the app shell. */
  ready?: string;
  /** Extra settle time in ms, for views that animate or lay themselves out (the knowledge graph). */
  settleMs?: number;
  /** Which viewports to shoot. Default: all. */
  viewports?: ViewportName[];
  /** Capture the whole scrollable page rather than the first screen. */
  fullPage?: boolean;
  /** Fail every request to the live event streams, so the connection banner shows its offline state. */
  blockStreams?: boolean;
  /** Selectors to click, in order, before the shot (open a menu, expand a row). */
  click?: string[];
}

export type ViewportName = 'desktop' | 'phone';
export const VIEWPORTS: Record<ViewportName, { width: number; height: number; deviceScaleFactor: number; isMobile: boolean; hasTouch: boolean }> = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
export const THEMES = ['light', 'dark'] as const;
export type ThemeName = (typeof THEMES)[number];

/** The workspace the shots are taken in. */
export const PRIMARY_WORKSPACE = 'lumen';

const worker = (n: number): string => demoId(`agent:worker:${n}`);
const run = (key: string): string => demoId(`run:${key}`);

export const SHOTS: ShotSpec[] = [
  { name: 'chat', path: '/w/{ws}/chat', settleMs: 800 },
  { name: 'needs', path: '/w/{ws}/needs' },
  { name: 'work-board', path: '/w/{ws}/work', settleMs: 2500 },
  { name: 'roles', path: '/w/{ws}/roles' },
  { name: 'project-storefront', path: '/w/{ws}/p/storefront' },
  { name: 'project-ledger', path: '/w/{ws}/p/ledger' },
  { name: 'project-pocket', path: '/w/{ws}/p/pocket' },
  { name: 'roadmap', path: '/w/{ws}/p/storefront/roadmap', click: ['text=Checkout rework', 'text=Growth experiments'] },
  { name: 'ticket-merge-review', path: '/w/{ws}/tickets/LUM-3' },
  { name: 'ticket-plan-approval', path: '/w/{ws}/tickets/LUM-4' },
  { name: 'ticket-in-progress', path: '/w/{ws}/tickets/LUM-5' },
  { name: 'ticket-scout', path: '/w/{ws}/tickets/LUM-6' },
  { name: 'ticket-action-approval', path: '/w/{ws}/tickets/LUM-9' },
  { name: 'ticket-merging', path: '/w/{ws}/tickets/LUM-10' },
  { name: 'ticket-blocked', path: '/w/{ws}/tickets/LUM-12' },
  { name: 'ticket-done', path: '/w/{ws}/tickets/LUM-1' },
  { name: 'ticket-report', path: '/w/{ws}/tickets/LUM-13' },
  { name: 'worker-running', path: `/w/{ws}/workers/${worker(11)}`, settleMs: 1200 },
  { name: 'worker-error', path: `/w/{ws}/workers/${worker(20)}` },
  { name: 'knowledge', path: '/w/{ws}/knowledge' },
  { name: 'knowledge-graph', path: '/w/{ws}/knowledge/graph', settleMs: 3500 },
  { name: 'knowledge-explorer', path: '/w/{ws}/knowledge/explorer' },
  { name: 'knowledge-specs', path: '/w/{ws}/knowledge/specs' },
  { name: 'changelog', path: '/w/{ws}/changelog' },
  { name: 'usage', path: '/w/{ws}/usage', settleMs: 800 },
  { name: 'runs', path: '/runs' },
  { name: 'run-transcript', path: `/runs/${run('w1:a')}` },
  { name: 'run-live', path: `/runs/${run('w11:live')}`, settleMs: 1500 },
  { name: 'live', path: '/live', settleMs: 1500 },
  { name: 'incidents', path: '/incidents' },
  { name: 'scheduled', path: '/scheduled' },
  { name: 'map', path: '/map', settleMs: 2500, click: ['[aria-label="Zoom out"]', '[aria-label="Zoom out"]'] },
  { name: 'settings', path: '/settings' },
  { name: 'chats', path: '/chats' },
  { name: 'second-workspace', path: '/w/fernwood/work' },
  { name: 'connection-offline', path: '/w/{ws}/work', blockStreams: true, settleMs: 1500 },
];
