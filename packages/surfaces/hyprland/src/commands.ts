/** Pure `hyprctl` argv builders and parsers. No process is ever spawned from here. */

export interface TerminalSpec { cmd: string; classFlag: string; execFlag: string }

/** Both spellings exist across Hyprland versions; the adapter keeps whichever is accepted. */
export const RULE_KEYWORDS = ['windowrule', 'windowrulev2'] as const;
export type RuleKeyword = (typeof RULE_KEYWORDS)[number];

export const sanitizeToken = (value: string): string => value.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

export const workspacePrefix = (workspaceId: string): string => `oc-${sanitizeToken(workspaceId)}`;
export const windowClass = (workspaceId: string, agentId: string): string => `${workspacePrefix(workspaceId)}-${sanitizeToken(agentId)}`;
export const classPattern = (cls: string): string => `^(${cls})$`;
export const workspaceClassPattern = (workspaceId: string): string => `^(${workspacePrefix(workspaceId)}-.*)$`;

/** `hyprctl keyword windowrule "workspace <n> silent, class:^(oc-<ws>-.*)$"` */
export function windowRuleArgs(keyword: RuleKeyword, workspaceId: string, hyprWorkspace: string | number): string[] {
  return ['keyword', keyword, `workspace ${hyprWorkspace} silent, class:${workspaceClassPattern(workspaceId)}`];
}

/** POSIX-quote an argv into a single command string for `hyprctl dispatch exec`. */
export function shellQuote(args: string[]): string {
  return args
    .map((a) => (/^[A-Za-z0-9_\/:=@%+,.-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`))
    .join(' ');
}

/** `--class=` style flags take the value attached; `--class` / `-a` take it as the next token. */
export function formatClassFlag(flag: string, value: string): string {
  return flag.endsWith('=') ? `${flag}${value}` : `${flag} ${value}`;
}

export interface ExecOptions {
  terminal: TerminalSpec;
  cls: string;
  command: string[];
  hyprWorkspace?: string | number | null;
}

export function execArgs(opts: ExecOptions): string[] {
  const rule = opts.hyprWorkspace == null || opts.hyprWorkspace === '' ? '' : `[workspace ${opts.hyprWorkspace} silent] `;
  const line = `${rule}${opts.terminal.cmd} ${formatClassFlag(opts.terminal.classFlag, opts.cls)} ${opts.terminal.execFlag} ${shellQuote(opts.command)}`;
  return ['dispatch', 'exec', line];
}

export const focusArgs = (cls: string): string[] => ['dispatch', 'focuswindow', `class:${classPattern(cls)}`];
export const closeArgs = (cls: string): string[] => ['dispatch', 'closewindow', `class:${classPattern(cls)}`];
export const clientsArgs = (): string[] => ['clients', '-j'];
export const layoutMsgArgs = (message: string): string[] => ['dispatch', 'layoutmsg', message];

export interface HyprClient { address: string; class: string; initialClass?: string; title?: string; workspace?: { id?: number; name?: string }; pid?: number }

export function parseClients(stdout: string): HyprClient[] {
  let data: unknown;
  try { data = JSON.parse(stdout); } catch { return []; }
  if (!Array.isArray(data)) return [];
  return data
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({
      address: String(c.address ?? ''),
      class: String(c.class ?? ''),
      initialClass: typeof c.initialClass === 'string' ? c.initialClass : undefined,
      title: typeof c.title === 'string' ? c.title : undefined,
      workspace: (c.workspace as HyprClient['workspace']) ?? undefined,
      pid: typeof c.pid === 'number' ? c.pid : undefined,
    }))
    .filter((c) => c.address !== '');
}

export function findClient(clients: HyprClient[], cls: string): HyprClient | undefined {
  return clients.find((c) => c.class === cls || c.initialClass === cls);
}
