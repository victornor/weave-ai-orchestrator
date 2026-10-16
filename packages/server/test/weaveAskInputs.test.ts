/**
 * VS-803: `weave_ask` with `single_choice` and `multiselect` inputs, end to end through the real
 * decisions service (not the fakes.ts double, which accepts any input). A card of several closed-set
 * questions is created with its choices intact, and the answer comes back keyed by input.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createCore, initLogger } from '@weave-ai/core';
import { DaemonConfigSchema } from '@weave-ai/shared';
import { makeHarness } from '../../core/src/testing/context.js';
import { createApp } from '../src/app.js';
import { runTokenSecret, signRunToken } from '../src/runtoken.js';
import type { AppDeps, WorkspaceRuntime } from '../src/types.js';

initLogger(process.env.AC_LOG_LEVEL ?? 'silent');

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; });

type ToolResponse = { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } };

async function boot() {
  const harness = makeHarness();
  cleanup = harness.cleanup;
  const services = createCore(harness.ctx);
  const runtime: WorkspaceRuntime = { id: harness.workspaceId, ctx: harness.ctx, services, channels: null, webhooks: null, push: null };
  const auth = { hasOperator: () => true, verify: () => ({ sessionId: 's1', operatorId: 'op1', kind: 'cli' as const }), totpEnabled: () => false } as unknown as AppDeps['auth'];
  const deps: AppDeps = {
    auth, daemon: DaemonConfigSchema.parse({}), workspaces: new Map([[harness.workspaceId, runtime]]),
    registries: harness.ctx.registries, listener: 'loopback', publicUrl: 'http://127.0.0.1:7433', version: 'test', uiDir: null,
  };
  const app = createApp(deps);
  const token = await signRunToken(runTokenSecret(harness.ctx.db), {
    workspaceId: harness.workspaceId, runId: 'run_1', agentId: harness.conductorId, agentKind: 'weaver',
    projectId: harness.projectId, ticketId: null, roleId: null,
  });
  const ask = async (input: Record<string, unknown>): Promise<ToolResponse> => {
    const res = await app.fetch(new Request(`http://127.0.0.1/api/w/${harness.workspaceId}/agent/tools/weave_ask`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ input }),
    }));
    return res.json() as Promise<ToolResponse>;
  };
  return { ask, services };
}

const choices = (...keys: string[]) => keys.map((k) => ({ key: k, label: k.toUpperCase() }));

describe('weave_ask inputs through the real decisions service (VS-803)', () => {
  it('creates one card from two single_choice questions and a multiselect, and returns the answers by input key', async () => {
    const { ask, services } = await boot();
    const res = await ask({
      title: 'Settle three things',
      inputs: [
        { key: 'owner', label: 'Who owns it?', type: 'single_choice', required: true, choices: choices('a', 'b') },
        { key: 'delivery', label: 'How is it delivered?', type: 'single_choice', required: true, choices: [{ key: 'pr', label: 'PR', recommended: true }, { key: 'branch', label: 'Branch' }], allowOther: true },
        { key: 'regions', label: 'Which regions?', type: 'multiselect', choices: choices('eu', 'us', 'ap') },
      ],
    });
    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);

    const id = res.data!['id'] as string;
    const stored = services.decisions.get(id);
    expect(stored.inputs?.map((i) => [i.key, i.type, (i.choices ?? []).map((c) => c.key)])).toEqual([
      ['owner', 'single_choice', ['a', 'b']],
      ['delivery', 'single_choice', ['pr', 'branch']],
      ['regions', 'multiselect', ['eu', 'us', 'ap']],
    ]);

    const answered = await services.decisions.answer({ kind: 'human', id: 'victor' }, id, { inputs: { owner: 'b', delivery: 'pr', regions: ['us', 'eu'] } });
    expect(answered.answerInputs).toEqual({ owner: 'b', delivery: 'pr', regions: ['eu', 'us'] });
  });

  it('still refuses a single_choice with fewer than two choices, and a multiselect with none', async () => {
    const { ask, services } = await boot();
    const one = await ask({ title: 'q', inputs: [{ key: 'owner', label: 'Owner', type: 'single_choice', choices: choices('a') }] });
    expect(one.ok).toBe(false);
    expect(one.error).toMatchObject({ code: 'validation', message: 'single_choice input "owner" needs at least two choices' });

    const none = await ask({ title: 'q', inputs: [{ key: 'regions', label: 'Regions', type: 'multiselect' }] });
    expect(none.error).toMatchObject({ code: 'validation', message: 'multiselect input "regions" needs at least one choice' });

    expect(services.decisions.list()).toHaveLength(0);
  });
});
