import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { keyVarFor, loadReplConfig, resolveApiKey, resolveMcpRefs } from './config.js';

let dir: string; let home: string; let ws: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wa-repl-cfg-')); home = join(dir, 'home'); ws = join(dir, 'ws'); mkdirSync(home); mkdirSync(join(ws, 'sub'), { recursive: true }); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ XDG_CONFIG_HOME: join(home, '.config'), ...extra });
const wsYaml = `version: 1
id: acme
name: Acme
ticketPrefix: AC
providers:
  local:
    baseUrl: http://127.0.0.1:1234/v1
    apiKeySecret: WEAVE_LLM_LOCAL_KEY
    models:
      m1: {}
mcpServers:
  files:
    type: stdio
    command: node
    env:
      TOKEN: "\${FILES_TOKEN}"
`;

describe('loadReplConfig', () => {
  it('needs nothing: no workspace and no file gives an empty config in the default mode', () => {
    const c = loadReplConfig({ flags: {}, env: env(), cwd: dir, home });
    expect(c).toMatchObject({ providers: {}, provider: null, model: null, permission: 'auto', workspace: null });
  });

  it('reads the nearest workspace from a subdirectory: its provider, first model and MCP server', () => {
    writeFileSync(join(ws, 'workspace.yaml'), wsYaml);
    const c = loadReplConfig({ flags: {}, env: env(), cwd: join(ws, 'sub'), home });
    expect(c.workspace?.root).toBe(ws);
    expect(c.provider).toBe('local');
    expect(c.model).toBe('m1');
    expect(Object.keys(c.mcpServers)).toEqual(['files']);
    expect(c.sources.some((s) => s.startsWith('workspace '))).toBe(true);
  });

  it('flags win over the workspace: --base-url builds an in-memory profile and --model may name a provider', () => {
    writeFileSync(join(ws, 'workspace.yaml'), wsYaml);
    const c = loadReplConfig({ flags: { provider: 'edge', baseUrl: 'http://127.0.0.1:9/v1', model: 'edge/tiny', permission: 'restricted' }, env: env({ WEAVE_LLM_EDGE_KEY: 'k' }), cwd: ws, home });
    expect(c).toMatchObject({ provider: 'edge', model: 'tiny', permission: 'restricted' });
    expect(c.providers['edge']).toMatchObject({ baseUrl: 'http://127.0.0.1:9/v1', auth: 'bearer', apiKeySecret: 'WEAVE_LLM_EDGE_KEY' });
    expect(JSON.stringify(c)).not.toContain('"k"');
  });

  it('reports a bad user file and a bad permission as notes instead of failing', () => {
    mkdirSync(join(home, '.config', 'weave'), { recursive: true });
    writeFileSync(join(home, '.config', 'weave', 'agent.yaml'), 'providers: [unterminated\n');
    const c = loadReplConfig({ flags: { permission: 'root' }, env: env(), cwd: dir, home });
    expect(c.permission).toBe('auto');
    expect(c.notes.join('\n')).toMatch(/agent\.yaml/);
    expect(c.notes.join('\n')).toMatch(/--permission "root"/);
  });
});

describe('keys', () => {
  it('takes the key from the environment: the profile secret name first, then WEAVE_LLM_<PROVIDER>_KEY', () => {
    const profile = { baseUrl: 'http://x/v1', apiKeySecret: 'MY_KEY' } as never;
    expect(keyVarFor('open-router')).toBe('WEAVE_LLM_OPEN_ROUTER_KEY');
    expect(resolveApiKey({ providerId: 'p', profile, env: { MY_KEY: 'a', WEAVE_LLM_P_KEY: 'b' }, workspace: null })).toMatchObject({ key: 'a', source: 'env', name: 'MY_KEY' });
    expect(resolveApiKey({ providerId: 'p', profile, env: { WEAVE_LLM_P_KEY: 'b' }, workspace: null })).toMatchObject({ key: 'b', source: 'env' });
    expect(resolveApiKey({ providerId: 'p', profile, env: {}, workspace: null })).toMatchObject({ key: undefined, source: 'none', name: 'MY_KEY' });
  });

  it('resolves ${NAME} in an MCP server from the environment and reports what is missing, never printing values', () => {
    const { server, missing } = resolveMcpRefs({ type: 'stdio', command: 'x', args: [], headers: {}, env: { A: '${HAVE}', B: '${GONE}' }, listTimeoutMs: 1, callTimeoutMs: 1, readOnly: false }, { env: { HAVE: 'v' }, workspace: null });
    expect(server.env).toEqual({ A: 'v', B: '' });
    expect(missing).toEqual(['GONE']);
  });
});
