import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { clearLine, createInterface, cursorTo, emitKeypressEvents } from 'node:readline';
import type { LoopDeps, LoopIO } from '../loop.js';
import { SteeringQueue } from '../steering.js';
import { complete, executeCommand, newSessionState, type CommandCtx, type CommandDeps } from './commands.js';
import { resolveApiKey } from './config.js';
import { Renderer } from './events.js';
import { startup, type ReplIO, type ReplOptions } from './main.js';
import { compactReplSession, runReplTurn, type ReplState } from './run.js';
import { findSession, type SessionInfo } from './sessions.js';

export interface TerminalStreams {
  input: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (on: boolean) => unknown };
  output: NodeJS.WritableStream & { isTTY?: boolean };
}
export interface ReplTestHooks { deps?: CommandDeps; loop?: LoopDeps }

const PROMPT = '› ';
const HISTORY_MAX = 500;
const dim = (on: boolean, s: string): string => (on ? `\x1b[2m${s}\x1b[0m` : s);

/** A key typed without echo, held in memory only: the person's answer to "no key for this provider". */
function readHidden(t: TerminalStreams, prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    t.output.write(prompt);
    t.input.setRawMode?.(true);
    t.input.resume();
    let buf = '';
    const done = (v: string | null): void => { t.input.removeListener('data', onData); t.input.setRawMode?.(false); t.output.write('\n'); resolve(v); };
    const onData = (chunk: Buffer | string): void => {
      for (const ch of chunk.toString()) {
        if (ch === '\r' || ch === '\n') return done(buf || null);
        if (ch === '\x03' || ch === '\x04') return done(null);
        if (ch === '\x7f' || ch === '\b') buf = buf.slice(0, -1);
        else if (ch >= ' ') buf += ch;
      }
    };
    t.input.on('data', onData);
  });
}

function loadHistory(file: string): string[] {
  try { return readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-HISTORY_MAX).reverse(); } catch { return []; }
}
function saveHistory(file: string, line: string): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    if (!existsSync(file)) { writeFileSync(file, '', { mode: 0o600 }); chmodSync(file, 0o600); }
    appendFileSync(file, `${line}\n`);
  } catch { /* history is a convenience */ }
}

/**
 * The interactive REPL: readline for the line (history, editing, tab completion), the pure renderer for the
 * turn's output, the pure command layer for slash commands, and the shared loop for the turn itself.
 * Returns the process exit code.
 */
