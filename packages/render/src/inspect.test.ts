import { describe, expect, it } from 'vitest';
import type { RunEvent, RunEventType } from '@agent-conductor/shared';
import { transcriptToLines } from './inspect.js';
import { runEventsToTranscript } from './transcript.js';

let seq = 0;
function ev(type: RunEventType, payload: Record<string, unknown>, ts = '2026-09-05T12:00:00.000Z'): RunEvent {
  seq += 1;
  return { id: `e${seq}`, runId: 'run_1', seq, ts, type, stream: 'stdout', level: 'info', payload };
}
function reset() { seq = 0; }
const lines = (events: RunEvent[], opts = {}) => transcriptToLines(runEventsToTranscript(events), opts);

describe('transcriptToLines', () => {
  it('returns nothing for empty or missing input', () => {
    expect(transcriptToLines([])).toEqual([]);
    expect(transcriptToLines(null)).toEqual([]);
    expect(transcriptToLines(undefined)).toEqual([]);
  });

  it('carries the sequence, timestamp and kind of the block it came from', () => {
    reset();
    const out = lines([ev('assistant.text', { text: 'Rebased onto main.' })]);
    expect(out).toEqual([{ seq: 1, ts: '2026-09-05T12:00:00.000Z', kind: 'text', text: 'Rebased onto main.' }]);
  });

  it('truncates assistant text to the per-line budget', () => {
    reset();
    const out = lines([ev('assistant.text', { text: 'x'.repeat(50) })], { maxTextChars: 20 });
    expect(out[0]!.text).toBe(`${'x'.repeat(20)}…`);
  });

  it('folds a tool call and its result into one line', () => {
    reset();
    const out = lines([
      ev('tool.call', { name: 'Read', id: 'c1', input: { file_path: 'packages/render/src/inspect.ts' } }),
      ev('tool.result', { id: 'c1', output: 'the whole file body', durationMs: 400 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('tool');
    expect(out[0]!.text).toBe('Read packages/render/src/inspect.ts 400ms');
    expect(out[0]!.text).not.toContain('the whole file body');
  });

  it('keeps the first line of the output when a tool failed', () => {
    reset();
    const out = lines([
      ev('tool.call', { name: 'Bash', id: 'c1', input: { command: 'pnpm test' } }),
      ev('tool.result', { id: 'c1', isError: true, output: '\n  2 tests failed\n  see the log above\n', durationMs: 2000 }),
    ]);
    expect(out[0]!.text).toBe('Bash pnpm test failed 2s — 2 tests failed');
    expect(out[0]!.text).not.toContain('see the log above');
  });

  it('clamps that failure detail to its own budget', () => {
    reset();
    const out = lines([
      ev('tool.call', { name: 'Bash', id: 'c1', input: { command: 'x' } }),
      ev('tool.result', { id: 'c1', isError: true, output: 'y'.repeat(400) }),
    ], { maxDetailChars: 20 });
    expect(out[0]!.text.length).toBeLessThan(60);
    expect(out[0]!.text).toContain('…');
  });

  it('says nothing extra about a tool that succeeded', () => {
    reset();
    const out = lines([
      ev('tool.call', { name: 'Bash', id: 'c1', input: { command: 'pnpm lint' } }),
      ev('tool.result', { id: 'c1', output: 'boundaries ok' }),
    ]);
    expect(out[0]!.text).not.toContain('boundaries ok');
  });

  it('renders a file change as its collapsed line', () => {
    reset();
    const out = lines([ev('file.changed', { path: 'packages/core/src/api.ts', additions: 3, deletions: 1, changeType: 'modified' })]);
    expect(out[0]!.kind).toBe('file');
    expect(out[0]!.text).toBe('Edit packages/core/src/api.ts +3 −1');
  });

  it('keeps a phase marker in full', () => {
    reset();
    const out = lines([ev('run.phase.timing', { phase: 'build_prompt', durationMs: 1200 })]);
    expect(out[0]!.kind).toBe('phase');
    expect(out[0]!.text).toBe('phase: building prompt · 1.2s');
  });

  it('keeps an error in full and prefixes its code', () => {
    reset();
    const out = lines([ev('error', { code: 'usage_limit', message: 'the runtime reported a usage limit' })]);
    expect(out[0]!).toMatchObject({ kind: 'error', text: '[usage_limit] the runtime reported a usage limit' });
  });

  it('marks a status line that is not merely informational', () => {
    reset();
    const out = lines([
      ev('run.started', { runtimeId: 'claude' }),
      ev('supervisor.action', { action: 'interrupt', reason: 'silent for 20m', severity: 'warn' }),
    ]);
    expect(out[0]!.text).toBe('run started · claude');
    expect(out[1]!.text).toBe('warn: supervisor: interrupt — silent for 20m');
  });

  it('drops a block that renders to nothing rather than emitting a blank line', () => {
    reset();
    const out = lines([ev('assistant.text', { text: '   ' }), ev('assistant.text', { text: 'real' })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe('real');
  });

  it('inherits the transcript redaction: a secret in tool output never reaches a line', () => {
    reset();
    const out = lines([
      ev('tool.call', { name: 'Bash', id: 'c1', input: { command: 'cat .env' } }),
      ev('tool.result', { id: 'c1', isError: true, output: 'api_key=sk-ant-abcdefghijklmnopqrstuvwxyz012345 is rejected' }),
      ev('assistant.text', { text: 'The token ghp_abcdefghijklmnopqrstuvwxyz0123 did not work.' }),
    ]);
    const all = out.map((l) => l.text).join('\n');
    expect(all).not.toContain('sk-ant-abcdefghijklmnopqrstuvwxyz012345');
    expect(all).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123');
    expect(all).toContain('[redacted]');
  });
});
