import { loadSkillRoots } from '../skills.js';
import { testMcpServer, type McpTestResult } from '../mcp/client.js';
import { requestHeaders } from '../profile.js';
import { headersWithExtras, loadPreset, paramsFromOptions, resolveProvider } from '../resolve.js';
import { REPL_PERMISSIONS, isPermission, resolveApiKey, resolveMcpRefs, type ReplConfig } from './config.js';
import { skillRootsFor, type ReplState } from './run.js';
import { ageOf, findSession, listSessions, newSessionId, sessionPath, type SessionInfo } from './sessions.js';

export const COMMANDS = ['help', 'sessions', 'new', 'compact', 'skills', 'mcp', 'model', 'permissions', 'exit'] as const;
const ALIASES: Record<string, string> = { quit: 'exit', q: 'exit', resume: 'sessions', models: 'model', perm: 'permissions' };
const HELP: Array<[string, string]> = [
  ['/help', 'this list'],
  ['/sessions [--all] [n|id]', 'list your sessions here (--all: everywhere); a number or id resumes it'],
  ['/new', 'start a fresh session'],
  ['/compact', 'summarise the older part of this conversation now'],
  ['/skills', 'the skills available in this directory and where each came from'],
  ['/mcp [server]', 'configured MCP servers: connected or failed, and their tools'],
  ['/model [list|<id>|<param> <value>|unset <param>]', 'show or change provider, model, effort and parameters for the next turn'],
  ['/permissions [auto|restricted|bypass]', 'show or set what the agent may do'],
  ['/exit', 'leave (Ctrl-D also works)'],
];
/** Parameter names `/model` accepts, with the option key each maps to. `effort` is not a wire parameter: the provider's compat maps it. */
const PARAM_ALIASES: Record<string, string> = { temperature: 'temperature', topp: 'topP', top_p: 'topP', maxoutputtokens: 'maxOutputTokens', max_tokens: 'maxOutputTokens', contextwindowtokens: 'contextWindowTokens', contextwindow: 'contextWindowTokens', frequencypenalty: 'frequencyPenalty', presencepenalty: 'presencePenalty', seed: 'seed' };
export const PARAM_KEYS = ['effort', 'temperature', 'topP', 'maxOutputTokens', 'contextWindowTokens', 'frequencyPenalty', 'presencePenalty', 'seed'] as const;

export interface CommandCtx { state: ReplState; cfg: ReplConfig; homeDir: string; cwd: string; env: NodeJS.ProcessEnv; userHome?: string }
export interface CommandDeps { fetch?: typeof fetch; testMcp?: (o: { config: Parameters<typeof testMcpServer>[0]['config']; env?: Record<string, string>; timeoutMs?: number }) => Promise<McpTestResult>; now?: () => number }
export type CommandAction = { type: 'exit' } | { type: 'new' } | { type: 'resume'; session: SessionInfo } | { type: 'compact' };
export interface CommandResult {
  lines: string[];
  /** The state after the command; absent when nothing changed. */
  state?: ReplState;
  action?: CommandAction;
  /** Set by a bare `/sessions`: the next line, if it names one of these, resumes it. */
  pick?: SessionInfo[];
}

export function parseCommand(line: string): { name: string; args: string[] } | null {
  const t = line.trim();
  if (!t.startsWith('/')) return null;
  const [head = '', ...args] = t.slice(1).split(/\s+/).filter(Boolean);
  const name = head.toLowerCase();
  return { name: ALIASES[name] ?? name, args };
}

const pad = (s: string, n: number): string => (s.length >= n ? `${s} ` : s + ' '.repeat(n - s.length));
const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function helpLines(): string[] {
  const w = Math.max(...HELP.map(([c]) => c.length));
  return ['Commands:', ...HELP.map(([c, d]) => `  ${pad(c, w)}  ${d}`), '', 'Type while a turn runs to steer it. Ctrl-C cancels the turn; a second Ctrl-C at an idle prompt, or Ctrl-D, exits.'];
}

/** Numbered session rows: id, age, model, message count and the first thing you asked. */
export function sessionLines(list: readonly SessionInfo[], o: { all: boolean; now?: number; cwd?: string }): string[] {
  if (list.length === 0) return [o.all ? 'No sessions yet.' : 'No sessions in this directory. `/sessions --all` looks everywhere.'];
  return [
    ...list.map((s, i) => `${pad(`${i + 1}.`, 4)}${s.id.slice(0, 8)}  ${pad(ageOf(s.updatedAt, o.now), 4)} ${pad(s.model ?? '?', 16)} ${pad(`${s.messages} msg`, 8)} ${truncate(s.firstPrompt || '(no prompt)', 60)}${o.all && s.cwd ? `  [${s.cwd}]` : ''}`),
    'Enter a number or id to resume one.',
  ];
}

