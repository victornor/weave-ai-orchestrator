import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  contextsPath, currentContext, findWorkspaceFile, loadContexts, putContext, removeContext,
  resolveWorkspaceId, saveContexts, suggestContextName, useContext, workspaceIdFromFile,
} from './contexts.js';

let dir: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'oc-contexts-'));
  process.env['OC_CONTEXTS_FILE'] = join(dir, 'contexts.yaml');
  delete process.env['OC_WORKSPACE'];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...savedEnv };
});

describe('contexts file', () => {
  it('returns an empty file when none exists', () => {
    expect(loadContexts()).toEqual({ contexts: {} });
  });

  it('round-trips contexts and makes the first one current', () => {
    putContext('local', { url: 'http://127.0.0.1:7433', token: 'tok_1', workspace: 'acme' });
    const file = loadContexts();
    expect(file.current).toBe('local');
    expect(file.contexts['local']).toEqual({ url: 'http://127.0.0.1:7433', token: 'tok_1', workspace: 'acme' });
    expect(readFileSync(contextsPath(), 'utf8')).toContain('http://127.0.0.1:7433');
  });

  it('stores the file with owner-only permissions', () => {
    putContext('local', { url: 'http://x', token: 'tok' });
    expect(statSync(contextsPath()).mode & 0o777).toBe(0o600);
  });

  it('switches, removes and repoints current', () => {
    putContext('a', { url: 'http://a', token: '1' });
    putContext('b', { url: 'http://b', token: '2' });
    expect(loadContexts().current).toBe('b');
    useContext('a');
    expect(loadContexts().current).toBe('a');
    expect(removeContext('a')).toBe(true);
    expect(loadContexts().current).toBe('b');
    expect(removeContext('nope')).toBe(false);
    expect(() => useContext('nope')).toThrowError(/no such context/);
  });

  it('rejects a malformed contexts file with a useful message', () => {
    writeFileSync(contextsPath(), 'contexts:\n  local:\n    token: 1\n');
    expect(() => loadContexts()).toThrowError(/not a valid contexts file/);
    writeFileSync(contextsPath(), 'contexts: [unclosed\n');
    expect(() => loadContexts()).toThrowError(/not valid YAML/);
  });

  it('resolves the current context, honouring an explicit name', () => {
    putContext('a', { url: 'http://a', token: '1' });
    putContext('b', { url: 'http://b', token: '2' });
    expect(currentContext().name).toBe('b');
    expect(currentContext('a').entry?.url).toBe('http://a');
    expect(() => currentContext('missing')).toThrowError(/no such context/);
  });

  it('suggests context names from urls', () => {
    expect(suggestContextName('http://127.0.0.1:7433')).toBe('local');
    expect(suggestContextName('http://localhost:7433')).toBe('local');
    expect(suggestContextName('https://oc.example.com')).toBe('oc.example.com');
    expect(suggestContextName('not a url')).toBe('default');
  });

  it('saves an empty file without inventing a current context', () => {
    saveContexts({ contexts: {} });
    expect(loadContexts().current).toBeUndefined();
  });
});

describe('workspace resolution', () => {
  it('walks up to the nearest workspace.yaml', () => {
    const nested = join(dir, 'ws', 'projects', 'api');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(dir, 'ws', 'workspace.yaml'), 'version: 1\nid: acme\nname: Acme\n');
    const found = findWorkspaceFile(nested);
    expect(found).toBe(join(dir, 'ws', 'workspace.yaml'));
    expect(workspaceIdFromFile(found!)).toBe('acme');
  });

  it('returns null when there is no workspace.yaml and on a broken one', () => {
    expect(findWorkspaceFile(dir)).toBeNull();
    const broken = join(dir, 'workspace.yaml');
    writeFileSync(broken, 'id: [unclosed\n');
    expect(workspaceIdFromFile(broken)).toBeNull();
  });

  it('prefers the flag, then the environment, then the context, then the directory', () => {
    mkdirSync(join(dir, 'ws'), { recursive: true });
    writeFileSync(join(dir, 'ws', 'workspace.yaml'), 'id: from-file\n');
    const context = { url: 'http://x', token: 't', workspace: 'from-context' };

    expect(resolveWorkspaceId('from-flag', context, join(dir, 'ws'))).toBe('from-flag');
    process.env['OC_WORKSPACE'] = 'from-env';
    expect(resolveWorkspaceId(null, context, join(dir, 'ws'))).toBe('from-env');
    delete process.env['OC_WORKSPACE'];
    expect(resolveWorkspaceId(null, context, join(dir, 'ws'))).toBe('from-context');
    expect(resolveWorkspaceId(null, null, join(dir, 'ws'))).toBe('from-file');
    expect(resolveWorkspaceId(null, null, dir)).toBeNull();
  });
});
