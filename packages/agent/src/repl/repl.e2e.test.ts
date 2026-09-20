import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Session } from '../session.js';
import { startMockProvider, textChunks, toolCallChunks, type MockProvider } from '../testkit/mockProvider.js';
import { listSessions, recordTurn } from './sessions.js';

/**
 * The real REPL, started from source as its own process. Interactive tests run it under a real pty
 * (util-linux `script`), typing keys and reading what a person would see; `-p` tests use plain pipes.
 */
const here = dirname(fileURLToPath(import.meta.url));
const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href;
const BIN = join(here, 'bin.ts');
// A fresh checkout has no `dist` for workspace packages, and `@weave-ai/shared`'s entry is `dist/index.js`: point tsx at its source.
const SHARED_SRC = join(here, '..', '..', '..', 'shared', 'src', 'index.ts');
const KEY = 'sk-e2e-repl-key-4242';
const haveScript = spawnSync('script', ['--version']).status === 0;
// eslint-disable-next-line no-control-regex
const strip = (s: string): string => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

let dir: string; let proj: string; let mock: MockProvider; const kids: ChildProcess[] = [];
beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), 'wa-repl-e2e-')); proj = join(dir, 'proj'); mkdirSync(proj); mock = await startMockProvider(); });
afterEach(async () => { for (const k of kids.splice(0)) { try { if (k.pid && k.exitCode === null) process.kill(k.pid, 'SIGKILL'); } catch { /* gone */ } } await mock.close(); rmSync(dir, { recursive: true, force: true }); });

const agentHome = (): string => join(dir, 'agent-home');
const tsconfigFile = (): string => {
  const f = join(dir, 'tsconfig.e2e.json');
  writeFileSync(f, JSON.stringify({ compilerOptions: { baseUrl: '/', paths: { '@weave-ai/shared': [SHARED_SRC] } } }));
  return f;
};
const env = (extra: Record<string, string> = {}): Record<string, string> => ({ TSX_TSCONFIG_PATH: tsconfigFile(), PATH: process.env['PATH'] ?? '', HOME: join(dir, 'home'), XDG_CONFIG_HOME: join(dir, 'home', '.config'), WEAVE_AGENT_HOME: agentHome(), WEAVE_LLM_MOCK_KEY: KEY, TERM: 'xterm', ...extra });
const flags = (): string[] => ['--provider', 'mock', '--base-url', mock.baseUrl, '--model', 'mock-model'];
const sessionFiles = (): string[] => { try { return readdirSync(join(agentHome(), 'sessions')); } catch { return []; } };
const until = async (cond: () => boolean, what: string, show: () => string = () => ''): Promise<void> => { const end = Date.now() + 20_000; while (!cond()) { if (Date.now() > end) throw new Error(`never saw: ${what}\n--- output ---\n${show()}`); await new Promise((r) => setTimeout(r, 15)); } };

function pty(args: string[], extra: Record<string, string> = {}) {
  const cmd = [process.execPath, '--import', tsx, BIN, ...args].map(q).join(' ');
  const child = spawn('script', ['-qfec', cmd, '/dev/null'], { cwd: proj, env: env(extra), stdio: ['pipe', 'pipe', 'pipe'] });
  kids.push(child);
  let raw = '';
  child.stdout!.on('data', (c: Buffer) => { raw += c.toString(); });
  const exited = new Promise<number | null>((res) => child.on('close', (code) => res(code)));
  const api = {
    text: (): string => strip(raw),
    raw: (): string => raw,
    send: (s: string): void => { child.stdin!.write(s); },
    see: async (needle: string | RegExp, from = 0): Promise<void> => until(() => (typeof needle === 'string' ? api.text().slice(from).includes(needle) : needle.test(api.text().slice(from))), String(needle), api.text),
    mark: (): number => api.text().length,
    ready: async (): Promise<void> => api.see('› '),
    exited,
  };
  return api;
}

function runP(args: string[], extra: Record<string, string> = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, ['--import', tsx, BIN, ...args], { cwd: proj, env: env(extra) });
    kids.push(c);
    let stdout = ''; let stderr = '';
    c.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    c.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    c.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
const bodyText = (i: number): string => JSON.stringify(mock.requests[i]!.body);

