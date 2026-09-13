import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@weave-ai/shared';
import { isTestCommand, workerActivity } from './activity.js';

/** A run event with the given type and payload, matching the adapters' normalized shape. */
function ev(type: RunEvent['type'], payload: Record<string, unknown>): RunEvent {
  return { id: `e-${Math.random()}`, runId: 'r1', seq: 1, ts: '2026-09-13T10:00:00.000Z', type, stream: 'stdout', level: 'info', payload };
}

describe('workerActivity (VS-328)', () => {
  it('maps a Claude Edit to editing the file', () => {
    const a = workerActivity(ev('tool.call', { id: 't1', name: 'Edit', input: { file_path: 'packages/ui/src/Board.tsx', old_string: 'a', new_string: 'b' } }));
    expect(a).toMatchObject({ verb: 'editing', target: 'packages/ui/src/Board.tsx' });
    expect(a?.label).toContain('Board.tsx');
  });

  it('maps a Claude Write to writing the file', () => {
    expect(workerActivity(ev('tool.call', { id: 't1', name: 'Write', input: { file_path: 'notes.md', content: 'x' } }))).toMatchObject({ verb: 'writing' });
  });

  it('maps a Claude Read to reading code without a target', () => {
    expect(workerActivity(ev('tool.call', { id: 't1', name: 'Read', input: { file_path: 'a.ts' } }))).toEqual({ verb: 'reading', label: 'Reading code', target: null });
  });

  it('maps a Claude test Bash command to running tests', () => {
    expect(workerActivity(ev('tool.call', { id: 't1', name: 'Bash', input: { command: 'pnpm test' } }))).toMatchObject({ verb: 'testing' });
  });

  it('maps other shell to running a command', () => {
    expect(workerActivity(ev('tool.call', { id: 't1', name: 'Bash', input: { command: 'git status' } }))).toMatchObject({ verb: 'command' });
  });

  it('maps a web fetch to researching', () => {
    expect(workerActivity(ev('tool.call', { id: 't1', name: 'WebFetch', input: { url: 'https://example.com' } }))).toMatchObject({ verb: 'researching' });
  });

  it('maps an opencode edit (filePath) to editing', () => {
    expect(workerActivity(ev('tool.call', { id: 't1', name: 'edit', input: { filePath: 'src/a.ts', oldString: 'a', newString: 'b' } }))).toMatchObject({ verb: 'editing', target: 'src/a.ts' });
  });

  it('maps an opencode write to writing', () => {
    expect(workerActivity(ev('tool.call', { id: 't1', name: 'write', input: { filePath: 'src/a.ts', content: 'x' } }))).toMatchObject({ verb: 'writing' });
  });

  it('maps a gemini replace to editing', () => {
    expect(workerActivity(ev('tool.call', { id: 't1', name: 'replace', input: { file_path: 'a.py' } }))).toMatchObject({ verb: 'editing' });
  });

  it('maps a gemini test shell command to running tests', () => {
    expect(workerActivity(ev('tool.call', { id: 't1', name: 'run_shell_command', input: { command: 'pytest -q' } }))).toMatchObject({ verb: 'testing' });
  });

  it('maps a cursor writeToolCall name to writing', () => {
    expect(workerActivity(ev('tool.call', { id: 't1', name: 'write', input: { path: 'a.ts' } }))).toMatchObject({ verb: 'writing' });
  });

  it('maps a codex file_change to editing', () => {
    expect(workerActivity(ev('file.changed', { id: 't1', path: 'src/a.ts', change: 'modified' }))).toMatchObject({ verb: 'editing', target: 'src/a.ts' });
  });

  it('maps a codex command_execution test run to running tests', () => {
    expect(workerActivity(ev('command.executed', { id: 't1', command: 'cargo test', exitCode: 0 }))).toMatchObject({ verb: 'testing' });
  });

  it('maps a codex command_execution non-test run to running a command', () => {
    expect(workerActivity(ev('command.executed', { id: 't1', command: 'ls -la' }))).toMatchObject({ verb: 'command' });
  });

  it('keeps the tool call\'s line when command.executed carries no command (VS-328)', () => {
    // Claude/Gemini/Cursor emit the command on the tool.call and not on command.executed.
    expect(workerActivity(ev('command.executed', { toolUseId: 't1', tool: 'Bash', stdout: 'ok', isError: false }))).toBeNull();
  });

  it('maps a codex raw web_search item to researching', () => {
    expect(workerActivity(ev('runtime.raw', { originalType: 'item.web_search', data: {} }))).toMatchObject({ verb: 'researching' });
  });

  it('falls back to Working for an unknown tool', () => {
    expect(workerActivity(ev('tool.call', { id: 't1', name: 'SomeFutureTool', input: {} }))).toEqual({ verb: 'working', label: 'Working', target: null });
  });

  it('ignores events that say nothing about activity', () => {
    expect(workerActivity(ev('assistant.text', { text: 'thinking out loud' }))).toBeNull();
    expect(workerActivity(ev('turn.completed', {}))).toBeNull();
    expect(workerActivity(null)).toBeNull();
  });
});

describe('isTestCommand (VS-328)', () => {
  it.each(['pnpm test', 'npm test', 'yarn test', 'bun test', 'npx vitest run', 'jest --ci', 'pytest -q', 'python -m pytest', 'go test ./...', 'cargo test', 'dotnet test', 'node --test'])('recognises %s', (cmd) => {
    expect(isTestCommand(cmd)).toBe(true);
  });

  it.each(['git status', 'ls -la', 'pnpm build', 'cargo build', 'echo "test"'])('does not mistake %s for a test run', (cmd) => {
    expect(isTestCommand(cmd)).toBe(false);
  });

  it('handles missing commands', () => {
    expect(isTestCommand(null)).toBe(false);
    expect(isTestCommand(undefined)).toBe(false);
    expect(isTestCommand('')).toBe(false);
  });
});
