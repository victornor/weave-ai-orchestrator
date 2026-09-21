import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProviderProfile } from '@weave-ai/shared';
import type { TurnInput } from '@weave-ai/runtime-sdk';
import { interruptedTurn, writeFakeProcess } from '@weave-ai/runtime-sdk';
import { createAdapter } from '../src/index.js';

// VS-660: the built-in runtime's interrupt is "abort and flush" — cancel aborts the concurrency
// gate and signals the agent child; the child's bin aborts on SIGINT and flushes a result with
// exitCode 143. The same fake-process harness stands in for the child (as the adapter's `entry`):
// it emits a turn.started event and cannot exit on its own, so only the interrupt can end it.
const profile: ProviderProfile = { baseUrl: 'https://llm.example.test/v1', apiKeySecret: 'WEAVE_LLM_TEST_KEY', auth: 'bearer', headers: {}, discover: false, models: { 'big-model': { contextWindow: 128000 } } };

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('weave adapter — interrupt (abort and flush)', () => {
  it('SIGINTs the agent child, stops the turn on its flushed result, and keeps the events recorded before the cut', async () => {
    const turnStarted = JSON.stringify({ t: 'event', ev: { ts: new Date().toISOString(), type: 'turn.started', payload: {} } });
    const flushed = JSON.stringify({ t: 'result', result: { exitCode: 143, signal: 'SIGTERM', timedOut: false, session: null, finalText: null } });
    // The child is run as `node <entry>`; an extensionless name keeps the fake a CommonJS script.
    const fake = writeFakeProcess({ name: 'fake-agent', lines: [turnStarted], onInterrupt: { lines: [flushed], exitCode: 143 } });
    dirs.push(fake.dir);
    const cwd = mkdtempSync(join(tmpdir(), 'ac-weave-interrupt-'));
    dirs.push(cwd);
    const adapter = createAdapter({ entry: fake.bin, host: { providers: () => ({ test: profile }) } });

    const input: TurnInput = {
      runId: 'run-660', turnEpoch: 1, cwd, worktree: null,
      session: { policy: 'resume', ref: null, isFirstTurn: true },
      systemPrompt: { text: '', mode: 'skip' }, prompt: 'go',
      mcpServers: {}, env: { WEAVE_LLM_TEST_KEY: 'sk-test' }, options: {},
      // Far longer than the harness bound, so a removed interrupt fails the test by timing out.
      limits: { timeoutMs: 60_000 }, permission: { mode: 'auto' }, model: 'test/big-model',
    };

    const { result, recorded } = await interruptedTurn(adapter, input, {
      until: (r) => r.events.some((e) => e.type === 'turn.started'),
      timeoutMs: 10_000,
    });

    expect(readFileSync(fake.marker, 'utf8')).toBe('SIGINT');
    expect(recorded.events.map((e) => e.type)).toContain('turn.started');
    expect(result).toMatchObject({ exitCode: 143, signal: 'SIGTERM', timedOut: false });
  });
});