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
function spawnChild(): { child: ChildProcess; msgs: ChildMessage[]; exited: Promise<{ code: number | null; signal: string | null }>; stderr: () => string } {
  const child = spawn(process.execPath, ['--import', tsxLoader, join(here, 'bin.ts')], { cwd: dir, env: { PATH: process.env['PATH'] ?? '', HOME: dir }, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
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
});
