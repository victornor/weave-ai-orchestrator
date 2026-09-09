/**
 * The one credential per runtime per host (VS-75, runtime-credentials/single-credential).
 *
 * Everything here runs against scratch directories and a fake `HOME`. No real credential is read
 * and no CLI is launched — including in the two tests that stand in for the real CLI's credential
 * write, which is deliberately unverified: the design has to be correct under either style, so both
 * are pinned here instead of one being assumed.
 */
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CredentialReader, linkRuntimeCredentials, reconcileRuntimeCredential } from './loader.js';

let home: string;
let wsHome: string;
const previousHome = process.env.HOME;

/** The claude pair: `$HOME/.claude/.credentials.json` <-> `<runtime home>/.credentials.json`. */
const hostPath = (): string => join(home, '.claude', '.credentials.json');
const wsPath = (): string => join(wsHome, '.credentials.json');

const TOKEN = 'sk-ant-oat01-fixture';

/** A credential file whose body is identifiable, carrying the expiry it asserts about itself. */
function credential(expiresAt: string | null, marker: string): string {
  return JSON.stringify({
    marker,
    claudeAiOauth: { accessToken: `${TOKEN}-${marker}`, refreshToken: `${TOKEN}-${marker}-r`, ...(expiresAt ? { expiresAt: Date.parse(expiresAt) } : {}) },
  });
}

/** The same reading the claude adapter does, without importing a runtime package into core. */
const read: CredentialReader = (configHome) => {
  try {
    const raw = readFileSync(join(configHome, '.credentials.json'), 'utf8');
    const at = (JSON.parse(raw) as { claudeAiOauth?: { expiresAt?: number } }).claudeAiOauth?.expiresAt;
    return { present: true, expiresAt: typeof at === 'number' ? new Date(at).toISOString() : null };
  } catch { return { present: false, expiresAt: null }; }
};

const writeHost = (body: string): void => { mkdirSync(dirname(hostPath()), { recursive: true }); writeFileSync(hostPath(), body); };
const writeWs = (body: string): void => { mkdirSync(wsHome, { recursive: true }); writeFileSync(wsPath(), body); };

const link = (): void => linkRuntimeCredentials('claude', wsHome, { readCredential: read });
const markerOf = (path: string): string => (JSON.parse(readFileSync(path, 'utf8')) as { marker: string }).marker;
const isLink = (path: string): boolean => lstatSync(path).isSymbolicLink();

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ac-home-'));
  wsHome = join(mkdtempSync(join(tmpdir(), 'ac-rt-')), 'claude');
  mkdirSync(wsHome, { recursive: true });
  process.env.HOME = home;
});
afterEach(() => {
  if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(dirname(wsHome), { recursive: true, force: true });
});

describe('one credential per runtime per host', () => {
  it('links the workspace path to the host credential rather than copying it', () => {
    writeHost(credential('2026-09-08T10:00:00Z', 'host'));
    link();
    expect(isLink(wsPath())).toBe(true);
    expect(readlinkSync(wsPath())).toBe(hostPath());
    // The same file, not two: an inode check is the strongest statement of "exactly one".
    expect(statSync(wsPath()).ino).toBe(statSync(hostPath()).ino);
  });

  it('lets a refresh on either side be a refresh for both', () => {
    writeHost(credential('2026-09-08T10:00:00Z', 'original'));
    link();
    // The owner's own CLI refreshes in place, the way a write through the link behaves.
    writeFileSync(hostPath(), credential('2026-09-09T10:00:00Z', 'refreshed'));
    expect(markerOf(wsPath())).toBe('refreshed');
    // And the other way round: an agent's turn writes through the link.
    writeFileSync(wsPath(), credential('2026-09-10T10:00:00Z', 'agent'));
    expect(markerOf(hostPath())).toBe('agent');
  });

  it('creates nothing when the host has no credential', () => {
    link();
    expect(() => lstatSync(wsPath())).toThrow();
  });

  it('leaves the rest of the config home alone', () => {
    writeHost(credential('2026-09-08T10:00:00Z', 'host'));
    writeFileSync(join(wsHome, 'settings.json'), '{"theme":"dark"}');
    link();
    expect(readFileSync(join(wsHome, 'settings.json'), 'utf8')).toBe('{"theme":"dark"}');
  });

  it('is idempotent', () => {
    writeHost(credential('2026-09-08T10:00:00Z', 'host'));
    link();
    const before = statSync(hostPath()).ino;
    link();
    link();
    expect(isLink(wsPath())).toBe(true);
    expect(statSync(hostPath()).ino).toBe(before);
    expect(markerOf(hostPath())).toBe('host');
  });
});

