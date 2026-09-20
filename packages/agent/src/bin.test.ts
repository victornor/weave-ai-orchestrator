import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChildMessage, ChildResult, InitMessage } from './protocol.js';
import { Session } from './session.js';
import { startMockProvider, textChunks, toolCallChunks, type MockProvider } from './testkit/mockProvider.js';

const KEY = 'sk-e2e-secret-key-456';
const here = dirname(fileURLToPath(import.meta.url));
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href;
let dir: string; let mock: MockProvider; const kids: ChildProcess[] = [];
beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), 'wa-bin-')); mkdirSync(join(dir, 'wt')); mock = await startMockProvider(); });
afterEach(async () => { for (const k of kids.splice(0)) { try { if (k.pid) process.kill(-k.pid, 'SIGKILL'); } catch { /* gone */ } } await mock.close(); rmSync(dir, { recursive: true, force: true }); });

const init = (prompt = 'go'): InitMessage => ({
  type: 'init', v: 1,
  run: { runId: 'run-e2e', turnEpoch: 1, cwd: dir, worktree: { path: join(dir, 'wt'), branch: 'b' }, limits: { timeoutMs: 600_000 }, permission: { mode: 'auto' }, model: 'mock-model', options: {}, spillDir: join(dir, 'spill') },
  provider: { id: 'mock', baseUrl: mock.baseUrl, auth: 'bearer', headers: {}, apiKey: KEY }, prompt, systemPrompt: { text: '', mode: 'skip' },
  session: { path: join(dir, 's.jsonl'), id: 'e2e' }, mcpServers: {}, toolEnv: { PATH: process.env['PATH'] ?? '' },
});

