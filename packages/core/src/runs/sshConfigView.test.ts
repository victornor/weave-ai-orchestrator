import { spawnSync } from 'node:child_process';
import { accessSync, chmodSync, constants, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { materializeSshConfigView, resolveSshBinary, sshChildHome, sshShimArgv, sshViewPath } from './sshConfigView.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ssh-view-'));
  dirs.push(dir);
  return dir;
}

function fixture(): { root: string; runDir: string; home: string } {
  const base = temp();
  const root = join(base, 'sys');
  const drop = join(root, 'ssh_config.d');
  mkdirSync(drop, { recursive: true });
  writeFileSync(join(root, 'ssh_config'), 'Include /etc/ssh/ssh_config.d/*.conf\nHost *\n  ServerAliveInterval 9\n', { mode: 0o644 });
  writeFileSync(join(drop, 'kept.conf'), 'Host *\n  TCPKeepAlive yes\n', { mode: 0o644 });
  const outside = join(base, 'outside.conf');
  writeFileSync(outside, 'Host *\n  ServerAliveCountMax 3\n', { mode: 0o644 });
  symlinkSync(outside, join(drop, 'linked.conf'));
  writeFileSync(join(drop, 'secret.conf'), 'nope\n', { mode: 0o600 });
  chmodSync(join(drop, 'secret.conf'), 0o000);
  const home = join(base, 'home');
  mkdirSync(join(home, '.ssh'), { recursive: true });
  writeFileSync(join(home, '.ssh', 'config'), 'Host localhost\n  User from-user-config\n', { mode: 0o644 });
  return { root, runDir: join(base, 'run'), home };
}

describe('materializeSshConfigView', () => {
  it('dereferences a symlink drop-in, rewrites Include off /etc/ssh, and puts the child config first', () => {
    const { root, runDir, home } = fixture();
    const view = materializeSshConfigView({ runDir, childHome: home, systemConfigRoot: root, sshBinary: '/usr/bin/ssh' });
    expect(view).not.toBeNull();
    const text = readFileSync(view!.configFile, 'utf8');
    expect(text.startsWith(`Include ${join(home, '.ssh', 'config')}\n`)).toBe(true);
    expect(text).not.toContain('from-user-config');
    expect(text).not.toContain('/etc/ssh');
    const linked = join(view!.configFile, '..', 'ssh_config.d', 'linked.conf');
    expect(lstatSync(linked).isSymbolicLink()).toBe(false);
    expect(lstatSync(linked).uid).toBe(process.getuid?.());
    expect(readFileSync(linked, 'utf8')).toContain('ServerAliveCountMax');
    expect(lstatSync(linked).mode & 0o022).toBe(0);
    expect(() => lstatSync(join(view!.configFile, '..', 'ssh_config.d', 'secret.conf'))).toThrow();
  });

  it('a user Host block does not swallow a system drop-in', () => {
    const base = temp();
    const root = join(base, 'sys');
    const drop = join(root, 'ssh_config.d');
    mkdirSync(drop, { recursive: true });
    writeFileSync(join(root, 'ssh_config'), 'Include /etc/ssh/ssh_config.d/*.conf\n', { mode: 0o644 });
    writeFileSync(join(drop, 'keepalive.conf'), 'Host *\n  ServerAliveInterval 15\n', { mode: 0o644 });
    const home = join(base, 'home');
    mkdirSync(join(home, '.ssh'), { recursive: true });
    writeFileSync(join(home, '.ssh', 'config'), 'Host s1\n  User root\n', { mode: 0o644 });
    const view = materializeSshConfigView({ runDir: join(base, 'run'), childHome: home, systemConfigRoot: root, sshBinary: '/usr/bin/ssh' });
    expect(view).not.toBeNull();
    expect(readFileSync(view!.configFile, 'utf8')).not.toContain('Host s1');
    const ssh = existsSync('/usr/bin/ssh') ? '/usr/bin/ssh' : null;
    if (!ssh) return;
    const dumped = spawnSync(ssh, ['-F', view!.configFile, '-G', 'someotherhost'], { encoding: 'utf8' });
    expect(dumped.status).toBe(0);
    expect(dumped.stdout).toMatch(/^serveraliveinterval 15$/m);
    expect(dumped.stdout).not.toMatch(/^user root$/m);
    const scoped = spawnSync(ssh, ['-F', view!.configFile, '-G', 's1'], { encoding: 'utf8' });
    expect(scoped.stdout).toMatch(/^user root$/m);
  });

  it('returns null when the system config cannot be read', () => {
    const base = temp();
    expect(materializeSshConfigView({
      runDir: join(base, 'run'), childHome: undefined, systemConfigRoot: join(base, 'missing'), sshBinary: '/usr/bin/ssh',
    })).toBeNull();
  });
});

