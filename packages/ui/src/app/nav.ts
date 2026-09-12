import type { UiStatus } from '@weave-ai/shared';

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

/** Desktop rail: Chat 1 · Needs you 2 · Board 3 · Live 4 · Team 5 · Runs 6 · Usage 7 · Knowledge 8 · Settings , */
export const RAIL: NavItem[] = [
  { key: 'chat', label: 'Chat', to: '/w/$ws/chat', kbd: '1', glyph: 'chat' },
  { key: 'needs', label: 'Needs you', to: '/w/$ws/needs', kbd: '2', glyph: 'needs-you' },
  { key: 'board', label: 'Board', to: '/w/$ws/board', kbd: '3', glyph: 'board' },
  { key: 'live', label: 'Live', to: '/w/$ws/live', kbd: '4', glyph: 'working' },
  { key: 'team', label: 'Team', to: '/w/$ws/team', kbd: '5', glyph: 'blocked' },
  { key: 'runs', label: 'Runs', to: '/w/$ws/runs', kbd: '6', glyph: 'working' },
  { key: 'usage', label: 'Usage', to: '/w/$ws/usage', kbd: '7', glyph: 'merging' },
  { key: 'kb', label: 'Knowledge', to: '/w/$ws/knowledge', kbd: '8', glyph: 'done' },
  { key: 'settings', label: 'Settings', to: '/w/$ws/settings', kbd: ',', glyph: 'more' },
];

/** Phone: five tabs. Six targets do not fit at 390px, and Chat is where work is asked for. */
export const TABS: NavItem[] = [
  { key: 'chat', label: 'Chat', to: '/w/$ws/chat', kbd: '1', glyph: 'chat' },
  { key: 'board', label: 'Board', to: '/w/$ws/board', kbd: '3', glyph: 'board' },
  { key: 'team', label: 'Team', to: '/w/$ws/team', kbd: '5', glyph: 'blocked' },
  { key: 'needs', label: 'Needs you', to: '/w/$ws/needs', kbd: '2', glyph: 'needs-you' },
  { key: 'more', label: 'More', to: '/w/$ws/settings', kbd: ',', glyph: 'more' },
];

/** The tab that opens the More menu rather than navigating. */
export const MORE_TAB_KEY = 'more';

/**
 * What the More tab opens: every destination the five tabs leave out. The rail's leftovers in the
 * rail's own order — Live, Runs, Usage, Knowledge, Settings — plus the merge queue, which is not a
 * rail destination either (VS-58 put it behind the board's filter bar) and so has nowhere else to be
 * reached from on a phone. A test pins this list against `RAIL` and `TABS`, so a rail destination
 * added later cannot quietly go missing here.
 */
export const MORE_ITEMS: NavItem[] = [
  { key: 'live', label: 'Live', to: '/w/$ws/live', kbd: '4', glyph: 'working', hint: 'Who is working, and what they are producing' },
  { key: 'runs', label: 'Runs', to: '/w/$ws/runs', kbd: '6', glyph: 'working', hint: 'Every turn the agents took' },
  { key: 'usage', label: 'Usage', to: '/w/$ws/usage', kbd: '7', glyph: 'merging', hint: 'Tokens, cost and plan limits' },
  { key: 'kb', label: 'Knowledge', to: '/w/$ws/knowledge', kbd: '8', glyph: 'done', hint: 'Knowledge files, documents, changelog, graph and specs' },
  { key: 'merge-queue', label: 'Merge queue', to: '/w/$ws/merge-queue', glyph: 'queue', hint: 'What is landing, and what waits behind it' },
  { key: 'settings', label: 'Settings', to: '/w/$ws/settings', kbd: ',', glyph: 'more', hint: 'This workspace' },
];

export function href(item: NavItem, ws: string): string {
  return item.to.replace('$ws', encodeURIComponent(ws));
}

/** Daemon-wide pages above the workspace list (VS-168). Paths have no `$ws`. Settings joined them
 * when the daemon's settings got their own address (VS-230): the global block is where they are
 * reached from, without entering a workspace. */
export const GLOBAL_NAV: NavItem[] = [
  { key: 'global-needs', label: 'Needs you', to: '/needs', glyph: 'needs-you', hint: 'Everything waiting across every workspace' },
  { key: 'global-live', label: 'Live', to: '/live', glyph: 'working', hint: 'Who is working, in every workspace' },
  { key: 'global-chats', label: 'Chats', to: '/chats', glyph: 'chat', hint: 'Every workspace\'s weave chat, side by side' },
  { key: 'global-incidents', label: 'Incidents', to: '/incidents', glyph: 'failed', hint: 'System failures agents filed' },
  { key: 'global-map', label: 'Map', to: '/map', glyph: 'board', hint: 'Every workspace, project, role and ticket, as a graph' },
  { key: 'global-scheduled', label: 'Scheduled', to: '/scheduled', glyph: 'queue', hint: 'Recurring conductor alarms, across every workspace' },
  { key: 'global-settings', label: 'Settings', to: '/settings', glyph: 'more', hint: 'This daemon — applies to every workspace' },
];
