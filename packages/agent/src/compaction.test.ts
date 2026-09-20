import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compact, compactionThreshold, filesFrom, findCut, serialiseSpan, SUMMARY_RESULT_CHARS } from './compaction.js';
import { Session } from './session.js';
import type { Message } from './types.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wa-compact-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A small seeded generator so a failing history can be replayed. */
function rng(seed: number): () => number { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
function history(seed: number, turns: number): Message[] {
  const r = rng(seed); const out: Message[] = []; let id = 0;
  for (let t = 0; t < turns; t++) {
    if (r() < 0.7 || out.length === 0) out.push({ role: 'user', text: `ask ${t} ${'w '.repeat(Math.floor(r() * 200))}` });
    const steps = Math.floor(r() * 4);
    for (let s = 0; s < steps; s++) {
      const calls = 1 + Math.floor(r() * 3); const ids = Array.from({ length: calls }, () => `c${id++}`);
      out.push({ role: 'assistant', content: [{ type: 'text', text: 'ok' }, ...ids.map((i) => ({ type: 'toolCall' as const, id: i, name: r() < 0.5 ? 'read' : 'edit', args: { path: `/f${i}` } }))] });
      for (const i of ids) out.push({ role: 'toolResult', toolCallId: i, name: 'read', text: 'r '.repeat(Math.floor(r() * 400)), isError: false });
    }
    out.push({ role: 'assistant', content: [{ type: 'text', text: 'done' }] });
  }
  return out;
}

describe('findCut', () => {
  it('never separates a tool call from its results, over random histories', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const h = history(seed, 1 + (seed % 12));
      for (const keep of [1, 50, 500, 3000, 20000]) {
        const cut = findCut(h, 0, keep);
        if (cut === null) continue;
        expect(cut).toBeGreaterThan(0);
        expect(h[cut]!.role).not.toBe('toolResult');
        const kept = h.slice(cut);
        const calls = new Set<string>();
        for (const m of kept) if (m.role === 'assistant') for (const b of m.content) if (b.type === 'toolCall') calls.add(b.id);
        for (const m of kept) if (m.role === 'toolResult') expect(calls.has(m.toolCallId), `seed ${seed} keep ${keep}`).toBe(true);
        // and the summarised side is closed the same way: every call's results are inside it
        const dropped = h.slice(0, cut);
        const results = new Set(dropped.filter((m) => m.role === 'toolResult').map((m) => (m as { toolCallId: string }).toolCallId));
        for (const m of dropped) if (m.role === 'assistant') for (const b of m.content) if (b.type === 'toolCall') expect(results.has(b.id)).toBe(true);
      }
    }
  });
  it('returns null when nothing precedes the cut', () => {
    expect(findCut([{ role: 'user', text: 'a' }], 0, 10)).toBeNull();
  });
});

