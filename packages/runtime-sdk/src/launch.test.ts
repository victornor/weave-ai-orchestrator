import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { childEnv, fallbackBinDirs, launchCommand } from './launch.js';

let home: string;

/** An executable stub at `<dir>/<name>`, so resolution has something real to find. */
function bin(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, '#!/bin/sh\nexit 0\n');
  chmodSync(path, 0o755);
  return path;
}

beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'ac-launch-')); });
afterEach(() => { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }); });

describe('childEnv', () => {
  it('gives the child the daemon\'s own environment with the overlay on top', () => {
    vi.stubEnv('AC_LAUNCH_FIXTURE', 'from-the-daemon');
    const env = childEnv({ CLAUDE_CONFIG_DIR: '/runtimes/claude', AC_LAUNCH_FIXTURE: 'from-the-overlay' });
    expect(env['PATH']).toBe(process.env['PATH']);
    expect(env['CLAUDE_CONFIG_DIR']).toBe('/runtimes/claude');
    expect(env['AC_LAUNCH_FIXTURE']).toBe('from-the-overlay');
  });
});

describe('launchCommand', () => {
  it('resolves a command on PATH to its absolute path', () => {
    const dir = join(home, 'onpath');
    const path = bin(dir, 'faux-cli');
    vi.stubEnv('PATH', dir);
    expect(launchCommand('faux-cli')).toMatchObject({ cmd: path, source: 'path' });
  });

  it('finds the CLI where its installer put it when PATH does not carry it', () => {
    // The daemon runs under a systemd user unit, whose PATH is not the interactive shell's.
    const path = bin(join(home, '.local', 'share', 'mise', 'shims'), 'claude');
    vi.stubEnv('PATH', '');
    vi.stubEnv('HOME', home);
    expect(launchCommand('claude')).toMatchObject({ cmd: path, source: 'fallback' });
  });

  it('prefers PATH over the installer directories', () => {
    const onPath = join(home, 'onpath');
    const first = bin(onPath, 'claude');
    bin(join(home, '.local', 'bin'), 'claude');
    vi.stubEnv('PATH', onPath);
    vi.stubEnv('HOME', home);
    expect(launchCommand('claude').cmd).toBe(first);
  });

  it('leaves a command that already carries a path alone', () => {
    expect(launchCommand('/usr/bin/env')).toMatchObject({ cmd: '/usr/bin/env', source: 'given' });
    expect(launchCommand('./claude').cmd).toBe('./claude');
  });

  it('returns the command unchanged when it is nowhere, so the spawn reports the runtime\'s own error', () => {
    vi.stubEnv('PATH', '');
    vi.stubEnv('HOME', home);
    const launch = launchCommand('ac-no-such-binary-9f2a');
    expect(launch).toMatchObject({ cmd: 'ac-no-such-binary-9f2a', source: 'unresolved' });
    expect(launch.searched.split(delimiter)).toEqual(fallbackBinDirs(home));
  });

  it('ignores a directory entry that is not an executable file', () => {
    const dir = join(home, 'onpath');
    mkdirSync(join(dir, 'ac-faux-cli-7c1d'), { recursive: true });
    vi.stubEnv('PATH', dir);
    vi.stubEnv('HOME', home);
    expect(launchCommand('ac-faux-cli-7c1d').source).toBe('unresolved');
  });
});