export async function runRepl(o: ReplOptions, io: ReplIO, streams?: TerminalStreams, hooks: ReplTestHooks = {}): Promise<number> {
  const t: TerminalStreams = streams ?? { input: process.stdin, output: process.stdout };
  const tty = t.input.isTTY === true && t.output.isTTY === true;
  const color = tty && io.env['NO_COLOR'] === undefined;
  const s0 = startup(o, io);
  if (!s0.ok) { io.stderr(`weave repl: ${s0.message}\n`); return 2; }
  const { cfg, homeDir } = s0;
  let state: ReplState = s0.state;
  for (const n of cfg.notes) io.stderr(`note: ${n}\n`);
  for (const w of cfg.warnings) io.stderr(`${w}\n`);
  const turnEnv = { cwd: io.cwd, homeDir, env: io.env, ...(io.userHome ? { userHome: io.userHome } : {}) };
  const out = (s: string): void => { if (s) t.output.write(s); };

  // A provider that needs a key and has none: ask once, on a terminal, and keep the answer in memory.
  const entered = new Map<string, string>();
  const ensureKey = async (): Promise<boolean> => {
    const profile = cfg.providers[state.providerId];
    if (!profile || profile.auth === 'none' || entered.has(state.providerId)) return true;
    const k = resolveApiKey({ providerId: state.providerId, profile, env: io.env, workspace: cfg.workspace, daemonDir: cfg.daemonDir });
    if (k.key) return true;
    if (!tty) { io.stderr(`weave repl: no API key for "${state.providerId}": set ${k.name} in the environment\n`); return false; }
    const typed = await readHidden(t, `API key for ${state.providerId} (${k.name}; kept in memory only, never written): `);
    if (!typed) return false;
    entered.set(state.providerId, typed);
    return true;
  };
  if (!(await ensureKey())) return 2;
  const secrets = (): string[] => [resolveApiKey({ providerId: state.providerId, profile: cfg.providers[state.providerId]!, env: io.env, workspace: cfg.workspace, daemonDir: cfg.daemonDir }).key, entered.get(state.providerId)].filter((k): k is string => !!k);

  const banner = (extra = ''): string => `${dim(color, `weave-agent · ${state.providerId}/${state.model || '(no model: /model list)'} · ${state.permission} · session ${state.sessionId.slice(0, 8)}${extra}`)}\n${dim(color, `${io.cwd}  ·  /help for commands`)}\n`;
  out(banner(s0.resumed ? ` (resumed, ${s0.resumed.messages} messages)` : ''));

  const historyFile = join(homeDir, 'history');
  const ctxOf = (): CommandCtx => ({ state, cfg, homeDir, cwd: io.cwd, env: io.env, ...(io.userHome ? { userHome: io.userHome } : {}) });
  const rl = createInterface({ input: t.input, output: t.output, terminal: tty, prompt: PROMPT, history: loadHistory(historyFile), historySize: HISTORY_MAX, completer: (line: string) => complete(line, { cfg, state }) });
  if (tty) emitKeypressEvents(t.input);

  let turn: { ac: AbortController; steering: SteeringQueue; renderer: Renderer } | null = null;
  let pick: SessionInfo[] | null = null;
  let closing = false;
  let armedExit = false;
  const lines: string[] = [];
  let working = false;
  const warned = new Set<string>();

  /** Write while the person may be typing a steering line: clear it, write, then redraw it below. */
  const emit = (text: string): void => {
    if (!text) return;
    if (turn && rl.line.length > 0) { cursorTo(t.output, 0); clearLine(t.output, 0); out(text); if (!text.endsWith('\n')) out('\n'); turn.renderer.resetLine(); rl.prompt(true); return; }
    out(text);
  };

  const runTurn = async (prompt: string): Promise<void> => {
    let next: string | null = prompt;
    while (next !== null && !closing) {
      const renderer = new Renderer({ color, secrets: secrets() });
      const ac = new AbortController();
      const steering = new SteeringQueue();
      turn = { ac, steering, renderer };
      const loopIO: LoopIO = {
        emit: (ev) => emit(renderer.event(ev)),
        partial: (p) => emit(renderer.partial(p)),
        log: (level, msg) => { if ((level === 'warn' || level === 'error') && !warned.has(msg)) { warned.add(msg); emit(`${renderer.finish()}${dim(color, `${level}: ${msg}`)}\n`); } },
      };
      const r = await runReplTurn(state, cfg, next, turnEnv, loopIO, ac.signal, { steering, ...(hooks.loop ? { deps: hooks.loop } : {}), ...(entered.has(state.providerId) ? { keyOverride: entered.get(state.providerId)! } : {}) });
      emit(renderer.finish());
      if (r.error?.code === 'repl_config') out(`error: ${r.error.message}\n`);
      const left = steering.drain();
      turn = null;
      next = left.length > 0 && !ac.signal.aborted ? left.join('\n\n') : null;
    }
  };

  const runCommand = async (line: string): Promise<void> => {
    const res = await executeCommand(line, ctxOf(), hooks.deps ?? {});
    for (const l of res.lines) out(`${l}\n`);
    if (res.state) state = res.state;
    pick = res.pick ?? null;
    const a = res.action;
    if (!a) return;
    if (a.type === 'exit') { closing = true; return; }
    if (a.type === 'new') { state = newSessionState(state, homeDir); out(banner()); }
    if (a.type === 'resume') {
      const s = a.session;
      const p = s.provider && cfg.providers[s.provider] ? { providerId: s.provider, model: s.model ?? state.model } : {};
      state = { ...state, ...p, sessionId: s.id, sessionPath: s.path };
      out(`${dim(color, `resumed ${s.id.slice(0, 8)} (${s.messages} messages) on ${state.providerId}/${state.model}`)}\n`);
    }
    if (a.type === 'compact') {
      const ac = new AbortController();
      const r = await compactReplSession(state, cfg, turnEnv, { emit: () => undefined, partial: () => undefined, log: () => undefined }, ac.signal, { ...(entered.has(state.providerId) ? { keyOverride: entered.get(state.providerId)! } : {}), ...(hooks.loop ? { deps: hooks.loop } : {}) });
      out(`${r.error ? `error: ${r.error.message}` : r.compaction?.ok ? `compacted: ${String(r.compaction.tokensBefore)} → ${String(r.compaction.tokensAfter)} tokens` : `nothing was compacted${r.compaction?.reason ? ` (${r.compaction.reason})` : ''}`}\n`);
    }
  };

  const handle = async (line: string): Promise<void> => {
    armedExit = false;
    if (line.trim()) saveHistory(historyFile, line);
    if (pick) {
      const found = findSession(pick, line.trim());
      if (!('error' in found)) { pick = null; await runCommand(`/sessions ${found.id}`); return; }
      pick = null;
    }
    if (!line.trim()) return;
    if (line.trim().startsWith('/')) { await runCommand(line.trim()); return; }
    if (!(await ensureKey())) return;
    await runTurn(line);
  };

  // A person typing while a turn runs steers it; on a pipe, lines are simply the next inputs in order.
  const pump = async (): Promise<void> => {
    if (working) return;
    working = true;
    try {
      for (let l = lines.shift(); l !== undefined && !closing; l = lines.shift()) { await handle(l); if (!closing) rl.prompt(); }
    } finally { working = false; }
    if (closing || inputEnded) { rl.close(); }
  };
  let inputEnded = false;

  const finished = new Promise<number>((resolve) => {
    rl.on('line', (line) => {
      if (turn && tty) {
        if (line.trim().startsWith('/')) { emit(`${dim(color, 'commands run between turns; Ctrl-C cancels this one')}\n`); return; }
        if (line.trim()) { turn.steering.push(line.trim()); turn.renderer.resetLine(); emit(`${dim(color, `↳ queued: ${line.trim()}`)}\n`); }
        return;
      }
      lines.push(line);
      void pump();
    });
    rl.on('SIGINT', () => {
      if (turn) { turn.ac.abort(); return; }
      if (rl.line.length > 0) { rl.write(null as never, { ctrl: true, name: 'u' }); return; }
      if (armedExit) { closing = true; rl.close(); return; }
      armedExit = true;
      out(`\n${dim(color, '(press Ctrl-C again or Ctrl-D to exit)')}\n`);
      rl.prompt();
    });
    rl.on('close', () => {
      inputEnded = true;
      // On a terminal, Ctrl-D leaves at once (cancelling a running turn); on a pipe, the running work finishes first.
      if (tty) { closing = true; turn?.ac.abort(); }
      const end = (): void => { if (working || turn) setTimeout(end, 20); else { out('\n'); resolve(0); } };
      end();
    });
    // Ctrl-C reaches a paused, non-raw stdin as a signal too.
    rl.prompt();
  });
  // While a turn runs, the first typed character starts a fresh line so the steering text never lands mid-sentence.
  if (tty) t.input.prependListener('keypress', () => { if (turn && rl.line.length === 0) { emit(turn.renderer.finish()); } });
  return finished;
}
