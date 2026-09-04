/**
 * Release directories for `conductor daemon upgrade|releases|rollback` (PLAN §20).
 *
 * The daemon never runs from a checkout that anyone edits. Each upgrade clones the source at a ref
 * into `<data>/agent-conductor/releases/<stamp>-<sha>/`, builds it there, backs the databases up,
 * drains the running daemon, switches the `current` symlink and restarts the service. `previous`
 * always points at the release before that, so `rollback` is a symlink swap plus a restart.
 * Host-local, never remote: everything here runs on the daemon host.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export function dataHome(): string {
  const xdg = process.env['XDG_DATA_HOME'];
  return xdg && xdg.trim() !== '' ? join(xdg, 'agent-conductor') : join(homedir(), '.local', 'share', 'agent-conductor');
}
export function releasesDir(): string { return join(dataHome(), 'releases'); }
export function currentLink(): string { return join(dataHome(), 'current'); }
export function previousLink(): string { return join(dataHome(), 'previous'); }

export function readLink(path: string): string | null {
  try { return lstatSync(path).isSymbolicLink() ? resolve(dirname(path), readlinkSync(path)) : null; } catch { return null; }
}

export interface ReleaseInfo { name: string; path: string; sha: string; current: boolean; previous: boolean; builtAt: string }

export function listReleases(): ReleaseInfo[] {
  const cur = readLink(currentLink());
  const prev = readLink(previousLink());
  let names: string[] = [];
  try { names = readdirSync(releasesDir()).filter((n) => !n.startsWith('.')).sort(); } catch { return []; }
  return names.map((name) => {
    const path = join(releasesDir(), name);
    const m = name.match(/^(\d{8}-\d{6})-([0-9a-f]{7,40})$/);
    const stamp = m?.[1] ?? '';
    const builtAt = stamp ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)} ${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}` : '';
    return { name, path, sha: m?.[2] ?? '', current: path === cur, previous: path === prev, builtAt };
  });
}

function run(cmd: string, args: string[], cwd: string, log: (line: string) => void): void {
  log(`$ ${[cmd, ...args].join(' ')}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, CI: '1', NO_COLOR: '1' } });
  if (r.error) throw new Error(`${cmd} failed to start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args[0] ?? ''} exited ${String(r.status ?? r.signal)}`);
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function onPath(bin: string): boolean {
  try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

/**
 * How to run pnpm inside the release: `mise exec` when the release pins toolchains in `mise.toml`
 * and mise is installed (services and non-login shells rarely have the shims on PATH), else pnpm
 * from PATH, else corepack's.
 */
function pnpm(release: string): string[] {
  if (existsSync(join(release, 'mise.toml')) && onPath('mise')) return ['mise', 'exec', '--', 'pnpm'];
  if (onPath('pnpm')) return ['pnpm'];
  if (onPath('corepack')) return ['corepack', 'pnpm'];
  throw new Error('no pnpm: install mise (the release pins node and pnpm in mise.toml) or pnpm itself');
}

export interface BuildOptions { from: string; ref: string; test?: boolean; log: (line: string) => void }

/** Clone, check out, install, build (and optionally test) into a fresh release directory. Returns its path. */
export function buildRelease(o: BuildOptions): { path: string; sha: string } {
  mkdirSync(releasesDir(), { recursive: true });
  const work = join(releasesDir(), `.building-${stamp()}`);
  rmSync(work, { recursive: true, force: true });
  const from = existsSync(o.from) ? resolve(o.from) : o.from;
  try {
    run('git', ['clone', '-q', '--no-checkout', from, work], releasesDir(), o.log);
    run('git', ['-C', work, 'checkout', '-q', o.ref], releasesDir(), o.log);
    const sha = execFileSync('git', ['-C', work, 'rev-parse', '--short=10', 'HEAD'], { encoding: 'utf8' }).trim();
    const [pm, ...pmArgs] = pnpm(work);
    run(pm!, [...pmArgs, 'install', '--frozen-lockfile'], work, o.log);
    run(pm!, [...pmArgs, 'build'], work, o.log);
    if (o.test) run(pm!, [...pmArgs, 'test'], work, o.log);
    const final = join(releasesDir(), `${stamp()}-${sha}`);
    renameSync(work, final);
    return { path: final, sha };
  } catch (err) {
    rmSync(work, { recursive: true, force: true });
    throw err;
  }
}

function setLink(link: string, target: string): void {
  const tmp = `${link}.tmp-${process.pid}`;
  try { unlinkSync(tmp); } catch { /* none */ }
  symlinkSync(target, tmp);
  renameSync(tmp, link);
}

/** Point `current` at `path` (and `previous` at what `current` was). */
export function switchRelease(path: string): { previous: string | null } {
  mkdirSync(dataHome(), { recursive: true });
  const before = readLink(currentLink());
  if (before && before !== path) setLink(previousLink(), before);
  setLink(currentLink(), path);
  return { previous: before };
}

/** Delete releases beyond the newest `keep`, never `current` or `previous`. */
export function pruneReleases(keep: number): string[] {
  const all = listReleases().filter((r) => !r.current && !r.previous).sort((a, b) => b.name.localeCompare(a.name));
  const doomed = all.slice(Math.max(0, keep - 1));
  for (const r of doomed) rmSync(r.path, { recursive: true, force: true });
  return doomed.map((r) => basename(r.path));
}

export function serverBinIn(release: string): string { return join(release, 'packages', 'server', 'dist', 'bin.js'); }
export function cliBinIn(release: string): string { return join(release, 'packages', 'cli', 'dist', 'bin.js'); }
