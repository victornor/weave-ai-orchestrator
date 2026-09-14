/**
 * The user-facing `weave` CLI shim (VS-377): `<home>/.local/bin/weave` runs the `current` release's
 * `packages/cli/dist/bin.js`. `weave daemon install-service` and every upgrade path write it, so a host
 * installed before the `agent-conductor` → `weave-ai` rename gets a `weave` command on its next upgrade
 * even though the original installer only ever wrote `conductor`. An existing `conductor` shim is
 * rewritten to the same target and prints a one-line deprecation notice; a fresh install creates none.
 *
 * Pure with respect to where it points: every function takes the home / data-home directory it acts on,
 * so it is testable against a temp directory and never has to be told about the live host. Still a leaf
 * package: node builtins only.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The marker every Weave CLI shim carries, old or new — `isWeaveShim` reads it. */
const CLI_BIN_SUFFIX = join('packages', 'cli', 'dist', 'bin.js');
/** The line a deprecated `conductor` shim prints before it execs the CLI. */
export const CONDUCTOR_DEPRECATION = 'conductor is now weave; this alias will be removed later';

/** `~/.local/bin` (the platform's user bin dir on this host) under the given home. */
export function userBinDir(home: string): string {
  return join(home, '.local', 'bin');
}

/** The CLI bin a shim should run: the `current` release's, addressed through the symlink so it follows an upgrade. */
export function cliShimTarget(dataHomeDir: string): string {
  return join(dataHomeDir, 'current', CLI_BIN_SUFFIX);
}

/** True when `content` is a Weave CLI shim (old `conductor` or new `weave`), not some unrelated program. */
export function isWeaveShim(content: string): boolean {
  return content.includes(CLI_BIN_SUFFIX);
}

/** The CLI bin a shim's `exec` line names, or null when it does not parse as one. */
export function readCliShimTarget(content: string): string | null {
  const m = /^exec\s+"([^"]*)"\s+"([^"]*)"\s+"\$@"/m.exec(content);
  return m?.[2] ?? null;
}

export interface RenderShimOptions {
  target: string;
  node: string;
  /** A `conductor` alias prints the deprecation notice to stderr before execing. */
  deprecated: boolean;
}

/** The exact bytes of a shim. `node` and `target` are absolute; the deprecation notice has no shell metacharacters. */
export function renderCliShim(o: RenderShimOptions): string {
  const lines = [
    '#!/bin/sh',
    '# Weave AI CLI from the current release; upgrade with weave daemon upgrade.',
  ];
  if (o.deprecated) lines.push(`echo "${CONDUCTOR_DEPRECATION}" >&2`);
  lines.push(`exec "${o.node}" "${o.target}" "$@"`);
  return `${lines.join('\n')}\n`;
}

export interface WriteShimsOptions {
  home: string;
  dataHomeDir: string;
  /** The node the daemon runs, so the shim follows the same one. */
  node: string;
}

export interface ShimWriteResult {
  /** Where the `weave` shim lives, whether or not it could be written. */
  path: string;
  /** True when a `weave` shim naming the current release is now in place. */
  present: boolean;
  /** True when this call actually changed the `weave` shim. */
  changed: boolean;
  /** The `conductor` alias rewritten by this call, or null when there was none. */
  alias: string | null;
  /** `no-release` when there is no current release to point at (a source checkout): nothing is written. */
  reason: 'no-release' | null;
}

/**
 * Write (or refresh) `weave` and rewrite an existing `conductor` alias. Idempotent: the `weave` file's
 * bytes are compared first, so a correct shim is left alone. When the current release's CLI bin does
 * not exist there is nothing to point at — a source checkout, where a broken shim would shadow a
 * linked CLI — and nothing is written.
 */
export function writeCliShims(o: WriteShimsOptions): ShimWriteResult {
  const binDir = userBinDir(o.home);
  const weavePath = join(binDir, 'weave');
  const target = cliShimTarget(o.dataHomeDir);
  if (!existsSync(target)) {
    return { path: weavePath, present: false, changed: false, alias: null, reason: 'no-release' };
  }

  const changed = writeShim(weavePath, renderCliShim({ target, node: o.node, deprecated: false }));

  // The alias is rewritten only where one already exists and is ours; a fresh install never creates it.
  const conductorPath = join(binDir, 'conductor');
  let alias: string | null = null;
  if (existsSync(conductorPath) && isWeaveShim(readFileSync(conductorPath, 'utf8'))) {
    writeShim(conductorPath, renderCliShim({ target, node: o.node, deprecated: true }));
    alias = conductorPath;
  }
  return { path: weavePath, present: true, changed, alias, reason: null };
}

/** Write `content` at `path`, executable, only when its bytes differ. Returns whether it changed. */
function writeShim(path: string, content: string): boolean {
  mkdirSync(dirname(path), { recursive: true });
  let current: string | null = null;
  try { current = readFileSync(path, 'utf8'); } catch { /* absent */ }
  const changed = current !== content;
  if (changed) writeFileSync(path, content, { mode: 0o755 });
  try { chmodSync(path, 0o755); } catch { /* best-effort: an existing file may not be ours to chmod */ }
  return changed;
}
