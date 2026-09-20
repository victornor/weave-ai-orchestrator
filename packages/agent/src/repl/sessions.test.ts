import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Session } from '../session.js';
import { ageOf, findSession, listSessions, recordTurn, replHome, sessionPath } from './sessions.js';

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'wa-repl-sess-')); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

function make(id: string, cwd: string, prompt: string, origin: 'repl' | null = 'repl'): string {
  const path = sessionPath(home, id);
  const s = Session.open({ path, id, cwd, ...(origin ? { origin } : {}) });
  s.append({ role: 'user', text: `<env>x</env>\n\n${prompt}` });
  s.append({ role: 'assistant', content: [{ type: 'text', text: 'ok' }] });
  s.close();
  recordTurn(path, { prompt, provider: 'p', model: 'm1' });
  return path;
}

describe('REPL sessions', () => {
  it('lists this directory only, newest first, with the person\'s own first line, model and message count; --all widens', () => {
    const a = make('aaaa1111', '/work/a', 'first in a');
    make('bbbb2222', '/work/b', 'in b');
    make('cccc3333', '/work/a', 'second in a');
    utimesSync(a, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
    const here = listSessions(home, { cwd: '/work/a' });
    expect(here.map((s) => s.id)).toEqual(['cccc3333', 'aaaa1111']);
    expect(here[1]).toMatchObject({ firstPrompt: 'first in a', model: 'm1', provider: 'p', messages: 2, cwd: '/work/a' });
    expect(listSessions(home, { cwd: '/work/a', all: true }).map((s) => s.id).sort()).toEqual(['aaaa1111', 'bbbb2222', 'cccc3333']);
  });

  it('never lists a file that is not a REPL session, and a REPL file still loads as a plain session', () => {
    const worker = make('wwww9999', '/work/a', 'ticket work', null);
    make('rrrr0000', '/work/a', 'mine');
    expect(listSessions(home, { cwd: '/work/a', all: true }).map((s) => s.id)).toEqual(['rrrr0000']);
    const reopened = Session.open({ path: worker, id: 'wwww9999', cwd: '/work/a' });
    expect(reopened.messages).toHaveLength(2);
    reopened.close();
    writeFileSync(join(home, 'sessions', 'junk.jsonl'), 'not json\n');
    expect(listSessions(home, { cwd: '/work/a' })).toHaveLength(1);
  });

  it('finds a session by number, full id or unambiguous prefix and refuses the rest', () => {
    make('abc11111', '/w', 'one'); make('abd22222', '/w', 'two');
    const list = listSessions(home, { cwd: '/w' });
    expect(findSession(list, '1')).toMatchObject({ id: list[0]!.id });
    expect(findSession(list, 'abc')).toMatchObject({ id: 'abc11111' });
    expect(findSession(list, 'ab')).toMatchObject({ error: expect.stringContaining('2 sessions') });
    expect(findSession(list, '9')).toMatchObject({ error: 'no session number 9' });
  });

  it('is a directory of its own: WEAVE_AGENT_HOME, else the XDG data home', () => {
    expect(replHome({ WEAVE_AGENT_HOME: '/x' }, '/h')).toBe('/x');
    expect(replHome({ XDG_DATA_HOME: '/d' }, '/h')).toBe('/d/weave-agent');
    expect(replHome({}, '/h')).toBe('/h/.local/share/weave-agent');
    mkdirSync(join(home, 'x'));
    expect(ageOf(Date.now() - 3 * 3600_000)).toBe('3h');
  });
});
