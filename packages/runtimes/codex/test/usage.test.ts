import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { readThreadUsage } from '../src/usage.js';

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
