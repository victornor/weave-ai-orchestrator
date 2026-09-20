import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChildEvent } from '../protocol.js';
import { Session } from '../session.js';
import { startMockProvider, textChunks, type MockProvider } from '../testkit/mockProvider.js';
import { loadReplConfig } from './config.js';
import { startup } from './main.js';
import { buildReplInit, runReplTurn, skillRootsFor, type ReplState } from './run.js';
import { listSessions, newSessionId, sessionPath } from './sessions.js';

const KEY = 'sk-repl-secret-key-789';
let dir: string; let cwd: string; let home: string; let mock: MockProvider;
beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), 'wa-repl-run-')); cwd = join(dir, 'proj'); home = join(dir, 'home'); mkdirSync(cwd); mkdirSync(home); mock = await startMockProvider(); });
afterEach(async () => { await mock.close(); rmSync(dir, { recursive: true, force: true }); });

const cfg = () => loadReplConfig({ flags: { provider: 'mock', baseUrl: mock.baseUrl, model: 'mock-model' }, env: { WEAVE_LLM_MOCK_KEY: KEY }, cwd, home: dir });
const state = (over: Partial<ReplState> = {}): ReplState => { const id = newSessionId(); return { providerId: 'mock', model: 'mock-model', permission: 'auto', effort: null, params: {}, sessionId: id, sessionPath: sessionPath(home, id), ...over }; };
const io = (events: ChildEvent[] = []) => ({ emit: (e: ChildEvent) => events.push(e), partial: () => undefined, log: () => undefined });
const t = () => ({ cwd, homeDir: home, env: { PATH: process.env['PATH'] ?? '', HOME: dir, WEAVE_LLM_MOCK_KEY: KEY } as NodeJS.ProcessEnv, userHome: dir });