describe.skipIf(!haveScript)('interactive REPL on a pty', () => {
  it('answers a prompt with streamed text and a rendered tool call, leaves a repl session file, and never shows the key', async () => {
    mock.script({ chunks: toolCallChunks([{ id: 'b1', name: 'bash', args: JSON.stringify({ command: 'echo hello-from-tool' }) }]) }, { chunks: textChunks('all done here') });
    const t = pty(flags());
    await t.ready();
    expect(t.text()).toContain('weave-agent · mock/mock-model · auto');
    t.send('please run it\r');
    await t.see('▸ bash  echo hello-from-tool');
    await t.see('hello-from-tool', t.text().indexOf('▸ bash'));
    await t.see('all done here');
    t.send('\x04');
    expect(await t.exited).toBe(0);
    const files = sessionFiles();
    expect(files).toHaveLength(1);
    const content = readFileSync(join(agentHome(), 'sessions', files[0]!), 'utf8');
    expect(content.split('\n')[0]).toContain('"origin":"repl"');
    expect(content).toContain('please run it');
    expect(content).not.toContain(KEY);
    expect(t.raw()).not.toContain(KEY);
    expect(mock.requests[0]!.headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify([...mock.requests.map((r) => r.body)])).not.toContain(KEY);
  });

  it('/sessions lists this directory (not the other one, not a worker file), --all widens, choosing one resumes it and the next request carries its messages', async () => {
    const mk = (id: string, cwd: string, prompt: string): void => {
      const path = join(agentHome(), 'sessions', `${id}.jsonl`);
      const s = Session.open({ path, id, cwd, origin: 'repl' });
      s.append({ role: 'user', text: `<env>e</env>\n\n${prompt}` }); s.append({ role: 'assistant', content: [{ type: 'text', text: `reply to ${prompt}` }] }); s.close();
      recordTurn(path, { prompt, provider: 'mock', model: 'mock-model' });
    };
    mk('11111111-aaaa', proj, 'refactor the parser'); mk('22222222-bbbb', join(dir, 'elsewhere'), 'unrelated project');
    const workerDir = join(dir, 'ws', '.weave', 'runtimes', 'weave', 'weave-agent', 'sessions'); mkdirSync(workerDir, { recursive: true });
    const w = Session.open({ path: join(workerDir, 'w.jsonl'), id: 'w', cwd: proj }); w.append({ role: 'user', text: 'ticket VS-1 work' }); w.close();
    mock.script({ chunks: textChunks('resumed answer') });
    const t = pty(flags());
    await t.ready();
    let m = t.mark();
    t.send('/sessions\r');
    await t.see('refactor the parser', m);
    expect(t.text().slice(m)).not.toContain('unrelated project');
    expect(t.text().slice(m)).not.toContain('ticket VS-1');
    m = t.mark();
    t.send('/sessions --all\r');
    await t.see('unrelated project', m);
    expect(t.text().slice(m)).not.toContain('ticket VS-1');
    // the picker: after a bare /sessions, a number resumes
    t.send('/sessions\r');
    await t.see('Enter a number or id', m);
    m = t.mark();
    t.send('1\r');
    await t.see('resumed 11111111', m);
    t.send('and now?\r');
    await t.see('resumed answer');
    expect(bodyText(0)).toContain('refactor the parser');
    expect(bodyText(0)).toContain('reply to refactor the parser');
    expect(bodyText(0)).toContain('and now?');
    t.send('\x04');
    await t.exited;
  });

  it('/model switches the model, sets effort through the compat mapping, refuses an out-of-range value and leaves unset parameters absent', async () => {
    mkdirSync(join(dir, 'home', '.config', 'weave'), { recursive: true });
    writeFileSync(join(dir, 'home', '.config', 'weave', 'agent.yaml'), `provider: mock
model: m1
providers:
  mock:
    baseUrl: ${mock.baseUrl}
    apiKeySecret: WEAVE_LLM_MOCK_KEY
    models: { m1: {}, m2: {} }
    compat:
      reasoning: { effortParam: reasoning_effort, effortLevels: [low, high] }
`);
    mock.script({ chunks: textChunks('one') }, { chunks: textChunks('two') });
    const t = pty([]);
    await t.ready();
    t.send('first\r'); await t.see('one');
    let m = t.mark();
    t.send('/model m2\r'); await t.see('model is now mock/m2', m);
    t.send('/model effort high\r'); await t.see('effort is now high', m);
    m = t.mark();
    t.send('/model temperature 9\r'); await t.see('refused: temperature', m);
    t.send('second\r'); await t.see('two');
    expect(mock.requests[0]!.body['model']).toBe('m1');
    expect(mock.requests[0]!.body).not.toHaveProperty('reasoning_effort');
    expect(mock.requests[1]!.body['model']).toBe('m2');
    expect(mock.requests[1]!.body['reasoning_effort']).toBe('high');
    expect(mock.requests[1]!.body).not.toHaveProperty('temperature');
    t.send('\x04'); await t.exited;
  });

  it('Ctrl-C mid-turn cancels it and leaves a loadable session; a second Ctrl-C at an idle prompt exits', async () => {
    mock.script({ chunks: textChunks('partial answer'), stall: true }, { chunks: textChunks('later answer') });
    const t = pty(flags());
    await t.ready();
    t.send('think hard\r');
    await until(() => mock.requests.length === 1, 'the request', t.text);
    t.send('\x03');
    await t.see('interrupted');
    const file = join(agentHome(), 'sessions', sessionFiles()[0]!);
    const s = Session.open({ path: file, id: 'x', cwd: proj });
    expect(s.messages.some((x) => x.role === 'user')).toBe(true);
    s.close();
    // the session continues after a cancel
    t.send('go on\r'); await t.see('later answer');
    expect(bodyText(1)).toContain('think hard');
    t.send('\x03'); await t.see('press Ctrl-C again');
    t.send('\x03');
    expect(await t.exited).toBe(0);
  });

  it('text typed while a turn runs steers it: it reaches the next request of the same turn', async () => {
    mock.script({ chunks: toolCallChunks([{ id: 'b1', name: 'bash', args: JSON.stringify({ command: 'sleep 1' }) }]) }, { chunks: textChunks('steered answer') });
    const t = pty(flags());
    await t.ready();
    t.send('start\r');
    await t.see('▸ bash  sleep 1');
    t.send('also mention the changelog\r');
    await t.see('queued: also mention the changelog');
    await t.see('steered answer');
    expect(mock.requests).toHaveLength(2);
    expect(bodyText(1)).toContain('also mention the changelog');
    t.send('\x04'); await t.exited;
  });

  it('asks for a missing key without echoing it, keeps it in memory, and uses it on the next request', async () => {
    mkdirSync(join(dir, 'home', '.config', 'weave'), { recursive: true });
    writeFileSync(join(dir, 'home', '.config', 'weave', 'agent.yaml'), `provider: mock\nmodel: m1\nproviders:\n  mock:\n    baseUrl: ${mock.baseUrl}\n    apiKeySecret: WEAVE_LLM_MOCK_KEY\n`);
    mock.script({ chunks: textChunks('keyed') });
    const t = pty([], { WEAVE_LLM_MOCK_KEY: '' });
    await t.see('API key for mock');
    t.send('sk-typed-at-the-prompt\r');
    await t.ready();
    t.send('hi\r'); await t.see('keyed');
    expect(mock.requests[0]!.headers['authorization']).toBe('Bearer sk-typed-at-the-prompt');
    expect(t.raw()).not.toContain('sk-typed-at-the-prompt');
    t.send('\x04'); await t.exited;
    for (const f of sessionFiles()) expect(readFileSync(join(agentHome(), 'sessions', f), 'utf8')).not.toContain('sk-typed-at-the-prompt');
    expect(readdirSync(agentHome()).flatMap((n) => (n === 'history' ? [readFileSync(join(agentHome(), n), 'utf8')] : []))).not.toContain('sk-typed');
  });

  it('/skills and /mcp answer from the fixtures on the terminal', async () => {
    mkdirSync(join(proj, '.agents', 'skills', 'lint'), { recursive: true });
    writeFileSync(join(proj, '.agents', 'skills', 'lint', 'SKILL.md'), '---\nname: lint\ndescription: lint the project\n---\nbody\n');
    mkdirSync(join(dir, 'home', '.config', 'weave'), { recursive: true });
    writeFileSync(join(dir, 'home', '.config', 'weave', 'agent.yaml'), `mcpServers:\n  broken:\n    type: http\n    url: http://127.0.0.1:9/mcp\n`);
    const t = pty(flags());
    await t.ready();
    let m = t.mark();
    t.send('/skills\r'); await t.see('[project (.agents/skills)]', m);
    expect(t.text().slice(m)).toContain('lint the project');
    m = t.mark();
    t.send('/mcp\r'); await t.see(/broken\s+failed\s+\S+/, m);
    t.send('/permissions restricted\r'); await t.see('permission mode is now restricted');
    t.send('\x04'); await t.exited;
  });
});

