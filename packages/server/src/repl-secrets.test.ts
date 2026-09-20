import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadReplConfig, openDaemonSecret, openWorkspaceSecret, resolveApiKey, resolveMcpRefs } from '@weave-ai/agent';
import { createSecretStore, daemonSecretStore } from '@weave-ai/core';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ws-repl-secret-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the REPL\'s read-only secret opener', () => {
  it('opens what the daemon\'s own store wrote, and nothing it did not', () => {
    const store = createSecretStore({ secretsFile: join(dir, 'secrets.enc'), secretsKey: join(dir, 'secrets.key') });
    store.put('WEAVE_LLM_LOCAL_KEY', 'sk-from-the-daemon');
    expect(openWorkspaceSecret(dir, 'WEAVE_LLM_LOCAL_KEY')).toBe('sk-from-the-daemon');
    expect(openWorkspaceSecret(dir, 'OTHER')).toBeNull();
    expect(openWorkspaceSecret(join(dir, 'missing'), 'WEAVE_LLM_LOCAL_KEY')).toBeNull();
  });
});

describe('the REPL and the daemon secret store (VS-633)', () => {
  it('opens what the daemon\'s own daemon store wrote', () => {
    daemonSecretStore(dir)!.put('WEAVE_LLM_SHARED_KEY', 'sk-daemon-held');
    expect(openDaemonSecret(dir, 'WEAVE_LLM_SHARED_KEY')).toBe('sk-daemon-held');
    expect(openDaemonSecret(dir, 'OTHER')).toBeNull();
    // A workspace store is a different file pair: the daemon opener never reads it.
    createSecretStore({ secretsFile: join(dir, 'secrets.enc'), secretsKey: join(dir, 'secrets.key') }).put('ONLY_WS', 'x');
    expect(openDaemonSecret(dir, 'ONLY_WS')).toBeNull();
  });

  it('picks up a daemon provider with no workspace and no agent.yaml, and finds its key in the daemon store', () => {
    const cfgHome = join(dir, 'config');
    mkdirSync(join(cfgHome, 'weave'), { recursive: true });
    writeFileSync(join(cfgHome, 'weave', 'daemon.yaml'), 'version: 1\nproviders:\n  shared:\n    baseUrl: http://127.0.0.1:4000/v1\n    apiKeySecret: WEAVE_LLM_SHARED_KEY\n    models:\n      big: {}\nmcpServers:\n  docs:\n    type: http\n    url: http://127.0.0.1:5000/mcp\n    headers:\n      Authorization: "Bearer ${DOCS_TOKEN}"\n');
    daemonSecretStore(join(cfgHome, 'weave'))!.put('WEAVE_LLM_SHARED_KEY', 'sk-daemon-held');
    daemonSecretStore(join(cfgHome, 'weave'))!.put('DOCS_TOKEN', 'docs-daemon-token');
    const env = { XDG_CONFIG_HOME: cfgHome };
    const cfg = loadReplConfig({ flags: {}, env, cwd: dir, home: join(dir, 'home') });
    expect(cfg.provider).toBe('shared');
    expect(cfg.model).toBe('big');
    const key = resolveApiKey({ providerId: 'shared', profile: cfg.providers['shared']!, env, workspace: cfg.workspace, daemonDir: cfg.daemonDir });
    expect(key).toMatchObject({ key: 'sk-daemon-held', source: 'daemon' });
    const { server, missing } = resolveMcpRefs(cfg.mcpServers['docs']!, { env, workspace: cfg.workspace, daemonDir: cfg.daemonDir });
    expect(server.headers['Authorization']).toBe('Bearer docs-daemon-token');
    expect(missing).toEqual([]);
    expect(JSON.stringify(cfg)).not.toContain('sk-daemon-held');
  });
});
