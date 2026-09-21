import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Session } from '../session.js';
import { startMockMcp, type MockMcp } from '../testkit/mockMcp.js';
import { startMockProvider, type MockProvider } from '../testkit/mockProvider.js';
import { complete, executeCommand, parseCommand, type CommandCtx } from './commands.js';
import { loadReplConfig, type ReplConfig } from './config.js';
import type { ReplState } from './run.js';
import { recordTurn, sessionPath } from './sessions.js';

const STDIO_SERVER = `
import { createInterface } from 'node:readline';
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fake', version: '1' } } });
  if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'echo', description: 'echo back', inputSchema: { type: 'object' } }, { name: 'ping', description: 'ping', inputSchema: { type: 'object' } }, { name: 'fetch', description: 'fetch a url', inputSchema: { type: 'object' } }] } });
});
`;

let dir: string; let cwd: string; let home: string; let mock: MockProvider; let mcp: MockMcp;
beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), 'wa-repl-cmd-')); cwd = join(dir, 'proj'); home = join(dir, 'home'); mkdirSync(cwd); mkdirSync(home); mock = await startMockProvider(); mcp = await startMockMcp([{ name: 'a' }, { name: 'b' }], () => 'x'); });
afterEach(async () => { await mock.close(); await mcp.close(); rmSync(dir, { recursive: true, force: true }); });

function config(extra = ''): ReplConfig {
  mkdirSync(join(dir, 'ws'), { recursive: true });
  // VS-654: providers are daemon-only, and the REPL reads them from the user's agent.yaml or the
  // daemon — never a workspace.yaml. MCP servers keep their workspace layer.
  mkdirSync(join(dir, '.config', 'weave'), { recursive: true });
  writeFileSync(join(dir, '.config', 'weave', 'agent.yaml'), `providers:
  mock:
    baseUrl: ${mock.baseUrl}
    apiKeySecret: WEAVE_LLM_MOCK_KEY
    models:
      m1: { contextWindow: 8000 }
      m2: {}
    compat:
      reasoning: { effortParam: reasoning_effort, effortLevels: [low, medium, high] }
  other:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
`);
  writeFileSync(join(dir, 'ws', 'workspace.yaml'), `version: 1
id: t
name: T
ticketPrefix: TT
mcpServers:
  disk:
    type: stdio
    command: ${process.execPath}
    args: ["${join(dir, 'server.mjs')}"]
  remote:
    type: http
    url: ${mcp.url}
  broken:
    type: http
    url: http://127.0.0.1:9/mcp
${extra}`);
  writeFileSync(join(dir, 'server.mjs'), STDIO_SERVER);
  return loadReplConfig({ flags: { provider: 'mock', model: 'm1' }, env: { WEAVE_LLM_MOCK_KEY: 'k12345678' }, cwd: join(dir, 'ws'), home: dir });
}
const stateOf = (over: Partial<ReplState> = {}): ReplState => ({ providerId: 'mock', model: 'm1', permission: 'auto', effort: null, params: {}, sessionId: 's', sessionPath: sessionPath(home, 's'), ...over });
const ctxOf = (cfg: ReplConfig, state = stateOf()): CommandCtx => ({ state, cfg, homeDir: home, cwd, env: { PATH: process.env['PATH'] ?? '', HOME: dir, WEAVE_LLM_MOCK_KEY: 'k12345678' }, userHome: dir });

function session(id: string, at: string, prompt: string): string {
  const path = sessionPath(home, id);
  const s = Session.open({ path, id, cwd: at, origin: 'repl' });
  s.append({ role: 'user', text: prompt }); s.append({ role: 'assistant', content: [{ type: 'text', text: 'ok' }] }); s.close();
  recordTurn(path, { prompt, provider: 'mock', model: 'm1' });
  return path;
}

