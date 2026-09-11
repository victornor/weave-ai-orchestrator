import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sessionActivitySignal } from './activity-signal.js';

describe('sessionActivitySignal (VS-249)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ac-activity-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is null for a directory that does not exist', () => {
    expect(sessionActivitySignal(join(dir, 'nope'))).toBeNull();
  });

  it('is null for an empty directory', () => {
    expect(sessionActivitySignal(dir)).toBeNull();
  });

  it('changes when a file is added', () => {
    const before = sessionActivitySignal(dir);
    writeFileSync(join(dir, 'session.jsonl'), '{"a":1}\n');
    const after = sessionActivitySignal(dir);
    expect(before).toBeNull();
    expect(after).not.toBeNull();
  });

  it('is stable when nothing changes, even across repeated calls', () => {
    writeFileSync(join(dir, 'session.jsonl'), '{"a":1}\n');
    const first = sessionActivitySignal(dir);
    const second = sessionActivitySignal(dir);
    expect(first).toBe(second);
  });

  it('changes when an existing file is touched (append-in-place activity)', () => {
    const path = join(dir, 'session.jsonl');
    writeFileSync(path, '{"a":1}\n');
    const before = sessionActivitySignal(dir);
    const future = new Date(Date.now() + 5000);
    utimesSync(path, future, future);
    const after = sessionActivitySignal(dir);
    expect(after).not.toBe(before);
  });

  it('picks up a change in a nested subdirectory', () => {
    mkdirSync(join(dir, 'projects', 'x'), { recursive: true });
    const before = sessionActivitySignal(dir);
    writeFileSync(join(dir, 'projects', 'x', 'sess.jsonl'), '{}\n');
    const after = sessionActivitySignal(dir);
    expect(before).toBeNull();
    expect(after).not.toBeNull();
  });
});
