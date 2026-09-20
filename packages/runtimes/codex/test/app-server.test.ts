import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RuntimeEvent, RuntimePartial, TurnHandle, TurnInput } from '@weave-ai/runtime-sdk';
import { buildArgs } from '../src/args.js';
import { configOverrides, postureFor, runAppServerTurn } from '../src/app-server.js';
import { adapter } from '../src/adapter.js';
import { writeFakeAppServer, type AppServerScenario } from './appServerFake.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const fixture = (name: string): string => join(import.meta.dirname, 'fixtures', name);

type Sent = Record<string, any>;

function setup(scenario: AppServerScenario, o: { mode?: TurnInput['permission']['mode']; ref?: TurnInput['session']['ref']; replay?: string } = {}) {
  const fake = writeFakeAppServer(scenario, { replay: o.replay });
  const cwd = mkdtempSync(join(tmpdir(), 'ac-app-server-cwd-'));
  dirs.push(fake.dir, cwd);
  const input: TurnInput = {
    runId: `r-${scenario}`, turnEpoch: 1, cwd, worktree: null,
    session: { policy: 'resume', ref: o.ref ?? null, isFirstTurn: !o.ref },
    systemPrompt: { text: '', mode: 'skip' }, prompt: 'go',
    mcpServers: { 'weave-ai': { type: 'http', url: 'http://127.0.0.1:1/mcp', headers: { Authorization: 'Bearer tok' } } },
    env: { PATH: fake.dir }, options: {}, limits: { timeoutMs: 20_000 }, permission: { mode: o.mode ?? 'auto' },
  };
  const events: RuntimeEvent[] = [];
  const partials: RuntimePartial[] = [];
  const sink = { onSpawn: () => undefined, onEvent: (e: RuntimeEvent) => events.push(e), onRaw: () => undefined, onPartial: (p: RuntimePartial) => partials.push(p) };
  const built = buildArgs(input, { tmpDir: join(cwd, 'tmp') });
  let seq = 0;
  const run = (onHandle?: (h: TurnHandle) => void) => runAppServerTurn(input, sink, onHandle, built, () => seq++, { resumed: built.mode === 'resume', baseline: built.mode === 'new' ? undefined : { inputTokens: 200, outputTokens: 40, cachedInputTokens: 0 }, model: null });
  const client = (): Sent[] => (existsSync(fake.log) ? readFileSync(fake.log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Sent) : []);
  /** Our replies to the server's requests (ids 7 and up in the fake). */
  const replies = (): Record<number, unknown> => Object.fromEntries(client().filter((m) => m['id'] >= 7 && m['method'] === undefined).map((m) => [m['id'], m['result'] ?? m['error']]));
  return { fake, input, events, partials, run, client, replies, sink };
}

