import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Session } from './session.js';

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
});
