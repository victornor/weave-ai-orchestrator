import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { readThreadContextTokens, readThreadUsage } from '../src/usage.js';

describe('thread context size', () => {
  it('reads the last per-request input from the rollout, in either shape', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-ctx-'));
    try {
      const dir = join(home, 'sessions', '2026', '09', '17');
      mkdirSync(dir, { recursive: true });
      const cumulative = (input: number, last: number) => JSON.stringify({ payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 999, output_tokens: 5, cached_input_tokens: 100 }, last_token_usage: { input_tokens: last, output_tokens: 2, cached_input_tokens: 900 } } } });
      // Two older token_count lines then a newer-shape record: the last request wins.
      const newer = JSON.stringify({ type: 'token_usage_record', payload: { usage: { input_tokens: 72_628, cached_input_tokens: 72_064, output_tokens: 161 } } });
      writeFileSync(join(dir, 'rollout-thread-9.jsonl'), `${cumulative(1, 1000)}\n${cumulative(2, 2000)}\n${newer}\n`);
      expect(readThreadContextTokens(home, 'thread-9')).toBe(72_628);
      expect(readThreadContextTokens(home, 'missing')).toBeNull();
      expect(readThreadContextTokens(undefined, 'thread-9')).toBeNull();
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});

describe('legacy thread usage', () => {
  it('reads only the matching thread and tolerates an interrupted last line', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-usage-'));
    try {
      const dir = join(home, 'sessions', '2026', '09', '16');
      mkdirSync(dir, { recursive: true });
      const event = (n: number) => JSON.stringify({ payload: { type: 'token_count', info: { total_token_usage: { input_tokens: n, output_tokens: 2, cached_input_tokens: 10 } } } });
      writeFileSync(join(dir, 'rollout-other.jsonl'), event(999));
      writeFileSync(join(dir, 'rollout-thread-1.jsonl'), event(20) + '\n' + event(30) + '\n{"payload":');
      expect(readThreadUsage(home, 'thread-1')).toEqual({ inputTokens: 30, outputTokens: 2, cachedInputTokens: 10 });
      expect(readThreadUsage(home, 'missing')).toBeNull();
      expect(readThreadUsage(home, '../thread-1')).toBeNull();
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