describe('-p, -c and --resume from the shell, with no daemon and no workspace', () => {
  it('prints only the final text and exits 0; the key is in no argv, output or session file', async () => {
    mock.script({ chunks: textChunks('the answer is 42') });
    const r = await runP([...flags(), '-p', 'what is it']);
    expect(r).toMatchObject({ code: 0, stdout: 'the answer is 42\n' });
    // only the loop's own one-line notice about the unknown context window: no events, no tool noise
    expect(r.stderr.trim().split('\n')).toEqual([expect.stringMatching(/^warn: the context window is unknown/)]);
    expect(mock.requests[0]!.headers['authorization']).toBe(`Bearer ${KEY}`);
    for (const f of sessionFiles()) expect(readFileSync(join(agentHome(), 'sessions', f), 'utf8')).not.toContain(KEY);
    expect([process.execPath, '--import', tsx, BIN, ...flags(), '-p', 'what is it'].join(' ')).not.toContain(KEY);
    expect(r.stdout + r.stderr).not.toContain(KEY);
  });

  it('exits non-zero with the error on stderr and nothing on stdout when the provider refuses the key', async () => {
    mock.script({ status: 401, body: JSON.stringify({ error: { message: 'bad key', type: 'invalid_request_error' } }) });
    const r = await runP([...flags(), '-p', 'hi']);
    expect(r.code).not.toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^error: /m);
    expect(r.stderr).not.toContain(KEY);
  });

  it('exits 2 and says what is missing when no provider or key is set', async () => {
    const none = await runP(['-p', 'hi']);
    expect(none).toMatchObject({ code: 2, stdout: '' });
    expect(none.stderr).toMatch(/no provider is configured/);
    expect(none.stderr).toContain('agent.yaml'); // VS-631: a first-run how-to, not just a refusal
    expect(none.stderr).toContain('apiKey');
    // a provider from a config file needs its key (a bare --base-url with no key is sent unauthenticated, for local endpoints)
    mkdirSync(join(dir, 'home', '.config', 'weave'), { recursive: true });
    writeFileSync(join(dir, 'home', '.config', 'weave', 'agent.yaml'), `provider: mock\nmodel: m1\nproviders:\n  mock:\n    baseUrl: ${mock.baseUrl}\n    apiKeySecret: WEAVE_LLM_MOCK_KEY\n`);
    const nokey = await runP(['-p', 'hi'], { WEAVE_LLM_MOCK_KEY: '' });
    expect(nokey.code).toBe(2);
    expect(nokey.stderr).toContain('WEAVE_LLM_MOCK_KEY');
    expect(mock.requests).toHaveLength(0);
  });

  it('-c continues the newest session here and --resume <id> resumes a named one, each carrying the earlier messages', async () => {
    mock.script({ chunks: textChunks('first reply') }, { chunks: textChunks('second reply') }, { chunks: textChunks('third reply') });
    expect((await runP([...flags(), '-p', 'remember the number 7'])).code).toBe(0);
    expect((await runP([...flags(), '-c', '-p', 'what number?'])).stdout).toBe('second reply\n');
    expect(bodyText(1)).toContain('remember the number 7');
    expect(bodyText(1)).toContain('first reply');
    expect(sessionFiles()).toHaveLength(1);
    const id = listSessions(agentHome(), { cwd: proj })[0]!.id;
    expect((await runP([...flags(), '--resume', id.slice(0, 8), '-p', 'and again'])).stdout).toBe('third reply\n');
    expect(bodyText(2)).toContain('what number?');
    expect(sessionFiles()).toHaveLength(1);
    expect((await runP([...flags(), '--resume', 'nosuch', '-p', 'x'])).code).toBe(2);
  });

  it('uses a provider defined only in the daemon\'s daemon.yaml, with no workspace and no agent.yaml (VS-633)', async () => {
    const cfgDir = join(dir, 'home', '.config', 'weave');
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(join(cfgDir, 'daemon.yaml'), `version: 1
providers:
  mock:
    baseUrl: ${mock.baseUrl}
    apiKeySecret: WEAVE_LLM_MOCK_KEY
    models:
      mock-model: {}
`);
    mock.script({ chunks: textChunks('daemon answer') });
    const r = await runP(['-p', 'go']);
    expect(r).toMatchObject({ code: 0, stdout: 'daemon answer\n' });
    expect(mock.requests[0]!.headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(r.stdout + r.stderr).not.toContain(KEY);
  });

  it('still refuses a literal apiKey outside the user file: one in daemon.yaml is skipped, not used (VS-633)', async () => {
    const cfgDir = join(dir, 'home', '.config', 'weave');
    mkdirSync(cfgDir, { recursive: true });
    const literal = 'sk-daemon-literal-must-not-work';
    writeFileSync(join(cfgDir, 'daemon.yaml'), `version: 1
providers:
  mock:
    baseUrl: ${mock.baseUrl}
    apiKey: ${literal}
    models:
      mock-model: {}
`);
    const r = await runP(['--provider', 'mock', '--model', 'mock-model', '-p', 'go'], { WEAVE_LLM_MOCK_KEY: '' });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('apiKey');
    expect(r.stdout + r.stderr).not.toContain(literal);
    expect(mock.requests).toHaveLength(0);
  });

  it('works from any directory with a literal apiKey in the user\'s agent.yaml and no workspace (VS-631)', async () => {
    const literal = 'sk-literal-user-config-31337';
    const cfgDir = join(dir, 'home', '.config', 'weave');
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(join(cfgDir, 'agent.yaml'), `provider: mock
model: mock-model
providers:
  mock:
    baseUrl: ${mock.baseUrl}
    apiKey: ${literal}
    models:
      mock-model: {}
`);
    mock.script({ chunks: textChunks('global answer') });
    const r = await runP(['-p', 'go', '--verbose'], { WEAVE_LLM_MOCK_KEY: '' });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('global answer\n');
    expect(mock.requests[0]!.headers['authorization']).toBe(`Bearer ${literal}`);
    expect(r.stdout).not.toContain(literal);
    expect(r.stderr).not.toContain(literal);
    const files = sessionFiles();
    expect(files).toHaveLength(1);
    expect(readFileSync(join(agentHome(), 'sessions', files[0]!), 'utf8')).not.toContain(literal);
  });

  it('--verbose shows the tool calls on stderr while stdout stays the final text alone', async () => {
    mock.script({ chunks: toolCallChunks([{ id: 'b1', name: 'bash', args: JSON.stringify({ command: 'echo verbose-out' }) }]) }, { chunks: textChunks('final words') });
    const r = await runP([...flags(), '-p', 'go', '--verbose']);
    expect(r.stdout).toBe('final words\n');
    expect(r.stdout).not.toContain('▸'); // every event line, tool calls included, is on stderr only
    expect(r.stderr).toContain('▸ bash  echo verbose-out');
    expect(r.code).toBe(0);
  });

  it('--context-window sets the run window so the unknown-window warning is not logged', async () => {
    mock.script({ chunks: textChunks('ok') });
    const r = await runP([...flags(), '--context-window', '4096', '-p', 'go']);
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain('context window is unknown');
  });

  it('--context-window refuses a non-positive value and sends nothing', async () => {
    const r = await runP([...flags(), '--context-window', '0', '-p', 'go']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/positive whole number/);
    expect(mock.requests).toHaveLength(0);
  });

  it('--help prints usage without needing anything', async () => {
    const r = await runP(['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('weave-agent');
    expect(r.stdout).toContain('--resume');
  });
});