describe('a REPL turn on the shared loop', () => {
  it('runs in this process: the request carries the prompt and the key, the session is marked repl and listed, no daemon involved', async () => {
    mock.script({ chunks: textChunks('hello there') });
    const s = state();
    const r = await runReplTurn(s, cfg(), 'say hi', t(), io(), new AbortController().signal);
    expect(r).toMatchObject({ exitCode: 0, finalText: 'hello there' });
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]!.headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify(mock.requests[0]!.body)).toContain('say hi');
    const listed = listSessions(home, { cwd });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: s.sessionId, firstPrompt: 'say hi', model: 'mock-model', provider: 'mock' });
    expect(readFileSync(s.sessionPath, 'utf8')).not.toContain(KEY);
  });

  it('resumes: the next request body contains the earlier messages', async () => {
    mock.script({ chunks: textChunks('first answer') }, { chunks: textChunks('second answer') });
    const s = state();
    await runReplTurn(s, cfg(), 'question one', t(), io(), new AbortController().signal);
    await runReplTurn(s, cfg(), 'question two', t(), io(), new AbortController().signal);
    const body = JSON.stringify(mock.requests[1]!.body);
    expect(body).toContain('question one');
    expect(body).toContain('first answer');
    expect(body).toContain('question two');
  });

  it('refuses with exit code 2 and a reason when there is no key, an unknown provider or an invalid option, sending nothing', async () => {
    const noKey = await runReplTurn(state(), cfg(), 'x', { ...t(), env: { PATH: '' } }, io(), new AbortController().signal);
    expect(noKey).toMatchObject({ exitCode: 2, error: { code: 'repl_config' } });
    expect(noKey.error?.message).toContain('WEAVE_LLM_MOCK_KEY');
    expect((await runReplTurn(state({ providerId: 'nope' }), cfg(), 'x', t(), io(), new AbortController().signal)).error?.message).toContain('no provider "nope"');
    const bad = await runReplTurn(state({ params: { temperature: 9 } }), cfg(), 'x', t(), io(), new AbortController().signal);
    expect(bad.error?.message).toMatch(/temperature/);
    expect(mock.requests).toHaveLength(0);
  });

  it('keeps the key out of the tool environment and the session, and sends an unset parameter as absent', async () => {
    const b = buildReplInit(state(), cfg(), 'p', t());
    if (!b.ok) throw new Error(b.error);
    expect(JSON.stringify(b.init.toolEnv)).not.toContain(KEY);
    expect(Object.keys(b.init.toolEnv).sort()).toEqual(['HOME', 'PATH']);
    mock.script({ chunks: textChunks('ok') });
    await runReplTurn(state(), cfg(), 'p', t(), io(), new AbortController().signal);
    expect(mock.requests[0]!.body).not.toHaveProperty('temperature');
  });

  it('reads the cwd AGENTS.md into the system prompt and the skills from project then user roots, project winning', async () => {
    writeFileSync(join(cwd, 'AGENTS.md'), 'Always answer in haiku.');
    for (const [root, desc] of [[join(cwd, '.agents', 'skills', 'lint'), 'project lint'], [join(dir, '.agents', 'skills', 'lint'), 'user lint'], [join(dir, '.agents', 'skills', 'deploy'), 'user deploy']] as const) {
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'SKILL.md'), `---\nname: ${root.endsWith('deploy') ? 'deploy' : 'lint'}\ndescription: ${desc}\n---\nbody\n`);
    }
    mock.script({ chunks: textChunks('ok') });
    await runReplTurn(state(), cfg(), 'p', t(), io(), new AbortController().signal);
    const sys = JSON.stringify(mock.requests[0]!.body);
    expect(sys).toContain('Always answer in haiku.');
    expect(sys).toContain('lint: project lint');
    expect(sys).toContain('deploy: user deploy');
    expect(sys).not.toContain('user lint');
    expect(skillRootsFor(cwd, dir, {}).map((r) => r.source)[0]).toBe('project (.agents/skills)');
  });

  it('a cancelled turn leaves a loadable session and exit code 143', async () => {
    mock.script({ chunks: textChunks('never finishes'), stall: true });
    const ac = new AbortController();
    const s = state();
    const p = runReplTurn(s, cfg(), 'long', t(), io(), ac.signal);
    const end = Date.now() + 5000; while (mock.requests.length === 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 5));
    ac.abort();
    expect((await p).exitCode).toBe(143);
    const reopened = Session.open({ path: s.sessionPath, id: s.sessionId, cwd });
    expect(reopened.messages[0]).toMatchObject({ role: 'user' });
    reopened.close();
  });
});

describe('--context-window (VS-631)', () => {
  const mkIo = (env: NodeJS.ProcessEnv) => ({ stdout: (): void => undefined, stderr: (): void => undefined, env, cwd, userHome: dir });
  it('seeds the run\'s contextWindowTokens and refuses anything but a positive whole number', () => {
    const env = { PATH: process.env['PATH'] ?? '', HOME: dir, WEAVE_LLM_MOCK_KEY: KEY } as NodeJS.ProcessEnv;
    const good = startup({ provider: 'mock', baseUrl: mock.baseUrl, model: 'mock-model', contextWindow: '128000' }, mkIo(env));
    if (!good.ok) throw new Error(good.message);
    expect(good.state.params).toEqual({ contextWindowTokens: 128000 });
    for (const bad of ['0', '-5', 'lots']) {
      const r = startup({ provider: 'mock', baseUrl: mock.baseUrl, model: 'mock-model', contextWindow: bad }, mkIo(env));
      expect(r).toMatchObject({ ok: false });
      if (!r.ok) expect(r.message).toMatch(/positive whole number/);
    }
  });
  it('flows into the run provider params, which the loop reads as its options', () => {
    const b = buildReplInit(state({ params: { contextWindowTokens: 128000 } }), cfg(), 'p', t());
    if (!b.ok) throw new Error(b.error);
    expect(b.init.provider.params?.contextWindowTokens).toBe(128000);
  });
});
