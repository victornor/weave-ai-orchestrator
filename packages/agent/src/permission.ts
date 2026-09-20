/**
 * Permission modes for the built-in agent (runtime-details section 6, VS-608).
 *
 * The mode decides the tool set up front — there is no approval round-trip in v1. `restricted`
 * exposes only the read-only core tools plus MCP, `auto` adds the write-capable tools and the bash
 * deny patterns, `bypass` adds neither deny patterns nor read confinement (the file-tool protected
 * list in `confine.ts` still applies). Tool allow/deny lists match on the tool's own name and on its
 * Claude alias, so a role config written for Claude selects the same tool.
 */
export type PermissionMode = 'auto' | 'restricted' | 'bypass';

export interface PermissionConfig {
  mode: PermissionMode;
  allowedTools?: string[] | undefined;
  deniedTools?: string[] | undefined;
  firstTurn?: boolean | undefined;
  /** Extra bash deny patterns (regular expressions), from the role. */
  bashDeny?: string[] | undefined;
}

/** The read-only core tools a `restricted` turn may see, before the MCP tools are added. */
export const RESTRICTED_CORE_TOOLS = ['read', 'grep', 'glob'] as const;
/**
 * The full core tool set. `web_fetch` is named here so the mode logic treats it like the write-capable
 * tools — `restricted` removes it — even though it is only offered when the turn's option enables it.
 */
export const ALL_CORE_TOOLS = ['read', 'write', 'edit', 'bash', 'grep', 'glob', 'web_fetch'] as const;

/** A name key that folds case, underscores and the Claude spellings together. */
export const toolKey = (name: string): string => name.toLowerCase().replace(/_/g, '');

const CLAUDE_ALIASES = ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob', 'TodoWrite'];

/** `TodoWrite` → `todo_write`; every other alias is already the lower-case name. */
const ALIAS_CANONICAL: Record<string, string> = Object.fromEntries(CLAUDE_ALIASES.map((a) => [toolKey(a), a === 'TodoWrite' ? 'todo_write' : a.toLowerCase()]));

/** Whether a tool name is selected by a user-written allow/deny entry (case- and alias-insensitive). */
const matches = (name: string, list: readonly string[]): boolean => {
  const key = toolKey(name);
  return list.some((entry) => toolKey(entry) === key);
};

/** Tools removed by the mode before the request is built. `restricted` never offers write-capable tools. */
export function modeToolNames(mode: PermissionMode): readonly string[] {
  return mode === 'restricted' ? RESTRICTED_CORE_TOOLS : ALL_CORE_TOOLS;
}

export function isAllowedByLists(name: string, cfg: PermissionConfig): boolean {
  if (cfg.deniedTools?.length && matches(name, cfg.deniedTools)) return false;
  if (cfg.firstTurn && cfg.allowedTools?.length && !matches(name, cfg.allowedTools)) return false;
  return true;
}

export interface Denial { reason: string; text: string }

const denial = (mode: PermissionMode, reason: string): Denial => ({ reason, text: `Denied by permission mode "${mode}"${reason ? `: ${reason}` : ''}` });

/** Why a call the mode or the lists removed was refused; null when it is allowed. */
export function toolDenial(name: string, cfg: PermissionConfig, modeAllows: (n: string) => boolean): Denial | null {
  if (!modeAllows(name)) return denial(cfg.mode, `the "${name}" tool is not available in ${cfg.mode} mode`);
  if (cfg.deniedTools?.length && matches(name, cfg.deniedTools)) return denial(cfg.mode, `"${name}" is denied by the role's tool list`);
  if (cfg.firstTurn && cfg.allowedTools?.length && !matches(name, cfg.allowedTools)) return denial(cfg.mode, `"${name}" is not in the role's allowed tool list`);
  return null;
}

interface DenyRule { rule: string; re: RegExp }

const BASH_DENY: DenyRule[] = [
  { rule: 'pkill', re: /\bpkill\b/ },
  { rule: 'killall', re: /\bkillall\b/ },
  { rule: 'kill by pgrep', re: /\bkill\b[^\n|;&]*\bpgrep\b/ },
  { rule: 'systemctl', re: /\bsystemctl\b/ },
  { rule: 'daemon control', re: /\b(?:weave|conductor)\s+daemon\s+(?:start|stop|restart|upgrade)\b/ },
  { rule: 'sudo', re: /\bsudo\b/ },
  { rule: 'gh auth login', re: /\bgh\s+auth\s+login\b/ },
  { rule: 'push to a default branch', re: /\bgit\s+push\b[^\n|;&]*\b(?:main|master)\b/ },
  { rule: 'rm -rf of /, ~ or $HOME', re: /\brm\s+(?:-[A-Za-z]+\s+)*-[A-Za-z]*r[A-Za-z]*f[A-Za-z]*\s+(?:\/(?:\s|$)|\/[*]|~(?:\/|\s|$)|\$HOME\b|\$\{HOME\})/ },
];

/** In `auto`, a command matching a deny rule is refused before it runs. `bypass` does not apply them. */
export function bashDenial(command: string, cfg: PermissionConfig): Denial | null {
  if (cfg.mode !== 'auto') return null;
  for (const { rule, re } of BASH_DENY) if (re.test(command)) return denial(cfg.mode, `the command matches the "${rule}" deny rule`);
  for (const extra of cfg.bashDeny ?? []) {
    let re: RegExp;
    try { re = new RegExp(extra); } catch { continue; }
    if (re.test(command)) return denial(cfg.mode, `the command matches the configured deny rule`);
  }
  return null;
}

export { ALIAS_CANONICAL };