interface ModelEntry { id: string; source: 'static' | 'detected'; contextWindow?: number }

/** The provider's models: what the profile lists, then what `GET {baseUrl}{modelsPath}` reports (unless `discover: false`). A failed lookup is a note and the static list. */
export async function modelCatalogue(ctx: CommandCtx, deps: CommandDeps): Promise<{ models: ModelEntry[]; note?: string }> {
  const profile = ctx.cfg.providers[ctx.state.providerId];
  if (!profile) return { models: [], note: `no provider "${ctx.state.providerId}"` };
  const models: ModelEntry[] = Object.entries(profile.models).map(([id, m]) => ({ id, source: 'static' as const, ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}) }));
  if (profile.discover === false) return { models };
  const preset = loadPreset(profile.preset ?? 'openai-compatible');
  const { compat, params } = resolveProvider({ preset, profile });
  const key = resolveApiKey({ providerId: ctx.state.providerId, profile, env: ctx.env, workspace: ctx.cfg.workspace });
  const headers = requestHeaders({ id: ctx.state.providerId, baseUrl: profile.baseUrl, auth: profile.auth, headers: headersWithExtras(profile.headers, params.extraHeaders).headers, ...(key.key ? { apiKey: key.key } : {}) });
  const qs = new URLSearchParams(profile.query ?? {}).toString();
  try {
    const res = await (deps.fetch ?? fetch)(`${profile.baseUrl.replace(/\/+$/, '')}${compat.modelsPath}${qs ? `?${qs}` : ''}`, { headers: { ...headers, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { models, note: `the endpoint's model list answered HTTP ${res.status}; showing configured models only` };
    const json = await res.json() as { data?: unknown };
    const list = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json as unknown[] : [];
    const have = new Set(models.map((m) => m.id));
    for (const m of list) {
      const id = typeof m === 'object' && m !== null ? (m as Record<string, unknown>)['id'] : undefined;
      if (typeof id === 'string' && id && !have.has(id)) { have.add(id); models.push({ id, source: 'detected' }); }
    }
    return { models };
  } catch (e) { return { models, note: `could not list models (${(e as Error).message}); showing configured models only` }; }
}

function modelStatus(ctx: CommandCtx): string[] {
  const { state, cfg } = ctx;
  const profile = cfg.providers[state.providerId];
  const lines = [`provider     ${state.providerId}${profile ? `  ${profile.baseUrl}` : ''}`, `model        ${state.model || '(none)'}`];
  const preset = profile ? loadPreset(profile.preset ?? 'openai-compatible') : undefined;
  const resolved = profile ? resolveProvider({ preset, profile, model: profile.models[state.model], options: state.params }) : null;
  const effortParam = resolved?.compat.reasoning.effortParam;
  lines.push(`effort       ${state.effort ?? 'unset'}${state.effort && effortParam === 'none' ? '  (this provider has no effort parameter: not sent)' : ''}`);
  const set = Object.entries(resolved?.params ?? {}).filter(([, v]) => v !== undefined);
  lines.push(set.length === 0 ? 'parameters   none set (nothing but the model and messages is sent)' : `parameters   ${set.map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('  ')}`);
  return lines;
}

function parseValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const n = Number(raw);
  return raw !== '' && Number.isFinite(n) ? n : raw;
}

async function modelCommand(args: string[], ctx: CommandCtx, deps: CommandDeps): Promise<CommandResult> {
  const { state, cfg } = ctx;
  if (args.length === 0) return { lines: [...modelStatus(ctx), '', '/model list shows the models; /model <id> switches; /model effort high, /model temperature 0.2 … set a parameter; /model unset <param> clears it.'] };
  const sub = (args[0] ?? '').toLowerCase();
  if (sub === 'list') {
    const cat = await modelCatalogue(ctx, deps);
    if (cat.models.length === 0) return { lines: [cat.note ?? 'No models are listed for this provider. `/model <id>` names one.'] };
    return { lines: [...cat.models.map((m, i) => `${pad(`${i + 1}.`, 4)}${pad(m.id, 40)}${m.id === state.model ? '● ' : '  '}${m.source}${m.contextWindow ? `  ${m.contextWindow} tokens` : ''}`), ...(cat.note ? [cat.note] : []), 'Use /model <number|id> to switch.'] };
  }
  if (sub === 'unset') {
    const key = args[1] === 'effort' ? 'effort' : PARAM_ALIASES[(args[1] ?? '').toLowerCase()];
    if (!key) return { lines: [`unset what? one of: ${PARAM_KEYS.join(', ')}`] };
    if (key === 'effort') return { lines: ['effort is unset'], state: { ...state, effort: null } };
    const { [key]: _gone, ...rest } = state.params;
    return { lines: [`${key} is unset (it will not be sent)`], state: { ...state, params: rest } };
  }
  if (sub === 'effort') {
    const value = args[1];
    if (!value) return { lines: [`effort is ${state.effort ?? 'unset'}`] };
    const profile = cfg.providers[state.providerId];
    const levels = profile ? resolveProvider({ preset: loadPreset(profile.preset ?? 'openai-compatible'), profile, model: profile.models[state.model] }).compat.reasoning.effortLevels : [];
    if (levels.length > 0 && !levels.includes(value)) return { lines: [`effort "${value}" is not one of: ${levels.join(', ')}`] };
    return { lines: [`effort is now ${value}`], state: { ...state, effort: value } };
  }
  const paramKey = PARAM_ALIASES[sub];
  if (paramKey) {
    const raw = args[1];
    if (raw === undefined) return { lines: [`${paramKey} is ${String(state.params[paramKey] ?? 'unset')}`] };
    const value = parseValue(raw);
    // The parameter schema is the judge: the same check a role's options get.
    const checked = paramsFromOptions({ [paramKey]: value });
    if (checked.errors.length > 0) return { lines: [`refused: ${checked.errors.join('; ')}`] };
    if (paramKey === 'contextWindowTokens' && !(typeof value === 'number' && Number.isInteger(value) && value > 0)) return { lines: ['refused: contextWindowTokens must be a positive whole number'] };
    return { lines: [`${paramKey} is now ${String(value)}`], state: { ...state, params: { ...state.params, [paramKey]: paramKey === 'contextWindowTokens' ? value : (checked.params as Record<string, unknown>)[paramKey] } } };
  }
  // Otherwise: a model. `provider/model`, a bare id, or a number from `/model list`.
  let target = args.join(' ');
  let providerId = state.providerId;
  if (/^\d+$/.test(target)) {
    const cat = await modelCatalogue(ctx, deps);
    const pick = cat.models[Number(target) - 1];
    if (!pick) return { lines: [`no model number ${target}: /model list shows them`] };
    target = pick.id;
  } else {
    const slash = target.indexOf('/');
    const head = slash > 0 ? target.slice(0, slash) : '';
    if (head && cfg.providers[head]) { providerId = head; target = target.slice(slash + 1); }
  }
  return { lines: [`model is now ${providerId}/${target}${providerId !== state.providerId ? ' (a different provider: its key is looked up next turn)' : ''}`], state: { ...state, providerId, model: target } };
}

async function mcpCommand(args: string[], ctx: CommandCtx, deps: CommandDeps): Promise<CommandResult> {
  const names = Object.keys(ctx.cfg.mcpServers);
  if (names.length === 0) return { lines: ['No MCP servers are configured. Add `mcpServers:` to the workspace or to ~/.config/weave/agent.yaml.'] };
  const wanted = args[0];
  if (wanted && !ctx.cfg.mcpServers[wanted]) return { lines: [`no MCP server "${wanted}"; configured: ${names.join(', ')}`] };
  const probe = deps.testMcp ?? testMcpServer;
  const base: Record<string, string> = { TERM: 'dumb' };
  for (const k of ['PATH', 'HOME', 'LANG', 'TMPDIR', 'USER']) { const v = ctx.env[k]; if (v !== undefined) base[k] = v; }
  const results = await Promise.all((wanted ? [wanted] : names).map(async (name) => {
    const { server, missing } = resolveMcpRefs(ctx.cfg.mcpServers[name]!, { env: ctx.env, workspace: ctx.cfg.workspace });
    const r = await probe({ config: { type: server.type, ...(server.url ? { url: server.url } : {}), headers: server.headers, ...(server.command ? { command: server.command } : {}), args: server.args, env: server.env }, env: base, timeoutMs: Math.min(server.listTimeoutMs, 15_000) });
    return { name, r, missing, readOnly: server.readOnly };
  }));
  if (wanted) {
    const { r, missing } = results[0]!;
    if (!r.ok) return { lines: [`${wanted}  failed: ${r.error ?? 'unknown error'}${missing.length ? `  (unset: ${missing.join(', ')})` : ''}`] };
    return { lines: [`${wanted}  connected, ${r.tools.length} tool${r.tools.length === 1 ? '' : 's'}`, ...r.tools.map((t) => `  ${pad(t.name, 28)}${truncate(t.description.split('\n')[0] ?? '', 70)}`)] };
  }
  const w = Math.max(...names.map((n) => n.length));
  return { lines: results.map(({ name, r, missing }) => `${pad(name, w)}  ${r.ok ? `connected  ${r.tools.length} tool${r.tools.length === 1 ? '' : 's'}` : `failed     ${r.error ?? 'unknown error'}${missing.length ? `  (unset: ${missing.join(', ')})` : ''}`}`) };
}

/** Run one slash command. Pure with respect to the terminal: it returns lines to print, the new state and an action for the driver. */
export async function executeCommand(line: string, ctx: CommandCtx, deps: CommandDeps = {}): Promise<CommandResult> {
  const cmd = parseCommand(line);
  if (!cmd) return { lines: [] };
  switch (cmd.name) {
    case 'help': return { lines: helpLines() };
    case 'exit': return { lines: [], action: { type: 'exit' } };
    case 'new': return { lines: ['Started a new session.'], action: { type: 'new' } };
    case 'compact': return { lines: [], action: { type: 'compact' } };
    case 'skills': {
      const skills = loadSkillRoots(skillRootsFor(ctx.cwd, ctx.userHome, ctx.env));
      if (skills.length === 0) return { lines: ['No skills found. Put one in ./.agents/skills/<name>/SKILL.md (this project) or ~/.agents/skills/<name>/SKILL.md (all projects).'] };
      const w = Math.max(...skills.map((s) => s.name.length));
      return { lines: skills.map((s) => `${pad(s.name, w)}  ${pad(truncate(s.description, 60), 60)}  [${s.source ?? 'default'}]`) };
    }
    case 'mcp': return mcpCommand(cmd.args, ctx, deps);
    case 'model': return modelCommand(cmd.args, ctx, deps);
    case 'permissions': {
      const mode = cmd.args[0];
      if (!mode) return { lines: [`permission mode: ${ctx.state.permission}`, '  auto        every tool; file tools confined to this directory; risky shell commands refused',  '  restricted  read-only: read, search, skills, MCP servers marked read-only',  '  bypass      no shell-command guard and reads outside this directory'] };
      if (!isPermission(mode)) return { lines: [`"${mode}" is not one of: ${REPL_PERMISSIONS.join(', ')}`] };
      return { lines: [`permission mode is now ${mode}`], state: { ...ctx.state, permission: mode } };
    }
    case 'sessions': {
      const all = cmd.args.includes('--all');
      const ref = cmd.args.find((a) => a !== '--all');
      const list = listSessions(ctx.homeDir, { cwd: ctx.cwd, all });
      if (ref) {
        const found = findSession(list, ref);
        return 'error' in found ? { lines: [found.error] } : { lines: [`Resuming ${found.id.slice(0, 8)}: ${found.firstPrompt || '(no prompt)'}`], action: { type: 'resume', session: found } };
      }
      return { lines: sessionLines(list, { all, ...(deps.now ? { now: deps.now() } : {}) }), ...(list.length > 0 ? { pick: list } : {}) };
    }
    default: return { lines: [`unknown command /${cmd.name}: /help lists them`] };
  }
}

/** A state for a freshly started session, keeping provider, model, mode and parameters. */
export function newSessionState(state: ReplState, homeDir: string): ReplState {
  const id = newSessionId();
  return { ...state, sessionId: id, sessionPath: sessionPath(homeDir, id) };
}

/** Tab completion: `[candidates, the fragment being completed]`, readline's shape. */
export function complete(line: string, ctx: { cfg: ReplConfig; state: ReplState }): [string[], string] {
  if (!line.startsWith('/')) return [[], line];
  const parts = line.split(/\s+/);
  if (parts.length <= 1) { const hits = COMMANDS.map((c) => `/${c}`).filter((c) => c.startsWith(line)); return [hits.length ? hits : COMMANDS.map((c) => `/${c}`), line]; }
  const cmd = ALIASES[(parts[0] ?? '').slice(1).toLowerCase()] ?? (parts[0] ?? '').slice(1).toLowerCase();
  const frag = parts[parts.length - 1] ?? '';
  const pick = (opts: readonly string[]): [string[], string] => [opts.filter((o) => o.startsWith(frag)), frag];
  if (cmd === 'permissions' && parts.length === 2) return pick(REPL_PERMISSIONS);
  if (cmd === 'sessions' && parts.length === 2) return pick(['--all']);
  if (cmd === 'mcp' && parts.length === 2) return pick(Object.keys(ctx.cfg.mcpServers));
  if (cmd === 'model') {
    if (parts.length === 2) return pick(['list', 'unset', ...PARAM_KEYS, ...Object.keys(ctx.cfg.providers[ctx.state.providerId]?.models ?? {})]);
    if (parts[1] === 'unset' && parts.length === 3) return pick(PARAM_KEYS);
  }
  return [[], frag];
}