/** Spawn the real child entry exactly as the adapter does: own process group, init on stdin, NDJSON on stdout. */
function spawnChild(args: string[] = []): { child: ChildProcess; msgs: ChildMessage[]; exited: Promise<{ code: number | null; signal: string | null }>; stderr: () => string } {
  const child = spawn(process.execPath, ['--import', tsxLoader, join(here, 'bin.ts'), ...args], { cwd: dir, env: { PATH: process.env['PATH'] ?? '', HOME: dir }, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  kids.push(child);
  const msgs: ChildMessage[] = []; let buf = ''; let err = '';
  child.stdout!.on('data', (c: Buffer) => { buf += c.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { msgs.push(JSON.parse(buf.slice(0, i)) as ChildMessage); buf = buf.slice(i + 1); } });
  child.stderr!.on('data', (c: Buffer) => { err += c.toString(); });
  return { child, msgs, stderr: () => err, exited: new Promise((res) => child.on('close', (code, signal) => res({ code, signal }))) };
}
const resultOf = (msgs: ChildMessage[]): ChildResult => (msgs.find((m) => m.t === 'result') as { result: ChildResult }).result;
const until = async (cond: () => boolean): Promise<void> => { const end = Date.now() + 15_000; while (!cond()) { if (Date.now() > end) throw new Error(`condition never arrived; child stderr: ${kids.length ? 'see test' : ''}`); await new Promise((r) => setTimeout(r, 10)); } };

describe('child process', () => {
  it('runs a turn: stdout is only protocol lines, one result, exit 0; the key is in neither argv nor env', async () => {
    mock.script({ chunks: textChunks('hi from the child'), delayMs: 400 });
    const c = spawnChild();
    c.child.stdin!.write(`${JSON.stringify(init())}\n`);
    await until(() => mock.requests.length === 1);
    const pid = c.child.pid!;
    expect(readFileSync(`/proc/${pid}/cmdline`, 'utf8')).not.toContain(KEY);
    expect(readFileSync(`/proc/${pid}/environ`, 'utf8')).not.toContain(KEY);
    const { code } = await c.exited;
    expect(code).toBe(0);
    expect(c.msgs.filter((m) => m.t === 'result')).toHaveLength(1);
    expect(resultOf(c.msgs)).toMatchObject({ exitCode: 0, finalText: 'hi from the child' });
    expect(c.msgs.some((m) => m.t === 'event' && m.ev.type === 'turn.completed')).toBe(true);
    expect(mock.requests[0]!.headers['authorization']).toBe(`Bearer ${KEY}`);
  });

  it('is its own process-group leader, so a group kill ends tool subprocesses too', async () => {
    mock.script({ chunks: toolCallChunks([{ id: 'b1', name: 'bash', args: '{"command":"sleep 60 & echo $! > pid; wait"}' }]) });
    const c = spawnChild();
    c.child.stdin!.write(`${JSON.stringify(init())}\n`);
    const pidFile = join(dir, 'wt', 'pid');
    await until(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '');
    const tool = Number(readFileSync(pidFile, 'utf8').trim());
    const pgid = Number(readFileSync(`/proc/${c.child.pid}/stat`, 'utf8').split(') ')[1]!.split(' ')[2]);
    expect(pgid).toBe(c.child.pid);
    expect(() => process.kill(tool, 0)).not.toThrow();
    process.kill(-pgid, 'SIGKILL');
    const { signal } = await c.exited;
    expect(signal).toBe('SIGKILL');
    await until(() => { try { process.kill(tool, 0); return false; } catch { return true; } });
  });

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    it(`${sig} during a tool: exit 143, a result line, and a loadable session`, async () => {
      mock.script({ chunks: toolCallChunks([{ id: 'b1', name: 'bash', args: '{"command":"sleep 60"}' }]) });
      const c = spawnChild();
      c.child.stdin!.write(`${JSON.stringify(init())}\n`);
      await until(() => c.msgs.some((m) => m.t === 'event' && m.ev.type === 'tool.call'));
      process.kill(c.child.pid!, sig);
      const { code } = await c.exited;
      expect(code).toBe(143);
      expect(resultOf(c.msgs)).toMatchObject({ exitCode: 143, signal: 'SIGTERM' });
      const s = Session.open({ path: join(dir, 's.jsonl'), id: 'e2e', cwd: dir });
      expect(s.messages.at(-1)).toMatchObject({ role: 'toolResult', toolCallId: 'b1' });
      s.close();
    });
  }

  it('a cancel message on stdin behaves like a signal', async () => {
    mock.script({ stall: true });
    const c = spawnChild();
    c.child.stdin!.write(`${JSON.stringify(init())}\n`);
    await until(() => mock.requests.length === 1);
    c.child.stdin!.write(`${JSON.stringify({ type: 'cancel', mode: 'interrupt' })}\n`);
    expect((await c.exited).code).toBe(143);
  });

  it('a send message on stdin keeps the turn going and reaches the next request', async () => {
    mock.script({ chunks: textChunks('first'), delayMs: 400 }, { chunks: textChunks('second') });
    const c = spawnChild();
    c.child.stdin!.write(`${JSON.stringify(init())}\n`);
    await until(() => mock.requests.length === 1);
    c.child.stdin!.write(`${JSON.stringify({ type: 'send', text: 'steer me' })}\n`);
    const { code } = await c.exited;
    expect(code).toBe(0);
    expect(resultOf(c.msgs)).toMatchObject({ exitCode: 0, finalText: 'second' });
    expect(mock.requests).toHaveLength(2);
    const msgs = mock.requests[1]!.body['messages'] as Array<{ role: string; content: string }>;
    expect(msgs.some((m) => m.role === 'user' && m.content === 'steer me')).toBe(true);
  });
});

describe('child process, compact mode', () => {
  it('summarises a stored session and exits 0 with one result, sending no tools', async () => {
    const s = Session.open({ path: join(dir, 's.jsonl'), id: 'e2e', cwd: dir });
    for (let i = 0; i < 20; i++) {
      s.append({ role: 'user', text: `q${i} ${'lorem ipsum '.repeat(80)}` });
      s.append({ role: 'assistant', content: [{ type: 'text', text: `a${i} ${'dolor sit '.repeat(80)}` }] });
    }
    s.close();
    mock.script({ chunks: textChunks('## Goal\ncompacted by the child') });
    const c = spawnChild(['--compact']);
    c.child.stdin!.write(`${JSON.stringify({ ...init(''), mode: undefined, provider: { ...init().provider, params: { contextWindowTokens: 4000 } } })}\n`);
    const { code } = await c.exited;
    expect(code).toBe(0);
    expect(c.msgs.filter((m) => m.t === 'result')).toHaveLength(1);
    const r = resultOf(c.msgs);
    expect(r.compaction).toMatchObject({ ok: true });
    expect(r.compaction!.tokensAfter!).toBeLessThan(r.compaction!.tokensBefore!);
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]!.body['tools']).toBeUndefined();
    const again = Session.open({ path: join(dir, 's.jsonl'), id: 'e2e', cwd: dir });
    expect((again.context()[0] as { text: string }).text).toContain('compacted by the child');
    again.close();
  });
  it('exits 0 with ok:false when there is nothing to summarise, and 1 with a tooling error when the summary fails', async () => {
    const empty = spawnChild(['--compact']);
    empty.child.stdin!.write(`${JSON.stringify(init(''))}\n`);
    expect((await empty.exited).code).toBe(0);
    expect(resultOf(empty.msgs).compaction).toMatchObject({ ok: false, reason: 'nothing to summarise' });

    const s = Session.open({ path: join(dir, 's.jsonl'), id: 'e2e', cwd: dir });
    for (let i = 0; i < 10; i++) { s.append({ role: 'user', text: `q${i} ${'lorem '.repeat(200)}` }); s.append({ role: 'assistant', content: [{ type: 'text', text: 'ok '.repeat(200) }] }); }
    s.close();
    mock.script({ status: 400, body: '{"error":{"message":"nope","code":"invalid"}}' });
    const bad = spawnChild(['--compact']);
    bad.child.stdin!.write(`${JSON.stringify({ ...init(''), provider: { ...init().provider, params: { contextWindowTokens: 4000 } } })}\n`);
    expect((await bad.exited).code).toBe(1);
    expect(resultOf(bad.msgs).error).toMatchObject({ code: 'compaction_failed', family: 'tooling' });
  });
});
