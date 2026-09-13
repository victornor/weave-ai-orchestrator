/** The V2 workspace-override model (VS-348): baseline, state, diff and the one-source count. */
import { describe, expect, it } from 'vitest';
import { agentOverrideState, baselineAgent, countOverrides, diffSetting, optionOverrideState } from '../v2/settings/override';
import type { DaemonModels, ModelSetting, WorkerModelOption } from '../api/types';

const setting = (runtime: string, model: string | null, effort?: string): ModelSetting => ({ runtime, model, ...(effort !== undefined ? { effort } : {}) });

describe('the override baseline', () => {
  it('is the daemon overlay when filled, else the built-in default', () => {
    const daemon: DaemonModels = { weaver: setting('opencode', 'deepseek'), workers: null, workerOptions: null };
    expect(baselineAgent(daemon, 'weaver')).toEqual(setting('opencode', 'deepseek'));
    expect(baselineAgent(daemon, 'workers')).toEqual({ runtime: 'claude', model: null });
    expect(baselineAgent(undefined, 'weaver')).toEqual({ runtime: 'claude', model: null });
  });
});

describe('the override state and diff', () => {
  it('reads inherited when the value equals the baseline and overridden when it differs', () => {
    const base = setting('claude', 'opus', 'high');
    expect(agentOverrideState(setting('claude', 'opus', 'high'), base)).toBe('inherited');
    expect(agentOverrideState(setting('claude', 'opus', 'max'), base)).toBe('overridden');
    expect(agentOverrideState(setting('claude', 'sonnet', 'high'), base)).toBe('overridden');
  });

  it('names only the fields that differ', () => {
    expect(diffSetting(setting('claude', 'opus', 'max'), setting('claude', 'opus', 'high'))).toEqual(['thinking high → max']);
    expect(diffSetting(setting('opencode', 'deepseek', 'high'), setting('claude', 'opus', 'high'))).toEqual([
      'runtime claude → opencode',
      'model opus → deepseek',
    ]);
    expect(diffSetting(setting('claude', 'opus', 'high'), setting('claude', 'opus', 'high'))).toEqual([]);
  });

  it('compares worker options by id and reports inherited when the daemon has none', () => {
    const base: WorkerModelOption = { id: 'deep', description: 'x', runtime: 'claude', model: 'opus', effort: 'high' };
    const own: WorkerModelOption = { ...base, effort: 'max' };
    expect(optionOverrideState(own, base)).toBe('overridden');
    expect(optionOverrideState(base, base)).toBe('inherited');
    expect(optionOverrideState(own, undefined)).toBe('inherited');
  });
});

describe('the one-source override count', () => {
  it('counts overridden agents and options from the same comparison', () => {
    const daemon: DaemonModels = { weaver: setting('claude', 'opus', 'high'), workers: null, workerOptions: null };
    const effective = {
      weaver: setting('claude', 'opus', 'max'),
      workers: setting('claude', 'sonnet', 'high'),
      workerOptions: [],
    };
    expect(countOverrides(effective, daemon)).toEqual({ agents: 2, options: 0 });
  });

  it('counts nothing when everything inherits', () => {
    expect(countOverrides({ weaver: setting('claude', null), workers: setting('claude', null), workerOptions: [] }, undefined)).toEqual({ agents: 0, options: 0 });
  });
});
