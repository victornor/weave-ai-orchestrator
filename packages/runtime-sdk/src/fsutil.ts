import { execFile } from 'node:child_process';
import { accessSync, constants, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { AgentHome, InstructionBundle, RuntimeDetection } from './index.js';

const pExecFile = promisify(execFile);

/**
 * Per-user toolchain dirs searched when PATH misses. Daemons under systemd get a minimal
 * PATH (`/usr/local/bin:/usr/bin`) that never contains mise/asdf shims or ~/.local/bin.
 */
function extraBinDirs(): string[] {
  const home = process.env['HOME'] ?? homedir();
  return [
    process.env['MISE_SHIMS'],
    join(home, '.local/share/mise/shims'),
    join(home, '.asdf/shims'),
    join(home, '.local/bin'),
    '/usr/local/bin',
    '/usr/bin',
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
}

/** Locate a binary on PATH. Returns the resolved path or null. */
export async function which(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await pExecFile('which', [cmd], { timeout: 5000 });
    const p = stdout.trim().split('\n')[0];
    if (p) return p;
  } catch { /* fall through to the dir scan */ }
  return whichSync(cmd);
}

/** Sync variant for spawn sites: PATH dirs first, then the per-user toolchain fallbacks. Null when not found. */
export function whichSync(cmd: string): string | null {
  if (cmd.includes('/')) return null;
  const dirs = [...(process.env['PATH'] ?? '').split(delimiter).filter(Boolean), ...extraBinDirs()];
  for (const dir of dirs) {
    const p = join(dir, cmd);
    try { accessSync(p, constants.X_OK); return p; } catch { /* keep scanning */ }
  }
  return null;
}

/** `detect()` for a CLI that answers `--version`. */
export async function detectBinary(cmd: string, versionArgs: string[] = ['--version']): Promise<RuntimeDetection> {
  const path = await which(cmd);
  if (!path) return { status: 'missing_binary', notes: `${cmd} not found on PATH` };
  try {
    const { stdout, stderr } = await pExecFile(path, versionArgs, { timeout: 20000 });
    const raw = (stdout || stderr).trim();
    const version = /(\d+\.\d+\.\d+[\w.-]*)/.exec(raw)?.[1] ?? raw.split('\n')[0] ?? undefined;
    return { status: 'available', path, ...(version ? { version } : {}) };
  } catch (e) {
    return { status: 'broken', path, notes: (e as Error).message.slice(0, 300) };
  }
}

/** Per-run scratch directory: os.tmpdir()/agent-conductor-<runId>. Pure path computation. */
export function runTmpDir(runId: string): string {
  return join(tmpdir(), `agent-conductor-${runId.replace(/[^\w.-]/g, '_')}`);
}

/** What a per-CLI pure `buildArgs(input)` returns. */
export interface BuiltCommand {
  cmd: string;
  args: string[];
  /** Prompt (or other payload) to write to the child's stdin, or null when passed in argv. */
  stdin: string | null;
  /** Env overlay merged on top of process.env by the adapter. */
  env: Record<string, string>;
  /** Files that must exist before spawning (mcp config, output schema, system prompt, per-cwd config). */
  files: Array<{ path: string; content: string }>;
  /** Files the CLI writes that the adapter reads back after the turn. */
  readBack?: Record<string, string>;
}

/** Materialize the files a built command needs (mcp config, schemas, prompts). */
export function writeFiles(files: ReadonlyArray<{ path: string; content: string }>): void {
  for (const f of files) {
    mkdirSync(resolve(f.path, '..'), { recursive: true });
    writeFileSync(f.path, f.content, { mode: 0o600 });
  }
}

/**
 * Write instruction files at the home root and copy each skill directory into `skillsDir`.
 * `instructions` maps a filename at the home root to its content.
 */
export function installBundleFiles(home: AgentHome, bundle: InstructionBundle, opts: { instructions: Record<string, string>; skillsDir: string; extraFiles?: Record<string, string> }): void {
  mkdirSync(home.path, { recursive: true });
  for (const [name, content] of Object.entries(opts.instructions)) writeFileSync(join(home.path, name), content, 'utf8');
  for (const [rel, content] of Object.entries(opts.extraFiles ?? {})) {
    const dest = join(home.path, rel);
    mkdirSync(resolve(dest, '..'), { recursive: true });
    writeFileSync(dest, content, 'utf8');
  }
  if (bundle.skills.length === 0) return;
  const skillsRoot = join(home.path, opts.skillsDir);
  mkdirSync(skillsRoot, { recursive: true });
  for (const s of bundle.skills) cpSync(s.dir, join(skillsRoot, s.name), { recursive: true, dereference: true });
}

/** Bound a payload string (events carry redacted, size-limited text). */
export function truncate(s: string, max = 8192): string {
  return s.length <= max ? s : `${s.slice(0, max)}…[+${s.length - max} chars]`;
}