describe('reconciling a forked credential', () => {
  // The CLI writes by renaming a temp file over the path, which replaces the *symlink* rather than
  // following it. This is the branch we cannot verify against the real CLI, so it is pinned here.
  it('adopts the newer credential when the CLI replaced the link with its own file', () => {
    writeHost(credential('2026-09-08T10:00:00Z', 'host'));
    link();
    const tmp = join(wsHome, '.credentials.json.tmp');
    writeFileSync(tmp, credential('2026-09-09T10:00:00Z', 'refreshed-by-cli'));
    renameSync(tmp, wsPath());
    expect(isLink(wsPath())).toBe(false);          // the fork really happened

    reconcileRuntimeCredential('claude', wsHome, { readCredential: read });

    expect(markerOf(hostPath())).toBe('refreshed-by-cli');
    expect(isLink(wsPath())).toBe(true);
    expect(statSync(wsPath()).ino).toBe(statSync(hostPath()).ino);
  });

  // The other write style: straight through the symlink. There is nothing to reconcile.
  it('leaves a write that went through the link untouched', () => {
    writeHost(credential('2026-09-08T10:00:00Z', 'host'));
    link();
    writeFileSync(wsPath(), credential('2026-09-09T10:00:00Z', 'refreshed-in-place'));

    reconcileRuntimeCredential('claude', wsHome, { readCredential: read });

    expect(markerOf(hostPath())).toBe('refreshed-in-place');
    expect(isLink(wsPath())).toBe(true);
  });

  it('never lets an older credential overwrite a newer one', () => {
    writeHost(credential('2026-09-09T10:00:00Z', 'host-newer'));
    writeWs(credential('2026-09-08T10:00:00Z', 'workspace-older'));

    link();

    expect(markerOf(hostPath())).toBe('host-newer');
    expect(isLink(wsPath())).toBe(true);
    expect(markerOf(wsPath())).toBe('host-newer');
  });

  // The point of keying on the credential's own expiry: mtime says nothing about which token is live,
  // and a copy resets it. This is the case the old mtime-based re-copy got wrong.
  it('does not decide by modification time', () => {
    writeHost(credential('2026-09-09T10:00:00Z', 'host-newer'));
    writeWs(credential('2026-09-08T10:00:00Z', 'workspace-older'));
    // Make the *older* credential the most recently written file.
    const old = new Date('2020-01-01T00:00:00Z');
    utimesSync(hostPath(), old, old);
    const fresh = new Date();
    utimesSync(wsPath(), fresh, fresh);
    expect(statSync(wsPath()).mtimeMs).toBeGreaterThan(statSync(hostPath()).mtimeMs);

    link();

    expect(markerOf(hostPath())).toBe('host-newer');
  });

  it('keeps the host credential when an expiry cannot be read', () => {
    writeHost('not json at all');
    writeWs(credential('2026-09-09T10:00:00Z', 'workspace'));

    link();

    // The host's is unreadable, so the workspace's is not *provably* newer: a `claude setup-token`
    // credential legitimately carries no expiry and must not be clobbered.
    expect(readFileSync(hostPath(), 'utf8')).toBe('not json at all');
    expect(isLink(wsPath())).toBe(true);
  });

  it('keeps the host credential when neither expiry can be read', () => {
    writeHost('host-opaque');
    writeWs('workspace-opaque');

    link();

    expect(readFileSync(hostPath(), 'utf8')).toBe('host-opaque');
    expect(isLink(wsPath())).toBe(true);
  });

  it('reconciles the same way twice', () => {
    writeHost(credential('2026-09-08T10:00:00Z', 'host'));
    writeWs(credential('2026-09-09T10:00:00Z', 'workspace-newer'));

    link();
    const after = readFileSync(hostPath(), 'utf8');
    link();

    expect(readFileSync(hostPath(), 'utf8')).toBe(after);
    expect(markerOf(hostPath())).toBe('workspace-newer');
    expect(isLink(wsPath())).toBe(true);
  });
});

