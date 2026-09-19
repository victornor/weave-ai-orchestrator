/**
 * VS-318: the daemon must find host tools when the service manager hands it a bare PATH, by asking
 * the daemon user's own login shell what its PATH is. Every test here uses a fake shell and fake
 * binaries in scratch directories — the real CLI is never launched and the live daemon is never
 * touched.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assembleHostPath, detectHostTool, detectHostTools, ensureHostToolPath, extractLoginPath, hostToolWarnings, loginShellPath, resolveOnPath, shellFor,
} from './host.js';

const ORIGINAL_PATH = process.env['PATH'];
const ORIGINAL_OPENSPEC = process.env['AC_OPENSPEC_BIN'];
const created: string[] = [];

function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

function fakeBin(dir: string, name: string, body = '#!/bin/sh\necho 1.12.0\n'): string {
  const p = join(dir, name);
  writeFileSync(p, body);
  chmodSync(p, 0o755);
  return p;
}

/** A fake login shell that prints the sentinel-wrapped PATH it is handed; no real shell is used. */
function fakeShellReporting(pathValue: string, name = 'login-shell.sh'): string {
  const dir = scratch('ac-vs318-shell-');
  return fakeBin(
    dir,
    name,
    "#!/bin/sh\n"
    + "printf '%s' '__weave_login_path_start__'\n"
    + `printf '%s' '${pathValue}'\n`
    + "printf '%s' '__weave_login_path_end__'\n",
  );
}

afterEach(() => {
  process.env['PATH'] = ORIGINAL_PATH;
  if (ORIGINAL_OPENSPEC === undefined) delete process.env['AC_OPENSPEC_BIN'];
  else process.env['AC_OPENSPEC_BIN'] = ORIGINAL_OPENSPEC;
  while (created.length) rmSync(created.pop()!, { recursive: true, force: true });
});

describe('assembleHostPath', () => {
  it('orders configured, then login-shell, then inherited entries, each once', () => {
    expect(assembleHostPath({ configured: ['/opt/a'], loginShell: '/opt/b:/opt/c:/opt/b', inherited: '/opt/c:/usr/bin' }))
      .toBe('/opt/a:/opt/b:/opt/c:/usr/bin');
  });

  it('drops empty entries', () => {
    expect(assembleHostPath({ configured: [], loginShell: ':/a::/b', inherited: '' })).toBe('/a:/b');
  });

  it('drops non-absolute entries from every source and reports them', () => {
    const dropped: string[] = [];
    const assembled = assembleHostPath({
      configured: ['bin', '/opt/a'],
      loginShell: '.:node_modules/.bin:/usr/bin',
      inherited: './node_modules/.bin:/bin',
      onDrop: (d) => dropped.push(d),
    });
    expect(assembled).toBe('/opt/a:/usr/bin:/bin');
    expect(dropped).toEqual(expect.arrayContaining(['bin', '.', 'node_modules/.bin', './node_modules/.bin']));
  });
});

describe('loginShellPath', () => {
  it('extracts the PATH between the sentinels, ignoring rc noise', () => {
    expect(extractLoginPath('welcome\n__weave_login_path_start__/a:/b__weave_login_path_end__\n')).toBe('/a:/b');
    expect(extractLoginPath('no sentinels here')).toBeNull();
  });

  it('falls back to the account shell, then /bin/sh, when $SHELL is unset', () => {
    expect(shellFor({ shell: null, env: {}, accountShell: '/usr/bin/fish' })).toBe('/usr/bin/fish');
    expect(shellFor({ shell: null, env: {}, accountShell: null })).toBe('/bin/sh');
  });

  it('uses the account shell when $SHELL is unset', async () => {
    const tools = scratch('ac-vs318-tools-');
    const shell = fakeShellReporting(tools);
    expect(await loginShellPath({ shell: null, env: {}, accountShell: shell })).toBe(tools);
  });

  it('returns null when the shell reports nothing, fails, or times out', async () => {
    const silent = fakeShellReporting('', 'silent.sh');
    expect(await loginShellPath({ shell: silent })).toBeNull();

    const failing = fakeBin(scratch('ac-vs318-fail-'), 'fail.sh', '#!/bin/sh\nexit 3\n');
    expect(await loginShellPath({ shell: failing })).toBeNull();

    const slowDir = scratch('ac-vs318-slow-');
    const slow = fakeBin(slowDir, 'slow.sh', '#!/bin/sh\nsleep 5\n');
    expect(await loginShellPath({ shell: slow, timeoutMs: 150 })).toBeNull();
  });
});

