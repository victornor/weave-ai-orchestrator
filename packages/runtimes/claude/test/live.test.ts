import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RuntimeEvent, TurnInput } from '@openconductor/runtime-sdk';
import { RUN_REPORT_JSON_SCHEMA } from '@openconductor/shared';
import { adapter } from '../src/adapter.js';

// Real `claude` turn. Opt in with OC_LIVE_RUNTIME_TESTS=1 (costs tokens, needs auth).
const live = process.env['OC_LIVE_RUNTIME_TESTS'] === '1';

describe.skipIf(!live)('claude live turn', () => {
  it('returns a structured report matching the output schema', async () => {
    const home = mkdtempSync(join(tmpdir(), 'oc-live-claude-'));
    try {
      const input: TurnInput = {
        runId: `live-${Date.now()}`, turnEpoch: 1, cwd: home, worktree: null,
        session: { policy: 'fresh', ref: null, isFirstTurn: true },
        systemPrompt: { text: 'You are an OpenConductor test agent. Answer briefly.', mode: 'inject' },
        prompt: 'Do nothing. Finish with the structured report: state "idle", summary "live runtime smoke test".',
        outputSchema: RUN_REPORT_JSON_SCHEMA as unknown as Record<string, unknown>,
        mcpServers: {}, env: {}, options: { model: 'haiku' },
        limits: { timeoutMs: 300_000, maxTurns: 3 },
        permission: { mode: 'restricted' },
      };
      const events: RuntimeEvent[] = [];
      const result = await adapter.runTurn(input, {
        onSpawn: () => undefined,
        onEvent: (e) => { events.push(e); },
        onRaw: () => undefined,
      });

      expect(result.error).toBeUndefined();
      expect(result.exitCode).toBe(0);
      expect(result.session).toMatchObject({ sessionId: expect.any(String) });
      expect(events[0]!.type).toBe('session.started');
      expect(events.at(-1)!.type).toBe('turn.completed');
      expect(result.structured).toMatchObject({ state: expect.any(String), summary: expect.any(String) });
      expect(result.usage?.basis).toBe('per_turn');
      expect(result.usage!.outputTokens).toBeGreaterThan(0);
      expect(result.cost?.status).toBe('reported');
      expect(result.model).toContain('claude');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 330_000);

});
