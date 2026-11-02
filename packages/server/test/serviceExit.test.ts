/**
 * The service manager's record of how the previous daemon process ended (VS-955). The fixture is the
 * journal of the real 2026-11-02 SIGBUS crash, captured with `journalctl --user USER_INVOCATION_ID=… -o
 * json` (host identifiers redacted); no test runs the real `journalctl`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseServiceExit, readServiceExit, signalName } from '../src/serviceExit.js';

const fixture = readFileSync(join(import.meta.dirname, 'fixtures', 'journal-sigbus-crash.jsonl'), 'utf8');
const ID = '40c354b060bb480ab4b7c667845021b0';

describe('parseServiceExit', () => {
  it('reads the real SIGBUS crash: dumped, signal 7, core-dump, restart counter 1, and when it exited', () => {
    expect(parseServiceExit(fixture)).toEqual({
      source: 'systemd',
      exitCode: 'dumped',
      exitStatus: '7',
      signal: 'SIGBUS',
      unitResult: 'core-dump',
      restarts: 1,
      exitedAt: '2026-11-02T19:00:43.527Z',
    });
  });

  it('returns null for empty output, garbage, or an invocation with no exit entry', () => {
    expect(parseServiceExit('')).toBeNull();
    expect(parseServiceExit('not json\n{"MESSAGE_ID":')).toBeNull();
    const startedOnly = fixture.split('\n').filter((l) => l.includes('39f53479d3a045ac8e11786248231fbf')).join('\n');
    expect(parseServiceExit(startedOnly)).toBeNull();
  });

  it('a normal exit has a status and no signal', () => {
    const line = JSON.stringify({ MESSAGE_ID: '98e322203f7a4ed290d09fe03c09fe15', EXIT_CODE: 'exited', EXIT_STATUS: '1', __REALTIME_TIMESTAMP: '1793646043527895' });
    expect(parseServiceExit(line)).toMatchObject({ exitCode: 'exited', exitStatus: '1', signal: null, exitedAt: '2026-11-02T19:00:43.527Z' });
  });

  it('names signals by number', () => {
    expect(signalName('7')).toBe('SIGBUS');
    expect(signalName('9')).toBe('SIGKILL');
    expect(signalName('BUS')).toBe('SIGBUS');
    expect(signalName('999')).toBeNull();
  });
});

describe('readServiceExit', () => {
  it('asks the user journal for exactly the recorded invocation', async () => {
    const calls: string[][] = [];
    const exit = await readServiceExit(ID, async (args) => { calls.push(args); return fixture; });
    expect(exit?.signal).toBe('SIGBUS');
    expect(calls).toEqual([['--user', `USER_INVOCATION_ID=${ID}`, '-o', 'json', '--no-pager']]);
  });

  it('falls back to the system journal when the user journal has nothing', async () => {
    const calls: string[][] = [];
    const exit = await readServiceExit(ID, async (args) => { calls.push(args); return args[0] === '--user' ? '' : fixture; });
    expect(exit?.exitCode).toBe('dumped');
    expect(calls[1]).toEqual([`INVOCATION_ID=${ID}`, '-o', 'json', '--no-pager']);
  });

  it('a failing, timing-out or empty journal is unknown, never an error', async () => {
    expect(await readServiceExit(ID, async () => { throw new Error('journalctl timed out'); })).toBeNull();
    expect(await readServiceExit(ID, async () => '')).toBeNull();
  });

  it('never queries with an id that is not an invocation id', async () => {
    let asked = 0;
    expect(await readServiceExit('x; rm -rf /', async () => { asked += 1; return fixture; })).toBeNull();
    expect(asked).toBe(0);
  });
});
