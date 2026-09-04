/** Pure `herdr` argv builders and JSON parsers. Nothing here spawns a process. */

const envArgs = (env?: Record<string, string>): string[] =>
  Object.entries(env ?? {}).flatMap(([k, v]) => ['--env', `${k}=${v}`]);

export const workspaceListArgs = (): string[] => ['workspace', 'list'];
export const workspaceCreateArgs = (label: string, opts: { cwd?: string; env?: Record<string, string> } = {}): string[] => [
  'workspace', 'create', '--label', label, '--no-focus',
  ...(opts.cwd ? ['--cwd', opts.cwd] : []),
  ...envArgs(opts.env),
];
export const workspaceFocusArgs = (workspaceId: string): string[] => ['workspace', 'focus', workspaceId];

export const tabListArgs = (workspaceId: string): string[] => ['tab', 'list', '--workspace', workspaceId];
export const tabCreateArgs = (workspaceId: string, label: string, opts: { cwd?: string; env?: Record<string, string> } = {}): string[] => [
  'tab', 'create', '--workspace', workspaceId, '--label', label, '--no-focus',
  ...(opts.cwd ? ['--cwd', opts.cwd] : []),
  ...envArgs(opts.env),
];
export const tabFocusArgs = (tabId: string): string[] => ['tab', 'focus', tabId];

export const paneListArgs = (workspaceId?: string): string[] => ['pane', 'list', ...(workspaceId ? ['--workspace', workspaceId] : [])];
export const paneSplitArgs = (
  paneId: string,
  direction: 'right' | 'down' = 'right',
  opts: { cwd?: string; env?: Record<string, string> } = {},
): string[] => [
  'pane', 'split', paneId, '--direction', direction, '--no-focus',
  ...(opts.cwd ? ['--cwd', opts.cwd] : []),
  ...envArgs(opts.env),
];
export const paneRunArgs = (paneId: string, command: string[]): string[] => ['pane', 'run', paneId, shellQuote(command)];
export const paneRenameArgs = (paneId: string, label: string): string[] => ['pane', 'rename', paneId, label];
export const paneCloseArgs = (paneId: string): string[] => ['pane', 'close', paneId];

/** POSIX-quote an argv into the single command string `herdr pane run` expects. */
export function shellQuote(args: string[]): string {
  return args
    .map((a) => (/^[A-Za-z0-9_\/:=@%+,.-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`))
    .join(' ');
}

/** Marker put into the pane label so panes can be re-resolved without trusting ids. */
export const agentMarker = (agentId: string): string => `oc:${agentId}`;

export function paneLabel(agentId: string, title: string): string {
  return `${agentMarker(agentId)} ${title}`.trim();
}

export function parseResult<T>(stdout: string): T | null {
  try {
    const parsed = JSON.parse(stdout) as { result?: T };
    return (parsed?.result as T) ?? null;
  } catch {
    return null;
  }
}

export interface HerdrWorkspace { workspaceId: string; label: string; activeTabId: string | null; number: number | null }
export interface HerdrTab { tabId: string; workspaceId: string; label: string; number: number | null }
export interface HerdrPane {
  paneId: string;
  tabId: string;
  workspaceId: string;
  title: string | null;
  agentStatus: string | null;
  raw: Record<string, unknown>;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function parseWorkspaceList(stdout: string): HerdrWorkspace[] {
  const result = parseResult<{ workspaces?: Array<Record<string, unknown>> }>(stdout);
  return (result?.workspaces ?? [])
    .map((w) => ({
      workspaceId: String(w.workspace_id ?? ''),
      label: String(w.label ?? ''),
      activeTabId: str(w.active_tab_id),
      number: typeof w.number === 'number' ? w.number : null,
    }))
    .filter((w) => w.workspaceId !== '');
}

export function parseTabList(stdout: string): HerdrTab[] {
  const result = parseResult<{ tabs?: Array<Record<string, unknown>> }>(stdout);
  return (result?.tabs ?? [])
    .map((t) => ({
      tabId: String(t.tab_id ?? ''),
      workspaceId: String(t.workspace_id ?? ''),
      label: String(t.label ?? ''),
      number: typeof t.number === 'number' ? t.number : null,
    }))
    .filter((t) => t.tabId !== '');
}

function toPane(p: Record<string, unknown>): HerdrPane {
  return {
    paneId: String(p.pane_id ?? ''),
    tabId: String(p.tab_id ?? ''),
    workspaceId: String(p.workspace_id ?? ''),
    title: str(p.terminal_title_stripped) ?? str(p.terminal_title) ?? str(p.label) ?? str(p.title),
    agentStatus: str(p.agent_status),
    raw: p,
  };
}

export function parsePaneList(stdout: string): HerdrPane[] {
  const result = parseResult<{ panes?: Array<Record<string, unknown>> }>(stdout);
  return (result?.panes ?? []).map(toPane).filter((p) => p.paneId !== '');
}

/** `pane split` / `workspace create` / `tab create` responses nest the created entity. */
export function parseCreatedPaneId(stdout: string): string | null {
  const result = parseResult<{ pane?: { pane_id?: string }; pane_id?: string }>(stdout);
  return str(result?.pane?.pane_id) ?? str(result?.pane_id);
}
export function parseCreatedWorkspaceId(stdout: string): string | null {
  const result = parseResult<{ workspace?: { workspace_id?: string }; workspace_id?: string }>(stdout);
  return str(result?.workspace?.workspace_id) ?? str(result?.workspace_id);
}
export function parseCreatedTabId(stdout: string): string | null {
  const result = parseResult<{ tab?: { tab_id?: string; pane?: { pane_id?: string } }; tab_id?: string; pane?: { pane_id?: string } }>(stdout);
  return str(result?.tab?.tab_id) ?? str(result?.tab_id);
}
export function parseCreatedTabRootPaneId(stdout: string): string | null {
  const result = parseResult<{ tab?: { pane?: { pane_id?: string }; panes?: Array<{ pane_id?: string }> }; pane?: { pane_id?: string } }>(stdout);
  return str(result?.tab?.pane?.pane_id) ?? str(result?.tab?.panes?.[0]?.pane_id) ?? str(result?.pane?.pane_id);
}

/** herdr ids compact when panes close: always re-resolve by scanning for the agent marker. */
export function paneMatchesAgent(pane: HerdrPane, agentId: string): boolean {
  const marker = agentMarker(agentId);
  const values = Object.values(pane.raw).filter((v): v is string => typeof v === 'string');
  return values.some((v) => v.includes(marker) || v.includes(agentId));
}

export function findPaneForAgent(panes: HerdrPane[], agentId: string, workspaceId?: string): HerdrPane | undefined {
  const scoped = workspaceId ? panes.filter((p) => p.workspaceId === workspaceId) : panes;
  return scoped.find((p) => paneMatchesAgent(p, agentId)) ?? panes.find((p) => paneMatchesAgent(p, agentId));
}

export function findWorkspaceByLabel(workspaces: HerdrWorkspace[], label: string): HerdrWorkspace | undefined {
  return workspaces.find((w) => w.label === label) ?? workspaces.find((w) => w.label.includes(label));
}

export function findTabByLabel(tabs: HerdrTab[], label: string): HerdrTab | undefined {
  return tabs.find((t) => t.label === label) ?? tabs.find((t) => t.label.includes(label));
}