describe('adopting an existing workspace credential once', () => {
  it('promotes the workspace credential when the host has none', () => {
    writeWs(credential('2026-09-09T10:00:00Z', 'workspace-only'));

    link();

    expect(markerOf(hostPath())).toBe('workspace-only');
    expect(isLink(wsPath())).toBe(true);
    expect(statSync(wsPath()).ino).toBe(statSync(hostPath()).ino);
  });

  it('keeps the host credential when it is the newer of the two', () => {
    writeHost(credential('2026-09-10T10:00:00Z', 'host-newer'));
    writeWs(credential('2026-09-08T10:00:00Z', 'workspace-older'));

    link();

    expect(markerOf(hostPath())).toBe('host-newer');
  });

  it('signs nobody out when only one side has a credential at all', () => {
    writeHost(credential('2026-09-10T10:00:00Z', 'host'));

    link();

    expect(markerOf(wsPath())).toBe('host');
  });
});

describe('an isolated daemon (VS-143)', () => {
  let configDirA: string;
  let configDirB: string;

  beforeEach(() => {
    configDirA = mkdtempSync(join(tmpdir(), 'ac-daemon-a-'));
    configDirB = mkdtempSync(join(tmpdir(), 'ac-daemon-b-'));
  });
  afterEach(() => {
    rmSync(configDirA, { recursive: true, force: true });
    rmSync(configDirB, { recursive: true, force: true });
  });

  const linkIsolated = (daemonConfigDir: string): void =>
    linkRuntimeCredentials('claude', wsHome, { readCredential: read, isolated: true, daemonConfigDir });

  it('reports needing a login rather than silently reading the real host credential', () => {
    writeHost(credential('2026-09-08T10:00:00Z', 'host'));
    linkIsolated(configDirA);

    // No credential of its own, so no link is created at all — never one that quietly reaches the
    // real host file.
    expect(() => lstatSync(wsPath())).toThrow();
  });

  it('never touches or links to the real host credential, even once it has its own', () => {
    writeHost(credential('2026-09-08T10:00:00Z', 'host'));
    const isolatedHostPath = join(configDirA, 'credentials', 'claude', '.credentials.json');
    mkdirSync(dirname(isolatedHostPath), { recursive: true });
    writeFileSync(isolatedHostPath, credential('2026-09-08T10:00:00Z', 'isolated-own-login'));

    linkIsolated(configDirA);

    expect(readlinkSync(wsPath())).not.toBe(hostPath());
    expect(readlinkSync(wsPath()).startsWith(home)).toBe(false);
    expect(markerOf(hostPath())).toBe('host');
    expect(markerOf(wsPath())).toBe('isolated-own-login');
  });

  it('works once the isolated daemon has its own credential', () => {
    linkIsolated(configDirA);
    const isolatedHostPath = join(configDirA, 'credentials', 'claude', '.credentials.json');
    mkdirSync(dirname(isolatedHostPath), { recursive: true });
    writeFileSync(isolatedHostPath, credential('2026-09-08T10:00:00Z', 'isolated-own-login'));

    linkIsolated(configDirA);

    expect(isLink(wsPath())).toBe(true);
    expect(markerOf(wsPath())).toBe('isolated-own-login');
  });

  it('gives two different isolated daemons two distinct, non-conflicting credential files', () => {
    const isolatedHostPathA = join(configDirA, 'credentials', 'claude', '.credentials.json');
    const isolatedHostPathB = join(configDirB, 'credentials', 'claude', '.credentials.json');
    mkdirSync(dirname(isolatedHostPathA), { recursive: true });
    mkdirSync(dirname(isolatedHostPathB), { recursive: true });
    writeFileSync(isolatedHostPathA, credential('2026-09-08T10:00:00Z', 'daemon-a'));
    writeFileSync(isolatedHostPathB, credential('2026-09-08T10:00:00Z', 'daemon-b'));

    linkIsolated(configDirA);
    expect(markerOf(wsPath())).toBe('daemon-a');

    // A second workspace runtime home, as a second daemon-B workspace would have.
    const wsHomeB = join(mkdtempSync(join(tmpdir(), 'ac-rt-b-')), 'claude');
    mkdirSync(wsHomeB, { recursive: true });
    linkRuntimeCredentials('claude', wsHomeB, { readCredential: read, isolated: true, daemonConfigDir: configDirB });
    expect(markerOf(join(wsHomeB, '.credentials.json'))).toBe('daemon-b');

    expect(isolatedHostPathA).not.toBe(isolatedHostPathB);
    rmSync(dirname(wsHomeB), { recursive: true, force: true });
  });
});

