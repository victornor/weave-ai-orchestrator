/**
 * VS-704: a per-turn `ssh` that OpenSSH will accept inside a user-namespace sandbox.
 *
 * Codex hardcodes `bwrap --unshare-user`, which maps only the worker uid, so root-owned
 * `/etc/ssh` appears as the overflow uid and OpenSSH refuses it. The turn itself is not
 * entered into a user namespace (that would drop unmapped groups). A shim earlier on PATH
 * execs the real binary with `-F` a user-owned copy of the client system config.
 */
import { accessSync, chmodSync, constants, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';

/** The host path OpenSSH reads. A test fixture may use another root; this prefix is still rewritten. */
const HOST_SSH_ROOT = '/etc/ssh';

export interface SshViewDeps {
  platform: NodeJS.Platform;
  systemConfigRoot: string;
  /** Absolute `ssh`, resolved before the shim is prepended. Null when it is not on PATH. */
  sshBinary: string | null;
  /** HOME the child will use. User config is read only from here. */
  childHome: string | undefined;
}

export interface SshView {
  binDir: string;
  configFile: string;
  shimPath: string;
}

/** OpenCode relocates HOME to its runtime config home; every other adapter inherits the daemon's. */
export function sshChildHome(runtime: string, configHome: string, daemonHome: string | undefined): string | undefined {
  return runtime === 'opencode' ? configHome : daemonHome;
}

/** Resolve `ssh` on PATH. Does not search the shim dir (it does not exist yet). */
export function resolveSshBinary(pathEnv: string | undefined): string | null {
  for (const dir of (pathEnv ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'ssh');
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* next */
    }
  }
  return null;
}

/**
 * The argv the shim execs. A caller-supplied `-F` or `-Ffile` is left alone so OpenSSH's own
 * file is used. Otherwise one `-F` of the user-owned view is inserted. Never a user-namespace wrapper.
 */
export function sshShimArgv(realSsh: string, configFile: string, argv: string[]): string[] {
  if (argv.some((arg) => arg === '-F' || (arg.startsWith('-F') && arg.length > 2))) return [realSsh, ...argv];
  return [realSsh, '-F', configFile, ...argv];
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The shim script. Exec only; the real binary is an absolute path so the PATH prepend cannot recurse. */
export function sshShimScript(realSsh: string, configFile: string): string {
  const real = shQuote(realSsh);
  const config = shQuote(configFile);
  return `#!/bin/sh
real=${real}
config=${config}
for arg in "$@"; do
  case "$arg" in
    -F|-F*) exec "$real" "$@" ;;
  esac
done
exec "$real" -F "$config" "$@"
`;
}

function ownerMode(mode: number): number {
  return (mode & 0o777 & ~0o022) | 0o400;
}

/** Follow symlinks to a regular file. Unreadable, dangling, or non-file paths are skipped. */
function readRegular(path: string): { bytes: Buffer; mode: number } | null {
  const seen = new Set<string>();
  let current = path;
  try {
    let st = lstatSync(current);
    while (st.isSymbolicLink()) {
      if (seen.has(current)) return null;
      seen.add(current);
      current = resolve(dirname(current), readlinkSync(current));
      st = lstatSync(current);
    }
    if (!st.isFile()) return null;
    return { bytes: readFileSync(current), mode: ownerMode(st.mode) };
  } catch {
    return null;
  }
}

function includeTokens(rest: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(rest))) out.push(match[1] ?? match[2] ?? match[3]!);
  return out;
}

/** Map an Include token onto the source tree. `/etc/ssh` is accepted even when the source root is a fixture. */
function sourceToken(token: string, systemConfigRoot: string): string | null {
  if (token === systemConfigRoot || token.startsWith(`${systemConfigRoot}/`)) return token;
  if (token === HOST_SSH_ROOT || token.startsWith(`${HOST_SSH_ROOT}/`)) return systemConfigRoot + token.slice(HOST_SSH_ROOT.length);
  return null;
}

function viewToken(token: string, systemConfigRoot: string, viewRoot: string): string | null {
  const source = sourceToken(token, systemConfigRoot);
  if (!source) return null;
  return viewRoot + source.slice(systemConfigRoot.length);
}

