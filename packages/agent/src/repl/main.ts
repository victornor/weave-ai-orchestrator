import { loadReplConfig, type ReplConfig, type ReplFlags } from './config.js';
import { runReplTurn, type ReplState } from './run.js';
import { ensureHome, findSession, listSessions, newSessionId, replHome, sessionPath, type SessionInfo } from './sessions.js';
import { renderEvent } from './events.js';

export interface ReplOptions extends ReplFlags {
  /** `-p`: run one turn and exit. */
  prompt?: string;
  /** `-c`: resume the newest session started in this directory. */
  continue?: boolean;
  /** `--resume <id>`: resume a session by id, prefix or number. */
  resume?: string;
  verbose?: boolean;
}
export interface ReplIO { stdout: (s: string) => void; stderr: (s: string) => void; env: NodeJS.ProcessEnv; cwd: string; home?: string; userHome?: string }

export type Startup = { ok: true; cfg: ReplConfig; state: ReplState; homeDir: string; resumed: SessionInfo | null } | { ok: false; message: string };

/**
 * Everything both modes need before the first turn: config, the provider and model, the session (new, the
 * newest here for `-c`, or a named one for `--resume`), and the mode. A resumed session brings back the
 * provider and model it last used when the command line names none and that provider is still configured.
 */
export function startup(o: ReplOptions, io: ReplIO): Startup {
  const cfg = loadReplConfig({ flags: o, env: io.env, cwd: io.cwd, ...(io.userHome ? { home: io.userHome } : {}) });
  const homeDir = replHome(io.env, io.userHome);
  ensureHome(homeDir);
  let resumed: SessionInfo | null = null;
  if (o.resume) {
    const found = findSession(listSessions(homeDir, { cwd: io.cwd, all: true }), o.resume);
    if ('error' in found) return { ok: false, message: found.error };
    resumed = found;
  } else if (o.continue) {
    resumed = listSessions(homeDir, { cwd: io.cwd })[0] ?? null;
    if (!resumed) return { ok: false, message: 'there is no earlier session in this directory to continue' };
  }
  let providerId = cfg.provider;
  let model = cfg.model;
  if (resumed?.provider && cfg.providers[resumed.provider] && !o.provider && !o.model) { providerId = resumed.provider; model = resumed.model ?? model; }
  if (!providerId || !cfg.providers[providerId]) {
    return { ok: false, message: providerId ? `provider "${providerId}" is not configured` : 'no provider is configured: pass --provider <id> --base-url <url> (the key is read from WEAVE_LLM_<PROVIDER>_KEY), or run inside a workspace with providers' };
  }
  const id = resumed?.id ?? newSessionId();
  const state: ReplState = { providerId, model: model ?? '', permission: cfg.permission, effort: null, params: {}, sessionId: id, sessionPath: resumed?.path ?? sessionPath(homeDir, id) };
  return { ok: true, cfg, state, homeDir, resumed };
}

/** `-p`: one turn, the final text on stdout, and the loop's exit code. Events go to stderr only with `--verbose`. */
export async function runOneShot(o: ReplOptions, io: ReplIO, signal: AbortSignal): Promise<number> {
  const s = startup(o, io);
  if (!s.ok) { io.stderr(`weave repl: ${s.message}\n`); return 2; }
  for (const n of s.cfg.notes) io.stderr(`note: ${n}\n`);
  const verbose = o.verbose === true;
  const loopIO = {
    emit: (ev: { type: string; payload: Record<string, unknown> }) => { if (verbose) for (const l of renderEvent(ev, { color: false })) io.stderr(`${l}\n`); },
    partial: () => undefined,
    log: (level: string, msg: string) => { if (verbose || level === 'warn' || level === 'error') io.stderr(`${level}: ${msg}\n`); },
  };
  
  const r = await runReplTurn(s.state, s.cfg, o.prompt ?? '', { cwd: io.cwd, homeDir: s.homeDir, env: io.env, ...(io.userHome ? { userHome: io.userHome } : {}) }, loopIO, signal);
  if (r.finalText) io.stdout(r.finalText.endsWith('\n') ? r.finalText : `${r.finalText}\n`);
  if (r.error) io.stderr(`error: ${r.error.message}\n`);
  return r.exitCode ?? 1;
}
export { replHome };
