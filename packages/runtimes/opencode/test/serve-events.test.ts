import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RuntimeEvent, RuntimePartial } from '@weave-ai/runtime-sdk';
import { createOpenCodeServeTranslator } from '../src/serve-events.js';

const fixture = (name: string): Array<Record<string, unknown>> =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', name), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);

const sessionOf = (lines: Array<Record<string, unknown>>): string => {
  for (const l of lines) { const sid = (l['properties'] as { sessionID?: string }).sessionID; if (sid) return sid; }
  throw new Error('no session in fixture');
};

function run(name: string) {
  const lines = fixture(name);
  const t = createOpenCodeServeTranslator({ resumed: false, sessionId: sessionOf(lines) });
  const events: RuntimeEvent[] = [];
  const partials: RuntimePartial[] = [];
  const permissions: string[] = [];
  let idle = false;
  const order: string[] = [];
  for (const l of lines) {
    const s = t.handle(l);
    events.push(...s.events); partials.push(...s.partials);
    if (s.permission) permissions.push(s.permission.id);
    if (s.idle) idle = true;
    for (const e of s.events) order.push(e.type);
    for (const p of s.partials) order.push(`partial:${p.text}`);
  }
  events.push(...t.finish());
  return { t, events, partials, permissions, idle, order };
}

describe('opencode serve translator (recorded fixtures)', () => {
  it('emits the tool call at its start and the result at its end, with deltas as partials in order', () => {
    const { events, partials, idle, t } = run('serve-turn-tool.jsonl');
    expect(partials.map((p) => p.text).join('')).toBe('Let me check the directory.Done.');
    expect(partials.every((p) => p.kind === 'text' && p.partId.startsWith('prt_'))).toBe(true);
    const types = events.map((e) => e.type);
    const call = types.indexOf('tool.call');
    const result = types.indexOf('tool.result');
    expect(call).toBeGreaterThan(-1);
    expect(result).toBeGreaterThan(call);
    // the call was emitted once, with its input, before the completed text part superseded the partials
    expect(types.filter((x) => x === 'tool.call')).toHaveLength(1);
    expect(events[call]!.payload).toMatchObject({ id: 'call_1', name: 'bash', input: { command: 'sleep 3; ls' } });
    const text = events.filter((e) => e.type === 'assistant.text');
    expect(text.map((e) => e.payload['text'])).toEqual(['Let me check the directory.', 'Done.']);
    expect(text[0]!.payload['partId']).toBe(partials[0]!.partId);
    expect(events.find((e) => e.type === 'command.executed')!.payload).toMatchObject({ command: 'sleep 3; ls', exitCode: 0 });
    expect(idle).toBe(true);
    expect(t.state).toMatchObject({ finalText: 'Done.', lastStepReason: 'stop', isError: false, usage: { inputTokens: 30, outputTokens: 7 } });
    expect(types.filter((x) => x === 'session.started')).toHaveLength(1);
  });

  it('never treats the user prompt as assistant output', () => {
    const { events } = run('serve-turn-tool.jsonl');
    expect(events.some((e) => e.type === 'assistant.text' && e.payload['text'] === 'list files')).toBe(false);
  });

  it('surfaces a permission ask with the id the reply route needs', () => {
    const { permissions } = run('serve-permission.jsonl');
    expect(permissions).toHaveLength(1);
    expect(permissions[0]).toMatch(/^per_/);
  });

  it('records a provider retry as raw, non-progress evidence and still completes', () => {
    const { events } = run('serve-retry.jsonl');
    expect(events.find((e) => e.type === 'runtime.raw')!.payload).toMatchObject({ originalType: 'session.status.retry', data: { attempt: 1, message: 'boom upstream' } });
  });

  it('ignores events for another session', () => {
    const lines = fixture('serve-turn-tool.jsonl');
    const t = createOpenCodeServeTranslator({ resumed: false, sessionId: 'ses_other' });
    const all = lines.flatMap((l) => { const s = t.handle(l); return [...s.events, ...s.partials]; });
    expect(all).toEqual([]);
  });

  it('reports a session error through the same error path as the run parser', () => {
    const t = createOpenCodeServeTranslator({ resumed: true, sessionId: 'ses_x' });
    const s = t.handle({ type: 'session.error', properties: { sessionID: 'ses_x', error: { name: 'UnknownError', data: { message: 'provider fell over' } } } });
    expect(s.events.find((e) => e.type === 'error')!.payload).toMatchObject({ name: 'UnknownError', message: 'provider fell over' });
    expect(t.state.isError).toBe(true);
    expect(s.events[0]!.type).toBe('session.resumed');
  });
});
