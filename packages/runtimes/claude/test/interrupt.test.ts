import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TurnInput } from '@weave-ai/runtime-sdk';
import { interruptedTurn, writeFakeProcess } from '@weave-ai/runtime-sdk';
import { adapter } from '../src/adapter.js';

// VS-660: claude's interrupt is signal-only — `cancel('interrupt')` sends SIGINT to the process
// group (runtime-sdk's shared primitive). A fake `claude` on PATH stands in for the CLI; it emits
// its init line and then cannot exit on its own, so only the interrupt can end the turn.
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function input(env: Record<string, string>): TurnInput {
  return {
    runId: `run-${Math.random().toString(36).slice(2)}`, turnEpoch: 1, cwd: tmpdir(), worktree: null,
    session: { policy: 'fresh', ref: null, isFirstTurn: true },
    systemPrompt: { text: '', mode: 'skip' }, prompt: 'do the thing',
    // The adapter's own timeout is far longer than the harness bound below, so a removed interrupt
    // fails the test by timing out rather than quietly resolving on spawnLines' timeout signal.
    mcpServers: {}, env, options: {}, limits: { timeoutMs: 60_000 }, permission: { mode: 'auto' },
  };
}

describe('claude adapter — interrupt (signal)', () => {
  it('SIGINTs the running CLI, stops the turn, and keeps the events recorded before the cut', async () => {
    const init = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake-claude', model: 'fake-model', cwd: '/tmp', permissionMode: 'default' });
    const fake = writeFakeProcess({ name: 'claude', lines: [init], onInterrupt: { exitCode: 130 } });
    dirs.push(fake.dir);

    const { result, recorded } = await interruptedTurn(
      adapter,
      input({ PATH: `${fake.dir}${delimiter}${process.env['PATH'] ?? ''}` }),
      { until: (r) => r.events.some((e) => e.type === 'session.started'), timeoutMs: 10_000 },
    );

    expect(readFileSync(fake.marker, 'utf8')).toBe('SIGINT');
    expect(result.timedOut).toBe(false);
    expect(recorded.events.map((e) => e.type)).toContain('session.started');
    expect(result.exitCode).toBe(130);
    expect(result.error).toBeDefined();
  });
});