describe('compact', () => {
  const summariser = (calls: string[] = []) => async (_s: string, user: string) => { calls.push(user); return '## Goal\nship it'; };
  it('summarises before the cut, keeps the rest and resumes with the summary first', async () => {
    const path = join(dir, 'a.jsonl');
    const s = Session.open({ path, id: 'a', cwd: dir });
    for (const m of history(7, 10)) s.append(m);
    const calls: string[] = [];
    const out = await compact({ session: s, window: undefined, keepRecentTokens: 600, complete: summariser(calls) });
    expect(out.ok).toBe(true);
    expect(out.tokensAfter!).toBeLessThan(out.tokensBefore!);
    const ctx = s.context();
    expect(ctx[0]).toMatchObject({ role: 'user' });
    expect((ctx[0] as { text: string }).text.startsWith('[Conversation summary]\n## Goal\nship it')).toBe(true);
    s.close();
    const r = Session.open({ path, id: 'a', cwd: dir });
    expect((r.context()[0] as { text: string }).text).toContain('ship it');
    expect(r.context().length).toBe(ctx.length);
    r.close();
  });
  it('carries the newest user message verbatim when the cut passes it', async () => {
    const s = Session.open({ path: join(dir, 'b.jsonl'), id: 'b', cwd: dir });
    s.append({ role: 'user', text: 'PLEASE FIX THE THING' });
    for (let i = 0; i < 30; i++) {
      s.append({ role: 'assistant', content: [{ type: 'toolCall', id: `t${i}`, name: 'bash', args: { command: 'x' } }] });
      s.append({ role: 'toolResult', toolCallId: `t${i}`, name: 'bash', text: 'out '.repeat(100), isError: false });
    }
    s.append({ role: 'assistant', content: [{ type: 'text', text: 'working' }] });
    const out = await compact({ session: s, window: undefined, keepRecentTokens: 300, complete: summariser() });
    expect(out.ok).toBe(true);
    expect((s.context()[0] as { text: string }).text).toContain('PLEASE FIX THE THING');
    s.close();
  });
  it('passes the previous summary on a second compaction and accumulates file lists', async () => {
    const s = Session.open({ path: join(dir, 'c.jsonl'), id: 'c', cwd: dir });
    const add = (tag: string) => { for (let i = 0; i < 8; i++) {
      s.append({ role: 'user', text: `q ${tag}${i}` });
      s.append({ role: 'assistant', content: [{ type: 'toolCall', id: `${tag}${i}`, name: 'edit', args: { path: `/${tag}${i}.ts` } }] });
      s.append({ role: 'toolResult', toolCallId: `${tag}${i}`, name: 'edit', text: 'x '.repeat(200), isError: false });
      s.append({ role: 'assistant', content: [{ type: 'text', text: 'ok' }] });
    } };
    add('a');
    const calls: string[] = [];
    await compact({ session: s, window: undefined, keepRecentTokens: 200, complete: summariser(calls) });
    add('b');
    await compact({ session: s, window: undefined, keepRecentTokens: 200, complete: summariser(calls) });
    expect(calls[1]).toContain('<previous-summary>');
    expect(calls[1]).toContain('ship it');
    const files = s.lastCompaction!.files.modified;
    expect(files).toContain('/a0.ts');
    expect(files.some((f) => f.startsWith('/b'))).toBe(true);
    s.close();
  });
  it('leaves the session untouched when the summary fails or is empty', async () => {
    const s = Session.open({ path: join(dir, 'd.jsonl'), id: 'd', cwd: dir });
    for (const m of history(3, 8)) s.append(m);
    const n = s.messages.length;
    expect((await compact({ session: s, window: undefined, keepRecentTokens: 100, complete: async () => { throw new Error('boom'); } })).ok).toBe(false);
    expect((await compact({ session: s, window: undefined, keepRecentTokens: 100, complete: async () => '  ' })).ok).toBe(false);
    expect(s.lastCompaction).toBeNull();
    expect(s.context()).toHaveLength(n);
    s.close();
  });
});

describe('helpers', () => {
  it('cuts tool results in the summary input', () => {
    const text = serialiseSpan([{ role: 'toolResult', toolCallId: 'x', name: 'bash', text: 'z'.repeat(SUMMARY_RESULT_CHARS + 500), isError: false }]);
    expect(text).toContain('[500 more chars]');
  });
  it('lists read and modified files', () => {
    expect(filesFrom([{ role: 'assistant', content: [{ type: 'toolCall', id: '1', name: 'read', args: { path: '/a' } }, { type: 'toolCall', id: '2', name: 'write', args: { path: '/b' } }] }])).toEqual({ read: ['/a'], modified: ['/b'] });
  });
  it('triggers at window minus the larger of 16384 and the output cap, never under half', () => {
    expect(compactionThreshold(200_000, undefined)).toBe(200_000 - 16_384);
    expect(compactionThreshold(200_000, 32_000)).toBe(168_000);
    expect(compactionThreshold(20_000, undefined)).toBe(10_000);
  });
});