describe('sshShimArgv', () => {
  it('adds one -F, and leaves a caller-supplied -F alone', () => {
    expect(sshShimArgv('/usr/bin/ssh', '/view/ssh_config', ['-G', 'localhost'])).toEqual(['/usr/bin/ssh', '-F', '/view/ssh_config', '-G', 'localhost']);
    expect(sshShimArgv('/usr/bin/ssh', '/view/ssh_config', ['-F', '/other', '-G', 'localhost'])).toEqual(['/usr/bin/ssh', '-F', '/other', '-G', 'localhost']);
    expect(sshShimArgv('/usr/bin/ssh', '/view/ssh_config', ['-F/other', '-G', 'localhost'])).toEqual(['/usr/bin/ssh', '-F/other', '-G', 'localhost']);
    expect(sshShimArgv('/usr/bin/ssh', '/view/ssh_config', ['-G', 'localhost'])[0]).toBe('/usr/bin/ssh');
    expect(sshShimArgv('/usr/bin/ssh', '/view/ssh_config', ['-G', 'localhost']).join(' ')).not.toContain('bwrap');
    expect(sshShimArgv('/usr/bin/ssh', '/view/ssh_config', ['-G', 'localhost']).join(' ')).not.toContain('unshare');
  });
});

describe('sshViewPath', () => {
  it('is null off Linux, when ssh is missing, and when the config cannot be read', () => {
    const { root, runDir, home } = fixture();
    const base = { systemConfigRoot: root, sshBinary: '/usr/bin/ssh', childHome: home, runDir, existingPath: '/usr/bin' };
    expect(sshViewPath({ ...base, platform: 'darwin' })).toBeNull();
    expect(sshViewPath({ ...base, platform: 'linux', sshBinary: null })).toBeNull();
    expect(sshViewPath({ ...base, platform: 'linux', systemConfigRoot: join(runDir, 'nope') })).toBeNull();
    const path = sshViewPath({ ...base, platform: 'linux' });
    expect(path!.startsWith(join(runDir, 'ssh-view', 'bin'))).toBe(true);
    expect(path).toBe(`${join(runDir, 'ssh-view', 'bin')}${delimiter}/usr/bin`);
  });
});

describe('sshChildHome', () => {
  it('uses the runtime config home for opencode and the daemon home otherwise', () => {
    expect(sshChildHome('opencode', '/rt/opencode', '/home/user')).toBe('/rt/opencode');
    expect(sshChildHome('codex', '/rt/codex', '/home/user')).toBe('/home/user');
  });
});

describe('ssh inside a user namespace', () => {
  const live = existsSync('/usr/bin/bwrap') && existsSync('/usr/bin/ssh') && existsSync('/etc/ssh/ssh_config');

  it.skipIf(!live)('the shim makes ssh -G exit 0 where /etc/ssh looks unmapped', () => {
    const runDir = temp();
    const view = materializeSshConfigView({
      runDir, childHome: undefined, systemConfigRoot: '/etc/ssh', sshBinary: '/usr/bin/ssh',
    });
    expect(view).not.toBeNull();
    const result = spawnSync('bwrap', [
      '--unshare-user', '--die-with-parent', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--cap-drop', 'ALL', '--',
      'env', `PATH=${view!.binDir}${delimiter}/usr/bin`, 'ssh', '-G', 'localhost',
    ], { encoding: 'utf8' });
    expect(result.stderr ?? '').not.toContain('Bad owner or permissions');
    expect(result.status).toBe(0);
    accessSync(view!.shimPath, constants.X_OK);
  });
});

describe('resolveSshBinary', () => {
  it('returns an executable on PATH and null when ssh is absent', () => {
    const dir = temp();
    writeFileSync(join(dir, 'ssh'), '#!/bin/sh\n', { mode: 0o755 });
    expect(resolveSshBinary(dir)).toBe(join(dir, 'ssh'));
    expect(resolveSshBinary(join(dir, 'empty'))).toBeNull();
  });
});
