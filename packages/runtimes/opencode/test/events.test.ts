import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '@weave-ai/runtime-sdk';
import { createOpenCodeParser, parseOpenCodeProviderErrors } from '../src/events.js';
import { parseModels } from '../src/adapter.js';

// All three fixtures were recorded live from opencode 1.18.27 on 2026-09-03 against a free
// opencode-zen model (`opencode run --format json --dir <tmp> -m opencode/big-pickle ...`).
function run(name: string, resumed = false) {
  const path = fileURLToPath(new URL(`../fixtures/${name}.jsonl`, import.meta.url));
  const parser = createOpenCodeParser({ resumed });
  const events: RuntimeEvent[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n').filter((l) => l.trim())) events.push(...parser.handle(line));
  events.push(...parser.finish());
  return { events, state: parser.state, types: events.map((e) => e.type) };
}

describe('opencode run --format json parser', () => {
  it('normalizes a simple turn', () => {
    const { types, state } = run('turn-simple');
    expect(types).toEqual(['session.started', 'turn.started', 'assistant.text', 'usage.delta', 'turn.completed']);
    expect(state.sessionId).toBe('ses_f9649ed9bffeRTKyRYoqBVKK1G');
    expect(state.finalText).toBe('pong');
    expect(state.usage).toEqual({ inputTokens: 10018, outputTokens: 14, cachedInputTokens: 1792 });
    // VS-462: the first (only) request reads 10018 fresh (input 10018 + cache.write 0) and 1792 cached.
    expect(state.firstRequest).toEqual({ freshTokens: 10018, cachedTokens: 1792 });
    // One request: input 10018 + cache.write 0 + cache.read 1792.
    expect(state.contextTokens).toBe(11_810);
    expect(state.costUsd).toBe(0);
    expect(state.isError).toBe(false);
  });

  it('normalizes tool use and extracts the fenced report from the last message', () => {
    const { types, state, events } = run('turn-tool-report');
    expect(types).toContain('tool.call');
    expect(types).toContain('tool.result');
    expect(types).toContain('command.executed');
    const cmd = events.find((e) => e.type === 'command.executed')!;
    expect(cmd.payload).toMatchObject({ command: 'echo pong', exitCode: 0, output: 'pong\n' });
    // A command with no test summary carries no tally (VS-328).
    expect(cmd.payload['tests']).toBeUndefined();
    // usage is summed across both steps
    expect(state.usage).toEqual({ inputTokens: 4551, outputTokens: 61, cachedInputTokens: 18944 });
    // VS-462: only the first step's request — 4294 fresh, 7424 read from cache — not the sum.
    expect(state.firstRequest).toEqual({ freshTokens: 4294, cachedTokens: 7424 });
    expect(state.finalText).toBe('```json\n{"state":"done","summary":"said pong"}\n```');
  });

  it('measures the context from the last request, while usage stays the turn’s total', () => {
    // Two-step fixture: first step 4294 + 0 + 7424, second 257 + 0 + 11520. Cumulative
    // input+cache-read is 23,495 — the VS-98 bug if used as a size (VS-157).
    const { state } = run('turn-tool-report');
    expect(state.contextTokens).toBe(11_777);
    const cumulative = state.usage!.inputTokens + state.usage!.cachedInputTokens;
    expect(cumulative).toBe(23_495);
    expect(state.contextTokens).toBeLessThan(cumulative);
  });

  it('normalizes an error line', () => {
    const { types, state } = run('turn-error');
    expect(types).toEqual(['session.started', 'error', 'turn.completed']);
    expect(state.isError).toBe(true);
    expect(state.errorMessage).toContain('Unexpected server error');
    expect(state.contextTokens).toBeNull();
    expect(state.usage).toBeNull();
    expect(state.firstRequest).toBeNull();
  });

  it('reports session.resumed when resuming', () => {
    expect(run('turn-simple', true).types[0]).toBe('session.resumed');
  });
});

describe('opencode models parsing', () => {
  it('reads provider/model lines and marks them detected', () => {
    expect(parseModels('opencode/big-pickle\nanthropic/claude-sonnet-5\n\nnot a model line\n')).toEqual([
      { id: 'opencode/big-pickle', label: 'opencode/big-pickle', provider: 'opencode', source: 'detected' },
      { id: 'anthropic/claude-sonnet-5', label: 'anthropic/claude-sonnet-5', provider: 'anthropic', source: 'detected' },
    ]);
  });
});

describe('opencode command events (VS-328)', () => {
  it('carries the parsed test tally on command.executed before truncating', () => {
    const p = createOpenCodeParser();
    const evs = p.handle(JSON.stringify({
      type: 'tool_use', sessionID: 's1',
      part: { tool: 'bash', callID: 'c1', state: { status: 'completed', input: { command: 'pnpm test' }, output: ' Test Files  2 passed (2)\n      Tests  28 passed (28)\n   Duration  1.20s', metadata: { exit: 0 } } },
    }));
    const cmd = evs.find((e) => e.type === 'command.executed')!;
    expect(cmd.payload['tests']).toEqual({ passed: 28, total: 28 });
  });
});

describe('opencode compaction (VS-454)', () => {
  // `opencode run --format json` never writes a compaction event: its only event kinds are
  // tool_use / step_start / step_finish / text / reasoning / error, and its session.status is
  // idle|retry|busy. A v2 `session.next.compaction.started` line is therefore not something the
  // stream produces; if one ever did arrive, it must not be mistaken for a compaction event.
  it('does not emit a compaction event for opencode', () => {
    const p = createOpenCodeParser();
    // The first frame carrying a sessionID announces the session; neither is a compaction event.
    const types = [
      ...p.handle(JSON.stringify({ type: 'session.next.compaction.started', sessionID: 's1' })),
      ...p.handle(JSON.stringify({ type: 'session.compacted', sessionID: 's1' })),
    ].map((e) => e.type);
    expect(types).not.toContain('session.compaction.started');
    expect(types).not.toContain('session.compaction.completed');
    expect(types).toContain('runtime.raw');
  });
});

// VS-461: the line below is copied verbatim from the live opencode log during the 2026-09-14
// DeepSeek outage (`<configHome>/opencode/log/opencode.log`); the run's own stream had no error.
describe('opencode provider errors (VS-461)', () => {
  const SESSION = 'ses_f5edbbd24ffeQj03OjwcFApn8m';
  const ERROR_LINE = 'timestamp=2026-09-14T18:46:51.593Z level=ERROR run=27fd2273 message="stream error" '
    + 'providerID=deepseek modelID=deepseek-flash session.id=' + SESSION + ' small=false agent=build mode=primary '
    + 'error.error.message="We were unable to start processing your request within the 900-second timeout limit. Please try again later."';

  it('extracts the provider, model and message for the turn\'s session', () => {
    expect(parseOpenCodeProviderErrors(ERROR_LINE, SESSION)).toEqual({
      sessionId: SESSION,
      provider: 'deepseek',
      model: 'deepseek-flash',
      message: 'We were unable to start processing your request within the 900-second timeout limit. Please try again later.',
    });
  });

  it('ignores another session (concurrent turns share one log) and non-ERROR lines', () => {
    const other = ERROR_LINE.replace(SESSION, 'ses_someone_else');
    const info = ERROR_LINE.replace('level=ERROR', 'level=INFO');
    expect(parseOpenCodeProviderErrors(`${other}\n${info}`, SESSION)).toBeNull();
  });

  it('returns null rather than guessing when the turn never reported a session', () => {
    expect(parseOpenCodeProviderErrors(ERROR_LINE, null)).toBeNull();
  });

  it('keeps the last error when a session retried and failed again', () => {
    const later = ERROR_LINE.replace('18:46:51.593', '19:01:20.545')
      .replace('error.error.message="We were unable to start processing your request within the 900-second timeout limit. Please try again later."', 'error.error.message="429 rate limited"');
    expect(parseOpenCodeProviderErrors(`${ERROR_LINE}\n${later}`, SESSION)?.message).toBe('429 rate limited');
  });
});
