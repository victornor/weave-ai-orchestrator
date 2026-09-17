import { readdirSync, openSync, closeSync, fstatSync, readSync } from 'node:fs';
import { join } from 'node:path';

export interface CodexUsage { inputTokens: number; outputTokens: number; cachedInputTokens: number }

/** Read the last cumulative counter before resuming a legacy thread without a saved baseline. */
export function readThreadUsage(home: string | undefined, threadId: string | null): CodexUsage | null {
  if (!home || !threadId || !/^[A-Za-z0-9_-]+$/.test(threadId)) return null;
  function visit(dir: string, depth: number): CodexUsage | null {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory() && depth < 3) {
          const found = visit(path, depth + 1);
          if (found) return found;
        } else if (entry.isFile() && entry.name.endsWith(`-${threadId}.jsonl`)) {
          let usage: CodexUsage | null = null;
          // Counters occur near the end; never load an entire long-lived transcript.
          const fd = openSync(path, 'r');
          let tail: string;
          try {
            const size = fstatSync(fd).size;
            const buffer = Buffer.alloc(Math.min(size, 256 * 1024));
            const bytes = readSync(fd, buffer, 0, buffer.length, size - buffer.length);
            tail = buffer.subarray(0, bytes).toString('utf8');
          } finally { closeSync(fd); }
          for (const line of tail.split('\n')) {
            try {
              const event = JSON.parse(line) as { payload?: { type?: string; info?: { total_token_usage?: Record<string, unknown> } } };
              const total = event.payload?.type === 'token_count' ? event.payload.info?.total_token_usage : undefined;
              if (total && typeof total['input_tokens'] === 'number' && typeof total['output_tokens'] === 'number') {
                usage = { inputTokens: total['input_tokens'], outputTokens: total['output_tokens'], cachedInputTokens: typeof total['cached_input_tokens'] === 'number' ? total['cached_input_tokens'] : 0 };
              }
            } catch { /* interrupted final lines do not invalidate earlier counters */ }
          }
          return usage;
        }
      }
    } catch { /* unavailable rollout: retain unknown usage rather than charging history */ }
    return null;
  }
  return visit(join(home, 'sessions'), 0);
}

/**
 * The size of the thread's **last** API request, from the rollout. `codex exec --json` reports only
 * the turn's cumulative usage, so this per-request counter (`last_token_usage`, or the newer
 * `token_usage_record.usage`) is the only context-size figure a Codex turn leaves behind — without
 * it the chat's context meter has nothing to show for a Codex session and says so. `input_tokens`
 * already includes the cached tokens, exactly like the model's context.
 */
export function readThreadContextTokens(home: string | undefined, threadId: string | null): number | null {
  if (!home || !threadId || !/^[A-Za-z0-9_-]+$/.test(threadId)) return null;
  function visit(dir: string, depth: number): number | null {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory() && depth < 3) {
          const found = visit(path, depth + 1);
          if (found != null) return found;
        } else if (entry.isFile() && entry.name.endsWith(`-${threadId}.jsonl`)) {
          let context: number | null = null;
          const fd = openSync(path, 'r');
          let tail: string;
          try {
            const size = fstatSync(fd).size;
            const buffer = Buffer.alloc(Math.min(size, 256 * 1024));
            const bytes = readSync(fd, buffer, 0, buffer.length, size - buffer.length);
            tail = buffer.subarray(0, bytes).toString('utf8');
          } finally { closeSync(fd); }
          for (const line of tail.split('\n')) {
            try {
              const event = JSON.parse(line) as {
                type?: string;
                payload?: { type?: string; info?: { last_token_usage?: Record<string, unknown> }; usage?: Record<string, unknown> };
              };
              const perRequest = event.payload?.type === 'token_count'
                ? event.payload.info?.last_token_usage
                : (event.type === 'token_usage_record' ? event.payload?.usage : undefined);
              const input = perRequest?.['input_tokens'];
              if (typeof input === 'number' && Number.isFinite(input) && input > 0) context = input;
            } catch { /* interrupted final lines do not invalidate earlier counters */ }
          }
          return context;
        }
      }
    } catch { /* unavailable rollout: report no size rather than a guess */ }
    return null;
  }
  return visit(join(home, 'sessions'), 0);
}

export function turnUsage(total: CodexUsage, previous: CodexUsage): CodexUsage {
  // Compaction/runtime versions can reset the cumulative counters.
  if (total.inputTokens < previous.inputTokens || total.outputTokens < previous.outputTokens) return total;
  return { inputTokens: total.inputTokens - previous.inputTokens, outputTokens: total.outputTokens - previous.outputTokens, cachedInputTokens: Math.max(0, total.cachedInputTokens - previous.cachedInputTokens) };
}