describe('runAppServerTurn', () => {
  it('streams partials, emits tool.call at start and the same completed events exec does', async () => {
    const t = setup('stream');
    const turn = await t.run();
    expect(turn).not.toBeNull();
    expect(turn!.outcome.exitCode).toBe(0);
    expect(turn!.threadId).toBe('thread-1');
    expect(t.partials).toEqual([
      { kind: 'tool_input', partId: 'c1:out', toolCallId: 'c1', text: 'a\n' },
      { kind: 'tool_input', partId: 'c1:out', toolCallId: 'c1', text: 'b\n' },
      { kind: 'text', partId: 'm1', text: 'Do' },
      { kind: 'text', partId: 'm1', text: 'ne' },
    ]);
    expect(t.events.map((e) => e.type)).toEqual(['session.started', 'turn.started', 'tool.call', 'tool.result', 'command.executed', 'assistant.text', 'usage.delta', 'turn.completed']);
    expect(t.events.find((e) => e.type === 'tool.call')!.payload).toMatchObject({ id: 'c1', name: 'command', input: { command: 'ls' } });
    expect(t.events.find((e) => e.type === 'tool.result')!.payload).toMatchObject({ id: 'c1', partId: 'c1:out', isError: false });
    expect(t.events.find((e) => e.type === 'assistant.text')!.payload).toMatchObject({ id: 'm1', partId: 'm1', text: 'Done' });
    expect(t.events.find((e) => e.type === 'usage.delta')!.payload).toMatchObject({ inputTokens: 100, outputTokens: 20, cachedInputTokens: 10 });
    expect(turn!.translator.state.finalText).toBe('Done');
  });

  it('starts the thread with the mode posture and the same -c overrides as exec', async () => {
    const t = setup('stream', { mode: 'restricted' });
    await t.run();
    expect(t.client().find((m) => m['method'] === 'thread/start')!['params']).toMatchObject({ cwd: t.input.cwd, sandbox: 'read-only', approvalPolicy: 'never' });
    expect(t.client().find((m) => m['method'] === 'turn/start')!['params'].input).toEqual([{ type: 'text', text: 'go', text_elements: [] }]);
    const argv = JSON.parse(readFileSync(join(t.fake.dir, 'argv.json'), 'utf8')) as string[];
    expect(argv[0]).toBe('app-server');
    expect(argv.join(' ')).toContain('mcp_servers.weave-ai.default_tools_approval_mode="approve"');
    expect(argv).not.toContain('exec');
  });

  it.each([
    ['auto', { sandbox: 'workspace-write', approvalPolicy: 'on-request' }],
    ['restricted', { sandbox: 'read-only', approvalPolicy: 'never' }],
    ['bypass', { sandbox: 'danger-full-access', approvalPolicy: 'never' }],
  ] as const)('posture for %s', (mode, want) => { expect(postureFor(mode)).toEqual(want); });

  it('answers approval requests by mode: auto declines escalations, accepts the run MCP server, errors on the unknown', async () => {
    const t = setup('approval', { mode: 'auto' });
    await t.run();
    const r = t.replies();
    expect(r[7]).toEqual({ decision: 'decline' });
    expect(r[8]).toEqual({ action: 'accept', content: null });
    expect(r[9]).toEqual({ action: 'decline', content: null });
    expect(r[10]).toMatchObject({ code: -32601 });
  });

  it('declines everything in restricted mode, including the run MCP server', async () => {
    const t = setup('approval', { mode: 'restricted' });
    await t.run();
    expect(t.replies()[7]).toEqual({ decision: 'decline' });
    expect(t.replies()[8]).toEqual({ action: 'decline', content: null });
  });

  it('accepts in bypass mode', async () => {
    const t = setup('approval', { mode: 'bypass' });
    await t.run();
    expect(t.replies()[7]).toEqual({ decision: 'accept' });
  });

  it('resumes by thread id without hydrating history, and forks', async () => {
    const r = setup('stream', { ref: { threadId: 'old-thread' } });
    const resumed = await r.run();
    expect(r.client().find((m) => m['method'] === 'thread/resume')!['params']).toMatchObject({ threadId: 'old-thread', excludeTurns: true });
    expect(resumed!.threadId).toBe('old-thread');
    expect(r.events[0]!.type).toBe('session.resumed');
    const f = setup('stream', { ref: { threadId: 'old-thread', fork: true } });
    const forked = await f.run();
    expect(f.client().find((m) => m['method'] === 'thread/fork')!['params']).toMatchObject({ threadId: 'old-thread' });
    expect(forked!.threadId).toBe('forked-thread');
  });

  it('falls back (null) when the server exits before answering, when the thread is rejected and when the turn is rejected', async () => {
    for (const scenario of ['exit', 'reject_thread', 'reject_turn'] as const) {
      const t = setup(scenario);
      expect(await t.run(), scenario).toBeNull();
      expect(t.partials, scenario).toEqual([]);
    }
  });

  it('a cut-off stream is a failed turn, not a fallback: the prompt is never run twice', async () => {
    const t = setup('cutoff');
    const turn = await t.run();
    expect(turn).not.toBeNull();
    expect(turn!.outcome.exitCode).toBe(1);
    expect(turn!.outcome.stderr).toContain('connection reset');
    expect(turn!.translator.state.completed).toBe(false);
    expect(t.partials).toEqual([{ kind: 'text', partId: 'm1', text: 'par' }]);
    expect(t.events.some((e) => e.type === 'assistant.text')).toBe(false);
  });

  it('cancel interrupts the turn, then ends the process', async () => {
    const t = setup('hang');
    let handle: TurnHandle | undefined;
    const done = t.run((h) => { handle = h; });
    for (let i = 0; i < 200 && t.partials.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    expect(t.partials).toEqual([{ kind: 'text', partId: 'm1', text: 'thinking' }]);
    await handle!.cancel('interrupt');
    const turn = await done;
    expect(t.client().some((m) => m['method'] === 'turn/interrupt' && m['params'].turnId === 'turn-1')).toBe(true);
    expect(turn).not.toBeNull();
    expect(t.events.some((e) => e.type === 'error' && /interrupted/.test(String(e.payload['message'])))).toBe(true);
  });

  it('replays recorded traffic: stream fixture', async () => {
    const t = setup('replay', { replay: fixture('app-server-stream.jsonl') });
    const turn = await t.run();
    expect(turn!.outcome.exitCode).toBe(0);
    expect(t.events.map((e) => e.type).filter((x) => x !== 'runtime.raw')).toEqual(['session.started', 'turn.started', 'tool.call', 'tool.result', 'command.executed', 'assistant.text', 'usage.delta', 'turn.completed']);
    expect(t.events.find((e) => e.type === 'tool.call')!.payload['input']).toMatchObject({ command: expect.stringContaining('echo line') });
    expect(t.partials.filter((p) => p.kind === 'text').map((p) => p.text).join('')).toBe('All three lines printed.');
    expect(t.partials.filter((p) => p.kind === 'tool_input').length).toBeGreaterThanOrEqual(2);
    expect(t.events.find((e) => e.type === 'assistant.text')!.payload['text']).toBe('All three lines printed.');
  });

  it('replays recorded traffic: a declined escalation still completes the turn', async () => {
    const t = setup('replay', { replay: fixture('app-server-escalate.jsonl') });
    const turn = await t.run();
    expect(turn!.outcome.exitCode).toBe(0);
    expect(t.events.find((e) => e.type === 'tool.result')!.payload).toMatchObject({ status: 'declined', isError: true });
  });

  it("replays recorded traffic: a resumed thread ignores the earlier turn's replayed usage", async () => {
    const t = setup('replay', { replay: fixture('app-server-resume.jsonl'), ref: { threadId: 'x' } });
    const turn = await t.run();
    expect(turn!.outcome.exitCode).toBe(0);
    const usage = t.events.filter((e) => e.type === 'usage.delta');
    expect(usage).toHaveLength(1);
    expect(usage[0]!.payload).toMatchObject({ inputTokens: 100, outputTokens: 20 });
  });
});

describe('configOverrides', () => {
  it('keeps every -c pair and nothing else', () => {
    expect(configOverrides(['exec', '--json', '-c', 'a=1', '-m', 'x', '-c', 'b="2"', '-'])).toEqual(['-c', 'a=1', '-c', 'b="2"']);
  });
});

describe('adapter turn', () => {
  it('declares full partial output, as the shared table the page reads says', () => {
    expect(adapter.capabilities.partialOutput).toBe('full');
  });

  it('drives the turn through the app-server and reports the thread as the session', async () => {
    const t = setup('stream');
    const result = await adapter.runTurn(t.input, t.sink, () => undefined);
    expect(existsSync(join(t.fake.dir, 'exec-ran'))).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.session).toMatchObject({ threadId: 'thread-1' });
    expect(result.finalText).toBe('Done');
    expect(result.error).toBeUndefined();
    expect(t.partials.length).toBeGreaterThan(0);
  });

  it('falls back to exec when the server does not start, and honours options.appServer=false', async () => {
    const down = setup('exit');
    await adapter.runTurn(down.input, down.sink, () => undefined);
    expect(readFileSync(join(down.fake.dir, 'exec-ran'), 'utf8')).toContain('exec');
    const off = setup('stream');
    await adapter.runTurn({ ...off.input, options: { appServer: false } }, off.sink, () => undefined);
    expect(readFileSync(join(off.fake.dir, 'exec-ran'), 'utf8')).toContain('exec');
    expect(off.client().some((m) => m['method'] === 'initialize')).toBe(false);
  });
});
