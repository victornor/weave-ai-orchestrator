import { describe, expect, it } from 'vitest';
import type { RunEvent, RunEventType } from '@weave-ai/shared';
import { chatTranscript, runEventsToTranscript } from './transcript.js';
import type { FileBlock, HumanInputBlock, PhaseBlock, StatusBlock, TextBlock, ToolBlock } from './types.js';

let seq = 0;
function ev(type: RunEventType, payload: Record<string, unknown>, ts = '2026-09-04T12:00:00.000Z'): RunEvent {
  seq += 1;
  return { id: `e${seq}`, runId: 'run_1', seq, ts, type, stream: 'stdout', level: 'info', payload };
}
function reset() { seq = 0; }

describe('runEventsToTranscript', () => {
  it('returns an empty transcript for empty/missing input', () => {
    expect(runEventsToTranscript([])).toEqual([]);
    expect(runEventsToTranscript(null)).toEqual([]);
    expect(runEventsToTranscript(undefined)).toEqual([]);
  });

  it('merges adjacent assistant text into one block', () => {
    reset();
    const blocks = runEventsToTranscript([
      ev('assistant.text', { text: 'Rebased onto main.' }),
      ev('assistant.text', { text: 'Now running the tests.' }),
    ]);
    expect(blocks).toHaveLength(1);
    const b = blocks[0] as TextBlock;
    expect(b.kind).toBe('text');
    expect(b.text).toBe('Rebased onto main.\n\nNow running the tests.');
    expect(b.eventIds).toEqual(['e1', 'e2']);
  });

  it('does not merge text across a tool call', () => {
    reset();
    const blocks = runEventsToTranscript([
      ev('assistant.text', { text: 'Reading the tokens.' }),
      ev('tool.call', { name: 'Read', id: 'c1', input: { file_path: 'src/theme/tokens.ts' } }),
      ev('tool.result', { id: 'c1', output: 'ok' }),
      ev('assistant.text', { text: 'Done.' }),
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(['text', 'tool', 'text']);
  });

  it('keeps thinking separate from assistant text', () => {
    reset();
    const blocks = runEventsToTranscript([
      ev('assistant.thinking', { text: 'weighing options' }),
      ev('assistant.text', { text: 'I will rebase.' }),
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(['thinking', 'text']);
  });

  it('folds tool.call + tool.result into one collapsible block with name, target and duration', () => {
    reset();
    const blocks = runEventsToTranscript([
      ev('tool.call', { name: 'Read', id: 'c1', input: { file_path: 'src/theme/tokens.ts' } }, '2026-09-04T12:00:00.000Z'),
      ev('tool.result', { id: 'c1', output: 'export const tokens = {}' }, '2026-09-04T12:00:00.400Z'),
    ]);
    expect(blocks).toHaveLength(1);
    const t = blocks[0] as ToolBlock;
    expect(t.kind).toBe('tool');
    expect(t.name).toBe('Read');
    expect(t.target).toBe('src/theme/tokens.ts');
    expect(t.status).toBe('ok');
    expect(t.durationMs).toBe(400);
    expect(t.collapsed).toBe('Read src/theme/tokens.ts 400ms');
    expect(t.detail).toBe('export const tokens = {}');
    expect(t.eventIds).toEqual(['e1', 'e2']);
  });

  it('prefers a reported duration over wall clock and marks errors', () => {
    reset();
    const blocks = runEventsToTranscript([
      ev('tool.call', { name: 'Bash', callId: 'x', input: { command: 'pnpm test' } }),
      ev('tool.result', { callId: 'x', isError: true, durationMs: 252_000, output: '1 failing' }),
    ]);
    const t = blocks[0] as ToolBlock;
    expect(t.status).toBe('error');
    expect(t.durationMs).toBe(252_000);
    expect(t.collapsed).toBe('Bash pnpm test failed 4m12s');
  });

  it('marks denied tools', () => {
    reset();
    const blocks = runEventsToTranscript([
      ev('tool.call', { name: 'Bash', id: 'd1', input: { command: 'rm -rf /' } }),
      ev('tool.denied', { id: 'd1', reason: 'blocked by policy' }),
    ]);
    expect((blocks[0] as ToolBlock).status).toBe('denied');
    expect((blocks[0] as ToolBlock).collapsed).toContain('denied');
  });

  it('leaves a tool without a result pending instead of dropping it', () => {
    reset();
    const blocks = runEventsToTranscript([ev('tool.call', { name: 'Grep', id: 'g1', input: { pattern: 'TODO' } })]);
    const t = blocks[0] as ToolBlock;
    expect(t.status).toBe('pending');
    expect(t.durationMs).toBeNull();
    expect(t.target).toBe('TODO');
  });

  it('renders an orphan tool.result on its own', () => {
    reset();
    const blocks = runEventsToTranscript([ev('tool.result', { id: 'unknown', name: 'Read', output: 'x' })]);
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as ToolBlock).name).toBe('Read');
  });

  it('turns file.changed into a diff block with counters', () => {
    reset();
    const blocks = runEventsToTranscript([
      ev('file.changed', { path: '/home/user/ws/workers/w1/work/src/theme/tokens.ts', changeType: 'modified', additions: 18, deletions: 2, diff: '@@ -1 +1 @@\n-a\n+b' }),
    ]);
    const f = blocks[0] as FileBlock;
    expect(f.kind).toBe('file');
    expect(f.path).toBe('…/theme/tokens.ts');
    expect(f.changeType).toBe('modified');
    expect(f.diffStat).toBe('+18 −2');
    expect(f.collapsed).toBe('Edit …/theme/tokens.ts +18 −2');
    expect(f.diff).toContain('@@');
  });

  it('renders a phase line from run.phase.timing, folding in usage deltas', () => {
    reset();
    const blocks = runEventsToTranscript([
      ev('usage.delta', { inputTokens: 18_000, outputTokens: 400 }),
      ev('run.phase.timing', { phase: 'turn', durationMs: 252_000 }),
    ]);
    const p = blocks[0] as PhaseBlock;
    expect(p.kind).toBe('phase');
    expect(p.text).toBe('phase: turn · 4m12s · 18.4k tok');
  });

  it('renders supervisor.action as a status line', () => {
    reset();
    const blocks = runEventsToTranscript([ev('supervisor.action', { action: 'nudged_worker', reason: 'no progress for 10m' })]);
    const s = blocks[0] as StatusBlock;
    expect(s.kind).toBe('status');
    expect(s.text).toBe('supervisor: nudged worker — no progress for 10m');
    expect(s.tone).toBe('warn');
  });

  it('renders the waiting question status line', () => {
    reset();
    const blocks = runEventsToTranscript(
      [ev('user_input.requested', { question: 'Postgres or SQLite?' }, '2026-09-04T11:58:00.000Z')],
      { now: new Date('2026-09-04T12:00:00.000Z') },
    );
    expect((blocks[0] as StatusBlock).text).toBe('asked you a question: Postgres or SQLite? · waiting 2m00s');
  });

  it('redacts secrets in text, tool output and file diffs', () => {
    reset();
    const blocks = runEventsToTranscript([
      ev('assistant.text', { text: 'exporting AC_RUN_TOKEN=rt_abcdefghijklmnop' }),
      ev('tool.call', { name: 'Bash', id: 'c', input: { command: 'curl -H "Authorization: Bearer abcdefghijklmnop"' } }),
      ev('tool.result', { id: 'c', output: 'sk-ant-api03-AAAAbbbbCCCCddddEEEE' }),
    ]);
    expect((blocks[0] as TextBlock).text).toBe('exporting AC_RUN_TOKEN=rt_[redacted]');
    expect((blocks[1] as ToolBlock).target).toContain('Bearer [redacted]');
    expect((blocks[1] as ToolBlock).detail).toBe('sk-[redacted]');
  });

  it('can be told not to redact', () => {
    reset();
    const blocks = runEventsToTranscript([ev('assistant.text', { text: 'rt_abcdefghijklmnop' })], { redact: false });
    expect((blocks[0] as TextBlock).text).toBe('rt_abcdefghijklmnop');
  });

  it('truncates long tool output', () => {
    reset();
    const blocks = runEventsToTranscript([
      ev('tool.call', { name: 'Bash', id: 'c', input: { command: 'ls' } }),
      ev('tool.result', { id: 'c', output: 'x'.repeat(5000) }),
    ], { maxDetailChars: 100 });
    const t = blocks[0] as ToolBlock;
    expect(t.detailTruncated).toBe(true);
    expect(t.detail!.length).toBeLessThan(200);
  });

  it('sorts by seq and ignores runtime.raw and unknown payload shapes', () => {
    reset();
    const a = ev('assistant.text', { text: 'Second.' });
    const b = ev('assistant.text', { text: 'First.' });
    b.seq = 0;
    const blocks = runEventsToTranscript([a, b, ev('runtime.raw', { line: 'noise' })]);
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as TextBlock).text).toBe('First.\n\nSecond.');
  });

  it('never crashes on missing fields', () => {
    reset();
    const broken = [
      { id: 'x', runId: 'r', seq: 1, ts: '', type: 'tool.call', stream: '', level: '', payload: {} },
      { id: 'y', runId: 'r', seq: 2, ts: '', type: 'file.changed', stream: '', level: '', payload: {} },
      { id: 'z', runId: 'r', seq: 3, ts: '', type: 'error', stream: '', level: '', payload: {} },
      null,
    ] as unknown as RunEvent[];
    const blocks = runEventsToTranscript(broken);
    expect(blocks.map((b) => b.kind)).toEqual(['tool', 'file', 'error']);
    expect((blocks[0] as ToolBlock).name).toBe('tool');
    expect((blocks[1] as FileBlock).path).toBe('unknown file');
  });

  it('renders an orphan command.executed like a shell tool block', () => {
    reset();
    const blocks = runEventsToTranscript([ev('command.executed', { command: 'pnpm vitest', exitCode: 1, durationMs: 4400, stdout: '38/41 passed' })]);
    const t = blocks[0] as ToolBlock;
    expect(t.name).toBe('shell');
    expect(t.status).toBe('error');
    expect(t.collapsed).toBe('shell pnpm vitest exit 1 failed 4.4s');
  });

  // VS-205: Claude (and Gemini, Cursor) send `command.executed` on top of tool.call/tool.result
  // for every shell call, without the command text — rendered on its own it used to produce a
  // bare "shell" second row (the transcript's "$" line with nothing after it). The payloads below
  // are the exact shapes `packages/runtimes/claude/test/events.test.ts` pins for the real
  // recorded `packages/runtimes/claude/fixtures/turn-tool-structured.jsonl` (its `Bash` "echo
  // pong" call, lines 6-7) — see that test for the stream-json round trip.
  it('folds a real Claude command.executed into its tool.call/tool.result row instead of a second one (VS-205)', () => {
    reset();
    const blocks = runEventsToTranscript([
      ev('tool.call', { id: 'toolu_01CDEhHFYnKmzdtoUb7kxquE', name: 'Bash', input: { command: 'echo pong', description: 'Run echo pong command' } }),
      ev('tool.result', { id: 'toolu_01CDEhHFYnKmzdtoUb7kxquE', name: 'Bash', isError: false, content: 'pong' }),
      ev('command.executed', { toolUseId: 'toolu_01CDEhHFYnKmzdtoUb7kxquE', tool: 'Bash', stdout: 'pong', stderr: '', isError: false }),
    ]);
    expect(blocks).toHaveLength(1);
    const t = blocks[0] as ToolBlock;
    expect(t.name).toBe('Bash');
    expect(t.target).toBe('echo pong');
    expect(t.detail).toBe('pong');
    expect(t.status).toBe('ok');
    expect(t.eventIds).toEqual(['e1', 'e2', 'e3']);
  });

  it('backfills a missing result from command.executed instead of duplicating it (VS-205)', () => {
    reset();
    const blocks = runEventsToTranscript([
      ev('tool.call', { id: 'c1', name: 'Bash', input: { command: 'pnpm build' } }),
      ev('command.executed', { toolUseId: 'c1', tool: 'Bash', stdout: 'build ok', exitCode: 1 }),
    ]);
    expect(blocks).toHaveLength(1);
    const t = blocks[0] as ToolBlock;
    expect(t.detail).toBe('build ok');
    expect(t.status).toBe('error');
    expect(t.collapsed).toBe('Bash pnpm build exit 1 failed');
  });

  it('renders lifecycle and error events', () => {
    reset();
    const blocks = runEventsToTranscript([
      ev('run.started', { runtimeId: 'claude', model: 'claude-fable-5-1' }),
      ev('turn.started', { turn: 3 }),
      ev('error', { message: 'runtime unreachable', code: 'runtime_unreachable', retryable: true }),
      ev('run.finalized', { status: 'failed', summary: 'gave up' }),
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(['status', 'status', 'error', 'status']);
    expect((blocks[0] as StatusBlock).text).toBe('run started · claude · claude-fable-5-1');
    expect((blocks[1] as StatusBlock).text).toBe('turn 3 started');
    expect((blocks[3] as StatusBlock).tone).toBe('error');
  });

  it('renders a human message as its own attributed block, carrying its delivery (VS-99)', () => {
    reset();
    const blocks = runEventsToTranscript([
      ev('human.input', { text: 'check the failing test', authorKind: 'human', authorId: 'victor', delivery: 'mid_turn' }),
      ev('human.input', { text: 'later is fine', authorKind: 'human', authorId: 'victor', delivery: 'queued' }),
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(['human_input', 'human_input']);
    const mid = blocks[0] as HumanInputBlock;
    expect(mid).toMatchObject({ text: 'check the failing test', authorKind: 'human', delivery: 'mid_turn' });
    const queued = blocks[1] as HumanInputBlock;
    expect(queued.delivery).toBe('queued');
  });

  it('redacts a secret in a human message like anything else on the wire', () => {
    reset();
    const blocks = runEventsToTranscript([ev('human.input', { text: 'use sk-live-abcdef1234567890abcdef', authorKind: 'human', authorId: 'victor', delivery: 'queued' })]);
    const block = blocks[0] as HumanInputBlock;
    expect(block.text).not.toContain('sk-live-abcdef1234567890abcdef');
  });
});

describe('chatTranscript', () => {
  it('renders streamed assistant text and a tool block, the same as the raw transcript', () => {
    reset();
    const blocks = chatTranscript([
      ev('assistant.text', { text: 'Checking who is free.' }),
      ev('tool.call', { id: 'tu_1', name: 'weave_briefing', input: {} }),
      ev('tool.result', { id: 'tu_1', name: 'weave_briefing', content: '3 workers running' }),
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(['text', 'tool']);
    expect((blocks[0] as TextBlock).text).toBe('Checking who is free.');
    const tool = blocks[1] as ToolBlock;
    expect(tool.name).toBe('weave_briefing');
    expect(tool.status).toBe('ok');
    expect(tool.detail).toBe('3 workers running');
  });

  // The reply already renders as the thread message the tool created.
  it('drops the reply-delivery tool so the reply cannot appear twice', () => {
    reset();
    const blocks = chatTranscript([
      ev('assistant.text', { text: 'Filed it.' }),
      ev('tool.call', { id: 'tu_1', name: 'weave_human_send', input: { body: 'Filed it and put Ana on it.' } }),
      ev('tool.result', { id: 'tu_1', name: 'weave_human_send', content: 'delivered' }),
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(['text']);
    expect(JSON.stringify(blocks)).not.toContain('weave_human_send');
    expect(JSON.stringify(blocks)).not.toContain('put Ana on it');
  });

  it('keeps every other tool, and leaves a call with no result pending', () => {
    reset();
    const blocks = chatTranscript([
      ev('tool.call', { id: 'tu_1', name: 'weave_human_send', input: { body: 'on it' } }),
      ev('tool.call', { id: 'tu_2', name: 'weave_ticket_create', input: { title: 'Add dark mode' } }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'tool', name: 'weave_ticket_create', status: 'pending' });
  });

  it('tolerates empty and missing input', () => {
    expect(chatTranscript([])).toEqual([]);
    expect(chatTranscript(null)).toEqual([]);
    expect(chatTranscript(undefined)).toEqual([]);
  });
});
