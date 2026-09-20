import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WireLog } from './wire.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wa-wire-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('WireLog', () => {
  it('redacts secret headers and every known secret value, wherever it appears', () => {
    const KEY = 'sk-live-abcdef123456';
    const ENV = 'GITHUB-TOKEN-xyz-98765';
    const w = new WireLog(join(dir, 'wire'), [KEY, ENV, 'short']);
    w.request('http://x/v1/chat/completions', { authorization: `Bearer ${KEY}`, 'x-api-key': KEY, 'content-type': 'application/json' }, { messages: [{ role: 'user', content: `my key is ${KEY} and ${ENV}` }] });
    w.head(200, new Headers({ 'set-cookie': 'session=abc', 'x-request-id': 'r1' }));
    w.chunk(new TextEncoder().encode(`data: {"echo":"${KEY}"}\n\n`));
    w.error(`failed with ${ENV}`);
    const file = readFileSync(join(dir, 'wire', '1.jsonl'), 'utf8');
    expect(file).not.toContain(KEY);
    expect(file).not.toContain(ENV);
    expect(file).not.toContain('session=abc');
    expect(file).toContain('[redacted]');
    const lines = file.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines[0]).toMatchObject({ dir: 'request', headers: { authorization: '[redacted]', 'x-api-key': '[redacted]', 'content-type': 'application/json' } });
    expect(lines[1]).toMatchObject({ dir: 'response', status: 200, headers: { 'x-request-id': 'r1' } });
  });
  it('starts a new numbered file per request and keeps a multibyte character split across chunks whole', () => {
    const w = new WireLog(join(dir, 'wire'), []);
    w.request('u', {}, {});
    const bytes = new TextEncoder().encode('日本');
    w.chunk(bytes.subarray(0, 4)); w.chunk(bytes.subarray(4));
    w.request('u', {}, {});
    expect(readdirSync(join(dir, 'wire')).sort()).toEqual(['1.jsonl', '2.jsonl']);
    const file = readFileSync(join(dir, 'wire', '1.jsonl'), 'utf8');
    expect(file).toContain('"data":"日"');
    expect(file).toContain('"data":"本"');
    expect(file).not.toContain('\ufffd');
  });
});
