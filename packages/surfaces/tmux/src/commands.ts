import type { AgentView } from '@agent-conductor/surface-sdk';

/** Glyphs for the nine UI status tokens (design contract §2). */
export const STATUS_GLYPHS: Record<string, string> = {
  idle: '○',
  working: '◑',
  blocked: '■',
  'needs-you': '!',
  merging: '⇅',
  done: '✓',
  failed: '✗',
  paused: '‖',
  stalled: '~',
};

export function statusGlyph(uiStatus: string | undefined): string {
  return (uiStatus && STATUS_GLYPHS[uiStatus]) || '·';
}

/** tmux names must not contain `:` or `.` (target syntax) or whitespace runs. */
export function sanitizeName(value: string): string {
  return value.replace(/[:.\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export const sessionName = (workspaceId: string): string => `ac-${sanitizeName(workspaceId)}`;

export const CONDUCTOR_AGENT_ID = 'conductor';
export const CONDUCTOR_WINDOW_NAME = 'conductor';
export const AGENT_OPTION = '@ac_agent';
export const LIST_FORMAT = '#{window_id}\t#{window_name}\t#{@ac_agent}';

/** Window label: `<glyph> <ticket|role|name>`, trimmed to a sane width. */
export function windowName(agent: Pick<AgentView, 'name' | 'ticketIdentifier' | 'roleName'>, uiStatus?: string, max = 40): string {
  const label = sanitizeName(agent.ticketIdentifier || agent.roleName || agent.name);
  const glyph = statusGlyph(uiStatus);
  return `${glyph} ${label}`.slice(0, max);
}

/** POSIX-quote an argv into a single shell command string. */
export function shellQuote(args: string[]): string {
  return args
    .map((a) => (/^[A-Za-z0-9_\/:=@%+,.-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`))
    .join(' ');
}

const envArgs = (env: Record<string, string> | undefined): string[] =>
  Object.entries(env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]);

export const hasSessionArgs = (session: string): string[] => ['has-session', '-t', `=${session}`];

export function newSessionArgs(session: string, windowName_: string, command: string[], env?: Record<string, string>): string[] {
  return ['new-session', '-d', '-s', session, '-n', windowName_, ...envArgs(env), '-P', '-F', '#{window_id}', shellQuote(command)];
}

export function newWindowArgs(session: string, windowName_: string, command: string[], env?: Record<string, string>): string[] {
  return ['new-window', '-d', '-t', `${session}:`, '-n', windowName_, ...envArgs(env), '-P', '-F', '#{window_id}', shellQuote(command)];
}

export const setAgentOptionArgs = (windowId: string, agentId: string): string[] => ['set-option', '-w', '-t', windowId, AGENT_OPTION, agentId];
export const renameWindowArgs = (windowId: string, name: string): string[] => ['rename-window', '-t', windowId, name];
export const killWindowArgs = (windowId: string): string[] => ['kill-window', '-t', windowId];
export const selectWindowArgs = (windowId: string): string[] => ['select-window', '-t', windowId];
export const listWindowsArgs = (session: string): string[] => ['list-windows', '-t', `=${session}`, '-F', LIST_FORMAT];
export const selectLayoutArgs = (windowId: string, layout = 'tiled'): string[] => ['select-layout', '-t', windowId, layout];

export interface TmuxWindow { windowId: string; name: string; agentId: string | null }

export function parseListWindows(stdout: string): TmuxWindow[] {
  return stdout
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const [windowId = '', name = '', agentId = ''] = line.split('\t');
      return { windowId, name, agentId: agentId || null };
    })
    .filter((w) => w.windowId.startsWith('@'));
}

export function findWindow(windows: TmuxWindow[], agentId: string, windowId?: string): TmuxWindow | undefined {
  return windows.find((w) => w.agentId === agentId) ?? (windowId ? windows.find((w) => w.windowId === windowId) : undefined);
}