describe('ensureHostToolPath with a bare PATH', () => {
  const BARE = '/usr/bin:/bin';

  it('finds openspec reported by the login shell, without a real CLI', async () => {
    const tools = scratch('ac-vs318-tools-');
    const fake = fakeBin(tools, 'openspec');
    process.env['PATH'] = BARE;
    await ensureHostToolPath([], { shell: fakeShellReporting(tools), inherited: BARE });
    const tool = await detectHostTool('openspec');
    expect(tool.available).toBe(true);
    expect(tool.path).toBe(fake);
  });

  it('searches a configured directory before the login-shell entries', async () => {
    const configured = scratch('ac-vs318-cfg-');
    const loginDir = scratch('ac-vs318-login-');
    fakeBin(configured, 'openspec');
    process.env['PATH'] = BARE;
    const assembled = await ensureHostToolPath([configured], { shell: fakeShellReporting(loginDir), inherited: BARE });
    expect(assembled.indexOf(configured)).toBeLessThan(assembled.indexOf(loginDir));
  });

  it('never lets a relative login-shell entry onto the daemon PATH', async () => {
    process.env['PATH'] = BARE;
    const assembled = await ensureHostToolPath([], { shell: fakeShellReporting('/usr/local/bin:.:node_modules/.bin:/usr/bin'), inherited: BARE });
    expect(assembled).toBe('/usr/local/bin:/usr/bin:/bin');
  });

  it('lets AC_OPENSPEC_BIN win over a discovered openspec', async () => {
    const tools = scratch('ac-vs318-tools-');
    fakeBin(tools, 'openspec');
    const override = fakeBin(scratch('ac-vs318-override-'), 'openspec-override');
    process.env['AC_OPENSPEC_BIN'] = override;
    process.env['PATH'] = BARE;
    await ensureHostToolPath([], { shell: fakeShellReporting(tools), inherited: BARE });
    const tool = await detectHostTool('openspec');
    expect(tool.available).toBe(true);
    expect(tool.path).toBe(override);
  });

  it('leaves the PATH unchanged when the shell fails or reports nothing', async () => {
    process.env['PATH'] = BARE;
    const silent = fakeShellReporting('', 'silent.sh');
    expect(await ensureHostToolPath([], { shell: silent, inherited: BARE })).toBe(BARE);
    const failing = fakeBin(scratch('ac-vs318-fail-'), 'fail.sh', '#!/bin/sh\nexit 1\n');
    expect(await ensureHostToolPath([], { shell: failing, inherited: BARE })).toBe(BARE);
  });

  it('reassembles from the boot-time PATH, so a removed configured directory is gone', async () => {
    const a = scratch('ac-vs318-a-');
    const b = scratch('ac-vs318-b-');
    process.env['PATH'] = BARE;
    const silent = fakeShellReporting('', 'silent.sh');
    await ensureHostToolPath([a, b], { shell: silent, inherited: BARE });
    expect((process.env['PATH'] ?? '').split(':')).toContain(b);
    await ensureHostToolPath([a], { shell: silent, inherited: BARE });
    expect((process.env['PATH'] ?? '').split(':')).not.toContain(b);
  });
});

describe('hostToolWarnings (VS-578)', () => {
  it('omits the openspec warning when no project needs OpenSpec', async () => {
    // An empty PATH plus a bogus openspec override makes every tool unavailable in the snapshot.
    const empty = scratch('ac-vs578-empty-');
    process.env['PATH'] = empty;
    process.env['AC_OPENSPEC_BIN'] = join(empty, 'openspec');
    await detectHostTools();
    expect(hostToolWarnings(true).some((w) => w.includes('openspec'))).toBe(true);
    expect(hostToolWarnings(false).some((w) => w.includes('openspec'))).toBe(false);
    // Every other unavailable tool is still reported regardless of the flag.
    expect(hostToolWarnings(false).some((w) => w.includes('git'))).toBe(true);
  });
});

describe('resolveOnPath', () => {
  it('resolves an executable on the given PATH and returns null otherwise', () => {
    const dir = scratch('ac-vs318-resolve-');
    const fake = fakeBin(dir, 'thing');
    expect(resolveOnPath('thing', dir)).toBe(fake);
    expect(resolveOnPath('thing', '/nonexistent-a:/nonexistent-b')).toBeNull();
  });
});
