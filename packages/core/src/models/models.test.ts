/**
 * Model selection: the derivation that migrates a workspace onto the two settings, the card a
 * mixed-runtime workspace gets, and the resolution a turn does (VS-77).
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createDecisionsService } from '../decisions/index.js';
import { createModelsService, deriveModelSettings, hasModelSettings, migrationSummary, recordPendingMigration, WORKERS_RUNTIME_CORRELATION } from './index.js';
import { modelSettingFor } from './resolve.js';
import type { ModelsService } from '../api.js';
import type { Decision } from '@agent-conductor/shared';

const HUMAN = { kind: 'human' as const, id: 'victor' };
const role = (runtimeId: string, model: string | null = null, effort: string | null = null) => ({ runtimeId, model, effort });

describe('modelSettingFor', () => {
  const config = {
    models: {
      conductor: { runtime: 'claude', model: 'claude-fable-5-1' },
      workers: { runtime: 'codex', model: 'gpt-5', effort: 'high' },
      workerOptions: [],
    },
  };

  it('gives the conductor its own setting and every worker the other', () => {
    expect(modelSettingFor(config, 'conductor')).toEqual({ runtime: 'claude', model: 'claude-fable-5-1' });
    expect(modelSettingFor(config, 'worker')).toEqual({ runtime: 'codex', model: 'gpt-5', effort: 'high' });
  });

  it('uses a ticket\'s catalog option when it still exists (VS-162)', () => {
    const withOpts = {
      models: {
        conductor: { runtime: 'claude', model: 'claude-fable-5-1' },
        workers: { runtime: 'codex', model: 'gpt-5', effort: 'high' },
        workerOptions: [
          { id: 'cheap', description: 'Scouts.', runtime: 'opencode', model: 'glm-4.6' },
        ],
      },
    };
    expect(modelSettingFor(withOpts, 'worker', { workerModelId: 'cheap' })).toEqual({ runtime: 'opencode', model: 'glm-4.6' });
    expect(modelSettingFor(withOpts, 'worker', { workerModelId: 'gone' })).toEqual({ runtime: 'codex', model: 'gpt-5', effort: 'high' });
    expect(modelSettingFor(withOpts, 'worker', { workerModelId: null })).toEqual({ runtime: 'codex', model: 'gpt-5', effort: 'high' });
    expect(modelSettingFor(withOpts, 'conductor', { workerModelId: 'cheap' })).toEqual({ runtime: 'claude', model: 'claude-fable-5-1' });
  });
});

describe('deriveModelSettings', () => {
  it('takes the conductor from its own block', () => {
    const m = deriveModelSettings({ conductor: { runtime: 'claude', model: 'claude-fable-5-1', effort: 'low' } }, []);
    expect(m.models.conductor).toEqual({ runtime: 'claude', model: 'claude-fable-5-1', effort: 'low' });
  });

  it('falls back to the workspace default for a conductor block that names nothing', () => {
    const m = deriveModelSettings({ defaults: { runtime: 'codex', model: 'gpt-5' }, conductor: { channels: ['web'] } }, []);
    expect(m.models.conductor).toEqual({ runtime: 'codex', model: 'gpt-5' });
  });

  it('reads the workers setting off the roles, which is what they were really running on', () => {
    const m = deriveModelSettings(
      { defaults: { runtime: 'claude', model: null } },
      [role('codex', 'gpt-5'), role('codex', 'gpt-5')],
    );
    expect(m.models.workers).toEqual({ runtime: 'codex', model: 'gpt-5' });
    expect(m.rule).toBe('roles');
    expect(m.ambiguous).toBe(false);
  });

  it('keeps an effort every role on the winning runtime agreed on, and drops one they did not', () => {
    expect(deriveModelSettings({}, [role('claude', null, 'high'), role('claude', null, 'high')]).models.workers.effort).toBe('high');
    expect(deriveModelSettings({}, [role('claude', null, 'high'), role('claude', null, 'low')]).models.workers.effort).toBeUndefined();
  });

  it('leaves the model to the runtime when the roles on the winning runtime disagree about it', () => {
    const m = deriveModelSettings({}, [role('claude', 'claude-opus-5'), role('claude', 'claude-fable-5-1')]);
    expect(m.models.workers).toEqual({ runtime: 'claude', model: null });
  });

  it('picks the most used runtime and says so when the roles disagree', () => {
    const m = deriveModelSettings({}, [role('claude'), role('claude'), role('codex')]);
    expect(m.models.workers.runtime).toBe('claude');
    expect(m.counts).toEqual([{ runtime: 'claude', roles: 2 }, { runtime: 'codex', roles: 1 }]);
    expect(m.rule).toBe('roles_mixed');
    expect(m.ambiguous).toBe(true);
  });

  it('breaks a tie the same way every time, so two loads cannot disagree', () => {
    const a = deriveModelSettings({}, [role('codex'), role('claude')]);
    const b = deriveModelSettings({}, [role('claude'), role('codex')]);
    expect(a.models.workers.runtime).toBe(b.models.workers.runtime);
    expect(a.ambiguous).toBe(true);
  });

  it('falls back to the workspace default when no role has been hired', () => {
    const m = deriveModelSettings({ defaults: { runtime: 'gemini', model: 'flash' } }, []);
    expect(m.models.workers).toEqual({ runtime: 'gemini', model: 'flash' });
    expect(m.rule).toBe('defaults');
    expect(m.ambiguous).toBe(false);
  });

  it('follows the conductor when nothing else names a runtime at all', () => {
    const m = deriveModelSettings({ conductor: { runtime: 'opencode', model: 'grok' } }, []);
    // The conductor's model is its own; the workers setting takes only the runtime.
    expect(m.models.workers).toEqual({ runtime: 'opencode', model: null });
    expect(m.rule).toBe('conductor');
  });

  it('lands on the schema defaults for an empty document', () => {
    const m = deriveModelSettings({}, []);
    expect(m.models).toEqual({ conductor: { runtime: 'claude', model: null }, workers: { runtime: 'claude', model: null }, workerOptions: [] });
  });

  it('explains itself in one line', () => {
    expect(migrationSummary(deriveModelSettings({}, [role('codex')]))).toContain('workers on codex');
  });

  it('knows a document that has already been migrated', () => {
    expect(hasModelSettings({ models: { conductor: {}, workers: {} } })).toBe(true);
    expect(hasModelSettings({ defaults: { runtime: 'claude' } })).toBe(false);
  });
});

describe('the models service', () => {
  let h: TestHarness;
  let models: ModelsService;
  let raised: Decision[];

  beforeEach(() => {
    h = makeHarness();
    raised = [];
    h.services.decisions = createDecisionsService(h.ctx, h.deps);
    h.services.workers = { ensureConductor: vi.fn(async () => ({})) } as never;
    models = createModelsService(h.ctx, h.deps);
    h.services.models = models;
  });
  afterEach(() => h.cleanup());

  const open = (): Decision[] => h.deps().decisions.list({ status: ['open'] });

  it('reads and replaces both settings', async () => {
    expect(models.get()).toEqual({ conductor: { runtime: 'claude', model: null }, workers: { runtime: 'claude', model: null }, workerOptions: [] });
    const next = await models.set(HUMAN, { conductor: { runtime: 'claude', model: 'claude-fable-5-1' }, workers: { runtime: 'codex', model: 'gpt-5', effort: 'high' } });
    expect(next.workers).toEqual({ runtime: 'codex', model: 'gpt-5', effort: 'high' });
    expect(next.workerOptions).toEqual([]);
    expect(models.get()).toEqual(next);
  });

  it('keeps workerOptions when PUT omits them and replaces when they are sent (VS-162)', async () => {
    const cheap = { id: 'cheap', description: 'Scouts.', runtime: 'opencode', model: 'glm-4.6' };
    await models.set(HUMAN, { conductor: { runtime: 'claude', model: null }, workers: { runtime: 'claude', model: null }, workerOptions: [cheap] });
    const kept = await models.set(HUMAN, { conductor: { runtime: 'claude', model: 'claude-fable-5-1' }, workers: { runtime: 'claude', model: null } });
    expect(kept.workerOptions).toEqual([cheap]);
    const cleared = await models.set(HUMAN, { conductor: { runtime: 'claude', model: null }, workers: { runtime: 'claude', model: null }, workerOptions: [] });
    expect(cleared.workerOptions).toEqual([]);
  });

  it('refuses a setting with no runtime rather than storing it', async () => {
    await expect(models.set(HUMAN, { conductor: { runtime: '', model: null }, workers: { runtime: 'claude', model: null } } as never))
      .rejects.toMatchObject({ code: 'validation' });
    expect(models.get().conductor.runtime).toBe('claude');
  });

  it('asks which runtime the workers should use when the migration could not settle it', () => {
    recordPendingMigration(h.db, h.workspaceId, deriveModelSettings({}, [role('claude'), role('claude'), role('codex')]));
    models.reconcile();
    raised = open();
    expect(raised).toHaveLength(1);
    expect(raised[0]!.kind).toBe('question');
    expect(raised[0]!.owner).toBe('human');
    expect(raised[0]!.correlationKey).toBe(WORKERS_RUNTIME_CORRELATION);
    expect(raised[0]!.options.map((o) => o.key)).toEqual(['runtime:claude', 'runtime:codex']);
    expect(raised[0]!.recommendation).toBe('runtime:claude');
    expect(raised[0]!.context).toContain('claude: 2 roles');
  });

  it('raises nothing when the migration settled it by itself', () => {
    models.reconcile();
    expect(open()).toHaveLength(0);
  });

  it('does not raise a second card on a restart', () => {
    recordPendingMigration(h.db, h.workspaceId, deriveModelSettings({}, [role('claude'), role('codex')]));
    models.reconcile();
    const first = open();
    models.reconcile();
    expect(open()).toEqual(first);
  });

  it('writes the answer to the workers setting and never asks again', async () => {
    recordPendingMigration(h.db, h.workspaceId, deriveModelSettings({}, [role('claude'), role('claude'), role('codex')]));
    models.reconcile();
    await h.deps().decisions.answer(HUMAN, open()[0]!.id, { key: 'runtime:codex' });

    expect(models.get().workers.runtime).toBe('codex');
    models.reconcile();
    expect(open()).toHaveLength(0);
  });

  it('leaves the conductor setting alone when the workers question is answered', async () => {
    await models.set(HUMAN, { conductor: { runtime: 'claude', model: 'claude-fable-5-1' }, workers: { runtime: 'claude', model: null } });
    recordPendingMigration(h.db, h.workspaceId, deriveModelSettings({}, [role('claude'), role('codex')]));
    models.reconcile();
    await h.deps().decisions.answer(HUMAN, open()[0]!.id, { key: 'runtime:codex' });
    expect(models.get().conductor).toEqual({ runtime: 'claude', model: 'claude-fable-5-1' });
  });
});
