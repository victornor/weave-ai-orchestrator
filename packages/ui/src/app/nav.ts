import type { UiStatus } from '@agent-conductor/shared';

export interface NavItem {
  key: string;
  label: string;
  to: string;
  /** desktop rail keyboard number; `,` for Settings */
  kbd: string;
  glyph: UiStatus | 'chat' | 'board' | 'more';
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

export function href(item: NavItem, ws: string): string {
  return item.to.replace('$ws', encodeURIComponent(ws));
}