describe('slash commands', () => {
  it('parses commands and aliases, and refuses an unknown one with a hint', async () => {
    expect(parseCommand('/quit')).toEqual({ name: 'exit', args: [] });
    expect(parseCommand('hello')).toBeNull();
    const cfg = config();
    expect((await executeCommand('/frobnicate', ctxOf(cfg))).lines[0]).toMatch(/unknown command \/frobnicate: \/help/);
    const help = (await executeCommand('/help', ctxOf(cfg))).lines.join('\n');
    for (const c of ['/sessions', '/new', '/compact', '/skills', '/mcp', '/model', '/permissions', '/exit']) expect(help).toContain(c);
  });

  it('/sessions lists this directory, --all widens, a worker file is absent, and a number or id resumes', async () => {
    const cfg = config();
    session('aaaaaaaa11', cwd, 'fix the parser'); session('bbbbbbbb22', join(dir, 'other'), 'elsewhere work');
    mkdirSync(join(dir, 'workers', 'runtimes', 'weave-agent', 'sessions'), { recursive: true });
    const w = Session.open({ path: join(dir, 'workers', 'runtimes', 'weave-agent', 'sessions', 'w1.jsonl'), id: 'w1', cwd });
    w.append({ role: 'user', text: 'ticket work' }); w.close();
    const here = await executeCommand('/sessions', ctxOf(cfg));
    expect(here.lines.join('\n')).toContain('aaaaaaaa');
    expect(here.lines.join('\n')).toContain('fix the parser');
    expect(here.lines.join('\n')).toContain('m1');
    expect(here.lines.join('\n')).not.toContain('elsewhere');
    expect(here.pick).toHaveLength(1);
    const all = await executeCommand('/sessions --all', ctxOf(cfg));
    expect(all.lines.join('\n')).toContain('elsewhere work');
    expect(all.lines.join('\n')).not.toContain('ticket work');
    const byNumber = await executeCommand('/sessions 1', ctxOf(cfg));
    expect(byNumber.action).toMatchObject({ type: 'resume', session: { id: 'aaaaaaaa11' } });
    expect((await executeCommand('/sessions bbbb', ctxOf(cfg))).lines[0]).toBe('no session "bbbb"');
    expect((await executeCommand('/sessions --all bbbb', ctxOf(cfg))).action).toMatchObject({ type: 'resume', session: { id: 'bbbbbbbb22' } });
  });

  it('/skills names each skill with where it came from', async () => {
    const cfg = config();
    for (const [root, name, desc] of [[join(cwd, '.agents', 'skills', 'lint'), 'lint', 'project lint'], [join(dir, '.agents', 'skills', 'deploy'), 'deploy', 'ship it'], [join(dir, '.config', 'weave', 'skills', 'notes'), 'notes', 'take notes']] as const) {
      mkdirSync(root, { recursive: true }); writeFileSync(join(root, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\nbody\n`);
    }
    const lines = (await executeCommand('/skills', ctxOf(cfg))).lines;
    expect(lines.find((l) => l.startsWith('lint'))).toContain('[project (.agents/skills)]');
    expect(lines.find((l) => l.startsWith('deploy'))).toContain('[user (~/.agents/skills)]');
    expect(lines.find((l) => l.startsWith('notes'))).toContain('[user (~/.config/weave/skills)]');
  });

  it('/mcp shows a connected stdio server with its tool count, a connected http one, and a failed one with its reason; /mcp <server> lists tools', async () => {
    const cfg = config();
    const res = await executeCommand('/mcp', ctxOf(cfg));
    const row = (n: string): string => res.lines.find((l) => l.startsWith(n))!;
    expect(row('disk')).toMatch(/connected\s+3 tools/);
    expect(row('remote')).toMatch(/connected\s+2 tools/);
    expect(row('broken')).toMatch(/failed\s+\S+/);
    const one = (await executeCommand('/mcp disk', ctxOf(cfg))).lines;
    expect(one[0]).toBe('disk  connected, 3 tools');
    expect(one.join('\n')).toContain('echo');
    expect(one.join('\n')).toContain('fetch a url');
    expect((await executeCommand('/mcp nope', ctxOf(cfg))).lines[0]).toContain('no MCP server "nope"');
  });

  it('/model shows, lists the static and discovered catalogue merged, and switches by id, number and provider/model', async () => {
    const cfg = config();
    const shown = (await executeCommand('/model', ctxOf(cfg))).lines.join('\n');
    expect(shown).toContain('model        m1');
    expect(shown).toContain('none set');
    const fetched: string[] = [];
    const fake = (async (url: string) => { fetched.push(url); return new Response(JSON.stringify({ data: [{ id: 'm2' }, { id: 'live-only' }] }), { status: 200 }); }) as unknown as typeof fetch;
    const list = (await executeCommand('/model list', ctxOf(cfg), { fetch: fake })).lines;
    expect(fetched[0]).toBe(`${mock.baseUrl}/models`);
    expect(list.filter((l) => /^\d+\./.test(l)).map((l) => l.replace(/\s+/g, ' '))).toEqual(['1. m1 ● static 8000 tokens', '2. m2 static', '3. live-only detected']);
    expect((await executeCommand('/model 3', ctxOf(cfg), { fetch: fake })).state?.model).toBe('live-only');
    expect((await executeCommand('/model m2', ctxOf(cfg))).state).toMatchObject({ providerId: 'mock', model: 'm2' });
    expect((await executeCommand('/model other/some-model', ctxOf(cfg))).state).toMatchObject({ providerId: 'other', model: 'some-model' });
  });

  it('/model parameters: set, refuse out-of-range with the schema message and keep the old value, unset', async () => {
    const cfg = config();
    let st = (await executeCommand('/model temperature 0.3', ctxOf(cfg))).state!;
    expect(st.params).toEqual({ temperature: 0.3 });
    const bad = await executeCommand('/model temperature 9', ctxOf(cfg, st));
    expect(bad.lines[0]).toMatch(/^refused: temperature: .*2/);
    expect(bad.state).toBeUndefined();
    st = (await executeCommand('/model contextWindowTokens 32000', ctxOf(cfg, st))).state!;
    expect(st.params).toEqual({ temperature: 0.3, contextWindowTokens: 32000 });
    expect((await executeCommand('/model contextWindowTokens -1', ctxOf(cfg, st))).lines[0]).toMatch(/^refused/);
    st = (await executeCommand('/model unset temperature', ctxOf(cfg, st))).state!;
    expect(st.params).toEqual({ contextWindowTokens: 32000 });
    expect((await executeCommand('/model effort high', ctxOf(cfg, st))).state?.effort).toBe('high');
    expect((await executeCommand('/model effort extreme', ctxOf(cfg, st))).lines[0]).toBe('effort "extreme" is not one of: low, medium, high');
  });

  it('/permissions shows and sets the existing modes only', async () => {
    const cfg = config();
    expect((await executeCommand('/permissions', ctxOf(cfg))).lines[0]).toBe('permission mode: auto');
    expect((await executeCommand('/permissions restricted', ctxOf(cfg))).state?.permission).toBe('restricted');
    expect((await executeCommand('/permissions root', ctxOf(cfg))).lines[0]).toContain('auto, restricted, bypass');
  });

  it('/new and /exit and /compact return actions; tab completion offers commands and arguments', async () => {
    const cfg = config();
    expect((await executeCommand('/exit', ctxOf(cfg))).action).toEqual({ type: 'exit' });
    expect((await executeCommand('/new', ctxOf(cfg))).action).toEqual({ type: 'new' });
    expect((await executeCommand('/compact', ctxOf(cfg))).action).toEqual({ type: 'compact' });
    const c = { cfg, state: stateOf() };
    expect(complete('/mo', c)).toEqual([['/model'], '/mo']);
    expect(complete('/permissions r', c)).toEqual([['restricted'], 'r']);
    expect(complete('/model ef', c)[0]).toEqual(['effort']);
    expect(complete('/mcp d', c)[0]).toEqual(['disk']);
    expect(complete('hello', c)).toEqual([[], 'hello']);
  });
});
