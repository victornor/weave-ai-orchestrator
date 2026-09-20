/**
 * VS-377: the `weave` CLI shim. Every test works in a temp directory pair — a home and a data home —
 * and never reads or writes the real `~/.local/bin`, the release directories or the unit.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONDUCTOR_DEPRECATION, cliShimTarget, isWeaveShim, readCliShimTarget, renderCliShim, replShimTarget, userBinDir, writeCliShims,
} from './shim.js';

const tmps: string[] = [];
afterEach(() => { while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true }); });

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmps.push(dir);
  return dir;
}

/** A home + data home with a release `current` whose CLI bin exists, so the shim has something to point at. */
function host(): { home: string; dataHomeDir: string; node: string } {
  const home = tmp('vs377-home-');
  const dataHomeDir = tmp('vs377-data-');
  mkdirSync(join(dataHomeDir, 'current', 'packages', 'cli', 'dist'), { recursive: true });
  writeFileSync(join(dataHomeDir, 'current', 'packages', 'cli', 'dist', 'bin.js'), '// cli\n');
  return { home, dataHomeDir, node: '/usr/local/bin/node' };
}

const oldConductorShim = (dataHomeDir: string): string =>
  [
    '#!/bin/sh',
    `# AgentConductor CLI from the current release (${join(dataHomeDir, 'current')}). Upgrade with conductor daemon upgrade.`,
    `exec "/usr/local/bin/node" "${join(dataHomeDir, 'current', 'packages', 'cli', 'dist', 'bin.js')}" "$@"`,
    '',
  ].join('\n');

describe('renderCliShim (VS-377)', () => {
  it('names Weave AI and the upgrade command, and execs the node and target', () => {
    const content = renderCliShim({ target: '/data/current/packages/cli/dist/bin.js', node: '/usr/bin/node', deprecated: false });
    expect(content).toContain('Weave AI CLI');
    expect(content).toContain('weave daemon upgrade');
    expect(content).toContain('exec "/usr/bin/node" "/data/current/packages/cli/dist/bin.js" "$@"');
    expect(content.startsWith('#!/bin/sh')).toBe(true);
  });

  it('tells a deprecated conductor alias to print the notice, and the notice fits in a shell string', () => {
    const content = renderCliShim({ target: '/t/cli.js', node: '/usr/bin/node', deprecated: true });
    expect(content).toContain(`echo "${CONDUCTOR_DEPRECATION}" >&2`);
    expect(CONDUCTOR_DEPRECATION).not.toMatch(/["`$\\]/);
  });

  it('round-trips its target through readCliShimTarget', () => {
    const content = renderCliShim({ target: '/data/current/packages/cli/dist/bin.js', node: '/usr/bin/node', deprecated: false });
    expect(readCliShimTarget(content)).toBe('/data/current/packages/cli/dist/bin.js');
    expect(readCliShimTarget('not a shim')).toBeNull();
    expect(isWeaveShim(content)).toBe(true);
  });
});

describe('writeCliShims (VS-377)', () => {
  it('writes an executable weave shim pointing at the current release, and is a no-op the second time', () => {
    const h = host();
    const first = writeCliShims(h);
    const weave = join(userBinDir(h.home), 'weave');
    expect(first).toMatchObject({ path: weave, present: true, changed: true, alias: null, reason: null });
    const content = readFileSync(weave, 'utf8');
    expect(readCliShimTarget(content)).toBe(cliShimTarget(h.dataHomeDir));
    expect(content).toContain(h.node);
    expect(statSync(weave).mode & 0o111).not.toBe(0);

    const second = writeCliShims(h);
    expect(second).toMatchObject({ present: true, changed: false, alias: null });
    expect(readFileSync(weave, 'utf8')).toBe(content);
  });

  it('rewrites an existing conductor shim with the deprecation notice, and never creates it fresh', () => {
    const h = host();
    const conductor = join(userBinDir(h.home), 'conductor');
    mkdirSync(userBinDir(h.home), { recursive: true });
    writeFileSync(conductor, oldConductorShim(h.dataHomeDir));

    const result = writeCliShims(h);
    expect(result.alias).toBe(conductor);
    const content = readFileSync(conductor, 'utf8');
    expect(readCliShimTarget(content)).toBe(cliShimTarget(h.dataHomeDir));
    expect(content).toContain(CONDUCTOR_DEPRECATION);

    // A fresh host (no conductor) gets only `weave`.
    const fresh = host();
    expect(writeCliShims(fresh).alias).toBeNull();
    expect(existsSync(join(userBinDir(fresh.home), 'conductor'))).toBe(false);
    expect(existsSync(join(userBinDir(fresh.home), 'weave'))).toBe(true);
  });

  it('leaves an unrelated conductor binary alone', () => {
    const h = host();
    const conductor = join(userBinDir(h.home), 'conductor');
    mkdirSync(userBinDir(h.home), { recursive: true });
    writeFileSync(conductor, '#!/bin/sh\necho "some other conductor"\n');
    const result = writeCliShims(h);
    expect(result.alias).toBeNull();
    expect(readFileSync(conductor, 'utf8')).toContain('some other conductor');
  });

  it('writes nothing when there is no current release to point at', () => {
    const home = tmp('vs377-home-');
    const dataHomeDir = tmp('vs377-data-');
    const result = writeCliShims({ home, dataHomeDir, node: '/usr/local/bin/node' });
    expect(result).toMatchObject({ present: false, changed: false, alias: null, reason: 'no-release' });
    expect(existsSync(join(userBinDir(home), 'weave'))).toBe(false);
  });
});

describe('weave-agent shim (VS-626)', () => {
  it('is written next to weave, runs the release\'s REPL entry, and is a no-op the second time', () => {
    const h = host();
    writeFileSync(join(h.dataHomeDir, 'current', 'packages', 'cli', 'dist', 'repl-bin.js'), '// repl\n');
    const first = writeCliShims(h);
    const agent = join(userBinDir(h.home), 'weave-agent');
    expect(first).toMatchObject({ agentPath: agent, agentChanged: true });
    const content = readFileSync(agent, 'utf8');
    expect(readCliShimTarget(content)).toBe(replShimTarget(h.dataHomeDir));
    expect(content).toContain(`exec "${h.node}" "${join(h.dataHomeDir, 'current', 'packages', 'cli', 'dist', 'repl-bin.js')}" "$@"`);
    expect(isWeaveShim(content)).toBe(true);
    expect(statSync(agent).mode & 0o111).not.toBe(0);
    expect(writeCliShims(h)).toMatchObject({ agentChanged: false });
  });

  it('is not written for a release built before the REPL existed, and never when there is no release', () => {
    const h = host();
    expect(writeCliShims(h)).toMatchObject({ present: true, agentChanged: false });
    expect(existsSync(join(userBinDir(h.home), 'weave-agent'))).toBe(false);
    const home = tmp('vs626-home-');
    expect(writeCliShims({ home, dataHomeDir: tmp('vs626-data-'), node: '/usr/local/bin/node' })).toMatchObject({ present: false, agentChanged: false });
  });
});
