import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '@openconductor/runtime-sdk';
import { createOpenCodeParser } from '../src/events.js';
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
    // usage is summed across both steps
    expect(state.usage).toEqual({ inputTokens: 4551, outputTokens: 61, cachedInputTokens: 18944 });
    expect(state.finalText).toBe('```json\n{"state":"done","summary":"said pong"}\n```');
  });

  it('normalizes an error line', () => {
    const { types, state } = run('turn-error');
    expect(types).toEqual(['session.started', 'error', 'turn.completed']);
    expect(state.isError).toBe(true);
    expect(state.errorMessage).toContain('Unexpected server error');
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
