import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forkSessionFile, Session } from './session.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wa-session-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('Session', () => {
  it('appends complete lines and reloads the same messages', () => {
    const path = join(dir, 's', 'a.jsonl');
    const s = Session.open({ path, id: 'a', cwd: dir });
    s.append({ role: 'user', text: 'hi' });
    s.append({ role: 'assistant', content: [{ type: 'text', text: 'yo' }] });
    s.close();
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(JSON.parse(lines[0]!)).toMatchObject({ type: 'session', v: 1, id: 'a' });
    expect(lines).toHaveLength(3);
    const r = Session.open({ path, id: 'a', cwd: dir });
    expect(r.messages).toEqual([{ role: 'user', text: 'hi' }, { role: 'assistant', content: [{ type: 'text', text: 'yo' }] }]);
    expect(r.ref()).toMatchObject({ v: 1, id: 'a', path });
    expect(JSON.parse(lines[2]!).parentId).toBe(JSON.parse(lines[1]!).id);
    r.close();
  });
  it('drops a torn last line and keeps appending on a fresh line', () => {
    const path = join(dir, 'b.jsonl');
    const s = Session.open({ path, id: 'b', cwd: dir });
    s.append({ role: 'user', text: 'one' });
    s.close();
    appendFileSync(path, '{"id":"zz","parentId":null,"type":"mess');
    const r = Session.open({ path, id: 'b', cwd: dir });
    expect(r.messages).toEqual([{ role: 'user', text: 'one' }]);
    r.append({ role: 'user', text: 'two' });
    r.close();
    expect(Session.open({ path, id: 'b', cwd: dir }).messages.map((m) => (m as { text: string }).text)).toEqual(['one', 'two']);
  });
  it('ignores a file that is only a header', () => {
    const path = join(dir, 'c.jsonl');
    writeFileSync(path, '{"type":"session","v":1,"id":"c"}\n');
    expect(Session.open({ path, id: 'c', cwd: dir }).messages).toEqual([]);
  });

  it('projects a compaction: the summary first, then messages from the first kept one', () => {
    const path = join(dir, 'd.jsonl');
    const s = Session.open({ path, id: 'd', cwd: dir });
    for (const t of ['a', 'b', 'c']) s.append({ role: 'user', text: t });
    s.compact({ summary: 'S', firstKeptIndex: 1, tokensBefore: 10, tokensAfter: 4, files: { read: ['x'], modified: [] } });
    s.append({ role: 'user', text: 'd' });
    expect(s.context().map((m) => (m as { text: string }).text)).toEqual(['[Conversation summary]\nS', 'b', 'c', 'd']);
    expect(s.messages).toHaveLength(4);
    s.close();
    const r = Session.open({ path, id: 'd', cwd: dir });
    expect(r.context().map((m) => (m as { text: string }).text)).toEqual(['[Conversation summary]\nS', 'b', 'c', 'd']);
    expect(r.lastCompaction).toMatchObject({ tokensBefore: 10, tokensAfter: 4, files: { read: ['x'], modified: [] } });
    r.close();
  });
  it('shows a file with no compaction as every message in order', () => {
    const s = Session.open({ path: join(dir, 'e.jsonl'), id: 'e', cwd: dir });
    s.append({ role: 'user', text: 'a' });
    expect(s.context()).toEqual([{ role: 'user', text: 'a' }]);
    expect(s.lastCompaction).toBeNull();
    s.close();
  });
  it('forks by copying the entries under a new id', () => {
    const from = join(dir, 'f.jsonl'); const to = join(dir, 'g.jsonl');
    const s = Session.open({ path: from, id: 'f', cwd: dir });
    s.append({ role: 'user', text: 'a' });
    s.compact({ summary: 'S', firstKeptIndex: 0, tokensBefore: 1, tokensAfter: 1, files: { read: [], modified: [] } });
    s.close();
    forkSessionFile(from, to, 'g');
    const f = Session.open({ path: to, id: 'g', cwd: dir });
    expect(JSON.parse(readFileSync(to, 'utf8').split('\n')[0]!)).toMatchObject({ id: 'g', forkedFrom: 'f' });
    expect(f.context().map((m) => (m as { text: string }).text)).toEqual(['[Conversation summary]\nS', 'a']);
    f.close();
  });
});