describe('opencode shares the host config, not only auth.json', () => {
  // Custom providers and their keys live in opencode.json / opencode.jsonc. Sharing only
  // auth.json made OAuth providers work and every custom provider fail at spawn.
  const ocAuthHost = (): string => join(home, '.local', 'share', 'opencode', 'auth.json');
  const ocJsonHost = (): string => join(home, '.config', 'opencode', 'opencode.json');
  const ocJsoncHost = (): string => join(home, '.config', 'opencode', 'opencode.jsonc');
  const ocHome = (): string => join(wsHome, 'opencode');
  const linkOc = (): void => linkRuntimeCredentials('opencode', wsHome);

  it('links auth.json and the host config files that define custom providers', () => {
    mkdirSync(dirname(ocAuthHost()), { recursive: true });
    mkdirSync(dirname(ocJsonHost()), { recursive: true });
    writeFileSync(ocAuthHost(), '{"zai-coding-plan":{}}');
    writeFileSync(ocJsonHost(), '{"provider":{"codeify":{"options":{"apiKey":"k"}}}}');
    writeFileSync(ocJsoncHost(), '{"provider":{"other":{}}}');

    linkOc();

    expect(isLink(join(ocHome(), 'auth.json'))).toBe(true);
    expect(readlinkSync(join(ocHome(), 'auth.json'))).toBe(ocAuthHost());
    expect(isLink(join(ocHome(), 'opencode.json'))).toBe(true);
    expect(readlinkSync(join(ocHome(), 'opencode.json'))).toBe(ocJsonHost());
    expect(isLink(join(ocHome(), 'opencode.jsonc'))).toBe(true);
    expect(readFileSync(join(ocHome(), 'opencode.json'), 'utf8')).toContain('codeify');
  });

  it('does not invent a config file the host does not have', () => {
    mkdirSync(dirname(ocAuthHost()), { recursive: true });
    writeFileSync(ocAuthHost(), '{}');
    linkOc();
    expect(isLink(join(ocHome(), 'auth.json'))).toBe(true);
    expect(() => lstatSync(join(ocHome(), 'opencode.json'))).toThrow();
    expect(() => lstatSync(join(ocHome(), 'opencode.jsonc'))).toThrow();
  });

  it('does not share the host config from an isolated daemon', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ac-daemon-oc-'));
    mkdirSync(dirname(ocJsonHost()), { recursive: true });
    writeFileSync(ocJsonHost(), '{"provider":{"codeify":{}}}');
    linkRuntimeCredentials('opencode', wsHome, { isolated: true, daemonConfigDir: configDir });
    expect(() => lstatSync(join(ocHome(), 'opencode.json'))).toThrow();
    expect(readFileSync(ocJsonHost(), 'utf8')).toContain('codeify');
    rmSync(configDir, { recursive: true, force: true });
  });
});

describe('runtimes that cannot describe their credential', () => {
  it('still shares the file, and never overwrites the host copy', () => {
    const codexHost = join(home, '.codex', 'auth.json');
    mkdirSync(dirname(codexHost), { recursive: true });
    writeFileSync(codexHost, '{"codex":"host"}');
    writeFileSync(join(wsHome, 'auth.json'), '{"codex":"workspace"}');

    // No reader: codex does not implement `readCredential`, so no expiry can be compared.
    linkRuntimeCredentials('codex', wsHome);

    expect(readFileSync(codexHost, 'utf8')).toBe('{"codex":"host"}');
    expect(isLink(join(wsHome, 'auth.json'))).toBe(true);
  });
});