function expand(pattern: string): string[] {
  if (!/[*?\[]/.test(pattern)) return [pattern];
  const slash = pattern.lastIndexOf('/');
  if (slash < 0) return [];
  const dir = pattern.slice(0, slash);
  const base = pattern.slice(slash + 1);
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  const re = new RegExp(`^${base.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
  return names.filter((name) => re.test(name)).map((name) => join(dir, name));
}

function writeOwned(path: string, bytes: Buffer, mode: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes, { mode });
  chmodSync(path, mode);
}

/** Copy one Include token into the view and return the path the config should name. Unreadable matches are skipped. */
function copyInclude(token: string, systemConfigRoot: string, viewRoot: string): string {
  const viewed = viewToken(token, systemConfigRoot, viewRoot);
  const source = sourceToken(token, systemConfigRoot);
  if (!viewed || !source) return token;
  const glob = /[*?\[]/.test(source);
  for (const match of expand(source)) {
    const file = readRegular(match);
    if (!file) continue;
    const dest = glob ? join(dirname(viewed), match.slice(match.lastIndexOf('/') + 1)) : viewed;
    writeOwned(dest, file.bytes, file.mode);
  }
  return viewed;
}

/**
 * Write the view under `runDir` and return it. Null when the system client config cannot be read —
 * the caller still starts the turn. Symlinks are replaced by the regular file they point at.
 */
export function materializeSshConfigView(opts: {
  runDir: string;
  childHome: string | undefined;
  systemConfigRoot: string;
  sshBinary: string;
}): SshView | null {
  const system = readRegular(join(opts.systemConfigRoot, 'ssh_config'));
  if (!system) return null;

  const viewRoot = join(opts.runDir, 'ssh-view');
  const configFile = join(viewRoot, 'ssh_config');
  const binDir = join(viewRoot, 'bin');
  const shimPath = join(binDir, 'ssh');

  const rewritten = system.bytes.toString('utf8').split('\n').map((line) => {
    if (/^\s*#/.test(line) || !/^\s*include\s+/i.test(line)) return line;
    const head = /^(\s*include\s+)(.*)$/i.exec(line);
    if (!head) return line;
    const next = includeTokens(head[2] ?? '').map((token) => copyInclude(token, opts.systemConfigRoot, viewRoot));
    return `${head[1]}${next.join(' ')}`;
  }).join('\n');

  let body = rewritten.endsWith('\n') ? rewritten : `${rewritten}\n`;
  // Include, do not paste. A pasted user file that ends inside `Host s1` would keep that block open
  // and scope the system config to s1 only. Include of a separate file does not.
  const userConfig = opts.childHome ? join(opts.childHome, '.ssh', 'config') : '~/.ssh/config';
  body = `Include ${userConfig}\n${body}`;

  writeOwned(configFile, Buffer.from(body, 'utf8'), 0o644);
  writeOwned(shimPath, Buffer.from(sshShimScript(opts.sshBinary, configFile), 'utf8'), 0o755);
  return { binDir, configFile, shimPath };
}

/**
 * PATH for the turn, or null when no view is installed. A failure to write the view does not throw.
 */
export function sshViewPath(opts: SshViewDeps & { runDir: string; existingPath: string | undefined }): string | null {
  if (opts.platform !== 'linux') return null;
  if (!opts.sshBinary) return null;
  try {
    const view = materializeSshConfigView({
      runDir: opts.runDir,
      childHome: opts.childHome,
      systemConfigRoot: opts.systemConfigRoot,
      sshBinary: opts.sshBinary,
    });
    if (!view) return null;
    return opts.existingPath ? `${view.binDir}${delimiter}${opts.existingPath}` : view.binDir;
  } catch {
    return null;
  }
}

/** Test-only override. Production leaves this null and reads the host. */
let depsForTest: { platform?: NodeJS.Platform; systemConfigRoot?: string; sshBinary?: string | null } | null = null;

export function setSshViewDepsForTest(deps: typeof depsForTest): void {
  depsForTest = deps;
}

/** What `executeRun` installs. Null leaves the turn's PATH unchanged. */
export function turnSshPath(opts: { runtime: string; configHome: string; runDir: string }): string | null {
  const sshBinary = depsForTest && 'sshBinary' in depsForTest ? depsForTest.sshBinary ?? null : resolveSshBinary(process.env.PATH);
  return sshViewPath({
    platform: depsForTest?.platform ?? process.platform,
    systemConfigRoot: depsForTest?.systemConfigRoot ?? HOST_SSH_ROOT,
    sshBinary,
    childHome: sshChildHome(opts.runtime, opts.configHome, process.env.HOME),
    runDir: opts.runDir,
    existingPath: process.env.PATH,
  });
}
