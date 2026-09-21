import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { containCommand, containmentPrefix, containmentStartFailure, containmentWrapperEnv, parseScopeMemoryPeak, readScopeMemoryPeak, scopeShowArgs, scopeStopArgs, scopeUnitName, systemdScopeAvailable, TEST_GUARD_ENV } from './containment.js';

const fixture = (name: string): string =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name), 'utf8').trim();

describe('worker memory containment', () => {
  it('is available only on Linux with both systemd-run and a user manager', () => {
    expect(systemdScopeAvailable({ platform: 'linux', hasSystemdRun: true, hasUserManager: true })).toBe(true);
    expect(systemdScopeAvailable({ platform: 'darwin', hasSystemdRun: true, hasUserManager: true })).toBe(false);
    expect(systemdScopeAvailable({ platform: 'linux', hasSystemdRun: false, hasUserManager: true })).toBe(false);
    expect(systemdScopeAvailable({ platform: 'linux', hasSystemdRun: true, hasUserManager: false })).toBe(false);
  });

  it('names the scope after the run and slices it with the daemon', () => {
    expect(scopeUnitName('abc')).toBe('ac-run-abc.scope');
    const prefix = containmentPrefix({ runId: 'abc', memoryMb: 2048 });
    expect(prefix.cmd).toBe('systemd-run');
    expect(prefix.args).toContain('--user');
    expect(prefix.args).toContain('--scope');
    expect(prefix.args).toContain('--slice=app.slice');
    expect(prefix.args).toContain('--unit=ac-run-abc.scope');
  });

  it('carries the throttle, hard limit, swap and oomd settings', () => {
    const args = containmentPrefix({ runId: 'r', memoryMb: 2048 }).args.join(' ');
    expect(args).toContain('MemoryHigh=2048M');
    expect(args).toContain('MemoryMax=2048M');
    expect(args).toContain('MemorySwapMax=0');
    expect(args).toContain('OOMPolicy=kill');
    expect(args).toContain('ManagedOOMMemoryPressure=kill');
  });

  it('wraps the command after the scope options', () => {
    const wrapped = containCommand('/usr/bin/node', ['bin.js'], containmentPrefix({ runId: 'r', memoryMb: 1024 }));
    expect(wrapped.cmd).toBe('systemd-run');
    expect(wrapped.args.slice(-2)).toEqual(['/usr/bin/node', 'bin.js']);
  });

  it('reads the peak memory from systemctl show output', () => {
    expect(parseScopeMemoryPeak('MemoryPeak=123\nOther=x')).toBe(123);
    expect(parseScopeMemoryPeak('Other=x')).toBeNull();
  });

  it('builds show and stop commands for a scope', () => {
    expect(scopeShowArgs('s.scope').args).toEqual(['--user', 'show', 's.scope', '-p', 'MemoryPeak']);
    expect(scopeStopArgs('s.scope').args).toEqual(['--user', 'stop', 's.scope']);
  });

  it('never reaches the service manager while the VS-388 test guard is set', async () => {
    const prev = process.env[TEST_GUARD_ENV];
    process.env[TEST_GUARD_ENV] = '1';
    try {
      expect(systemdScopeAvailable({ platform: 'linux' })).toBe(false);
      await expect(readScopeMemoryPeak('ac-run-guard-check.scope')).resolves.toBeNull();
    } finally {
      if (prev === undefined) delete process.env[TEST_GUARD_ENV];
      else process.env[TEST_GUARD_ENV] = prev;
    }
  });

  it('picks the user-bus variables a wrapper needs, and nothing else (VS-640)', () => {
    expect(containmentWrapperEnv({ XDG_RUNTIME_DIR: '/run/user/1000', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus', HOME: '/home/user' })).toEqual({
      XDG_RUNTIME_DIR: '/run/user/1000', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
    });
    expect(containmentWrapperEnv({ XDG_RUNTIME_DIR: '/run/user/1000' })).toEqual({ XDG_RUNTIME_DIR: '/run/user/1000' });
    expect(containmentWrapperEnv({ PATH: '/usr/bin' })).toEqual({});
  });

  it('recognises systemd-run\'s user-bus failure from its real stderr, and not an ordinary crash (VS-640)', () => {
    expect(containmentStartFailure(fixture('vs-639-systemd-run-user-bus.txt'))).toBe(true);
    expect(containmentStartFailure('boom: something broke')).toBe(false);
  });
});
