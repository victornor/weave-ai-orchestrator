import type { UiStatus } from '@agent-conductor/shared';

export interface NavItem {
  key: string;
  label: string;
  to: string;
  /** desktop rail keyboard number; `,` for Settings. Absent where the destination is not on the rail. */
  kbd?: string;
  glyph: UiStatus | 'chat' | 'board' | 'more' | 'queue';
  /** one line under the label, where the surface has room for it — the phone's More menu. */
  hint?: string;
}

/** Desktop rail: Chat 1 · Needs you 2 · Board 3 · Team 4 · Runs 5 · Usage 6 · Knowledge 7 · Settings , */
export const RAIL: NavItem[] = [
  { key: 'chat', label: 'Chat', to: '/w/$ws/chat', kbd: '1', glyph: 'chat' },
  { key: 'needs', label: 'Needs you', to: '/w/$ws/needs', kbd: '2', glyph: 'needs-you' },
  { key: 'board', label: 'Board', to: '/w/$ws/board', kbd: '3', glyph: 'board' },
  { key: 'team', label: 'Team', to: '/w/$ws/team', kbd: '4', glyph: 'blocked' },
  { key: 'runs', label: 'Runs', to: '/w/$ws/runs', kbd: '5', glyph: 'working' },
  { key: 'usage', label: 'Usage', to: '/w/$ws/usage', kbd: '6', glyph: 'merging' },
  { key: 'kb', label: 'Knowledge', to: '/w/$ws/knowledge', kbd: '7', glyph: 'done' },
  { key: 'settings', label: 'Settings', to: '/w/$ws/settings', kbd: ',', glyph: 'more' },
];

/** Phone: five tabs. Six targets do not fit at 390px, so Start Work floats. */
export const TABS: NavItem[] = [
  { key: 'chat', label: 'Chat', to: '/w/$ws/chat', kbd: '1', glyph: 'chat' },
  { key: 'board', label: 'Board', to: '/w/$ws/board', kbd: '3', glyph: 'board' },
  { key: 'team', label: 'Team', to: '/w/$ws/team', kbd: '4', glyph: 'blocked' },
  { key: 'needs', label: 'Needs you', to: '/w/$ws/needs', kbd: '2', glyph: 'needs-you' },
  { key: 'more', label: 'More', to: '/w/$ws/settings', kbd: ',', glyph: 'more' },
];

/** The tab that opens the More menu rather than navigating. */
export const MORE_TAB_KEY = 'more';

/**
 * What the More tab opens: every destination the five tabs leave out. The rail's leftovers in the
 * rail's own order — Runs, Usage, Knowledge, Settings — plus the merge queue, which is not a rail
 * destination either (VS-58 put it behind the board's filter bar) and so has nowhere else to be
 * reached from on a phone. A test pins this list against `RAIL` and `TABS`, so a rail destination
 * added later cannot quietly go missing here.
 */
export const MORE_ITEMS: NavItem[] = [
  { key: 'runs', label: 'Runs', to: '/w/$ws/runs', kbd: '5', glyph: 'working', hint: 'Every turn the agents took' },
  { key: 'usage', label: 'Usage', to: '/w/$ws/usage', kbd: '6', glyph: 'merging', hint: 'Tokens, cost and plan limits' },
  { key: 'kb', label: 'Knowledge', to: '/w/$ws/knowledge', kbd: '7', glyph: 'done', hint: 'Knowledge files, documents, changelog, graph and specs' },
  { key: 'merge-queue', label: 'Merge queue', to: '/w/$ws/merge-queue', glyph: 'queue', hint: 'What is landing, and what waits behind it' },
  { key: 'settings', label: 'Settings', to: '/w/$ws/settings', kbd: ',', glyph: 'more', hint: 'This workspace, this daemon and this device' },
];

export function href(item: NavItem, ws: string): string {
  return item.to.replace('$ws', encodeURIComponent(ws));
}
