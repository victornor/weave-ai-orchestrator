/** The V2 workspace-override model (VS-348, VS-356): source-derived state and the value diff. */
import { describe, expect, it } from 'vitest';
import { agentOverrideState, baselineAgent, countOverrides, diffSetting, optionOverrideState } from '../v2/settings/override';
import type { DaemonModels, ModelSetting, WorkspaceModelsSource } from '../api/types';

const setting = (runtime: string, model: string | null, effort?: string): ModelSetting => ({ runtime, model, ...(effort !== undefined ? { effort } : {}) });
const source = (weaver: 'workspace' | 'daemon' | 'default', workers: 'workspace' | 'daemon' | 'default', workerOptions: 'workspace' | 'daemon' | 'default'): WorkspaceModelsSource => ({ weaver, workers, workerOptions });

describe('the override baseline', () => {
  it('is the daemon overlay when filled, else the built-in default', () => {
    const daemon: DaemonModels = { weaver: setting('opencode', 'deepseek'), workers: null, workerOptions: null };
    expect(baselineAgent(daemon, 'weaver')).toEqual(setting('opencode', 'deepseek'));
    expect(baselineAgent(daemon, 'workers')).toEqual({ runtime: 'claude', model: null });
    expect(baselineAgent(undefined, 'weaver')).toEqual({ runtime: 'claude', model: null });
  });
});

describe('the override state', () => {
  it('reads an agent as overridden only when the API says the workspace stores it (VS-356)', () => {
    expect(agentOverrideState(source('workspace', 'daemon', 'default'), 'weaver')).toBe('overridden');
    expect(agentOverrideState(source('workspace', 'daemon', 'default'), 'workers')).toBe('inherited');
    expect(agentOverrideState(source('default', 'default', 'default'), 'weaver')).toBe('inherited');
    expect(agentOverrideState(undefined, 'weaver')).toBe('inherited');
  });

  it('reads the catalog as overridden only when the workspace stores its own (VS-356)', () => {
    expect(optionOverrideState(source('daemon', 'daemon', 'workspace'))).toBe('overridden');
    expect(optionOverrideState(source('daemon', 'daemon', 'daemon'))).toBe('inherited');
    expect(optionOverrideState(undefined)).toBe('inherited');
  });
});

describe('the value diff still names the difference', () => {
  it('names only the fields that differ', () => {
    expect(diffSetting(setting('claude', 'opus', 'max'), setting('claude', 'opus', 'high'))).toEqual(['thinking high → max']);
    expect(diffSetting(setting('opencode', 'deepseek', 'high'), setting('claude', 'opus', 'high'))).toEqual([
      'runtime claude → opencode',
      'model opus → deepseek',
    ]);
    expect(diffSetting(setting('claude', 'opus', 'high'), setting('claude', 'opus', 'high'))).toEqual([]);
  });
});

describe('the one-source override count', () => {
  it('counts the controls the source map marks overridden', () => {
    expect(countOverrides(source('workspace', 'workspace', 'default'))).toEqual({ agents: 2, options: 0 });
    expect(countOverrides(source('daemon', 'default', 'workspace'))).toEqual({ agents: 0, options: 1 });
  });

  it('counts nothing when everything inherits', () => {
    expect(countOverrides(source('daemon', 'default', 'default'))).toEqual({ agents: 0, options: 0 });
    expect(countOverrides(undefined)).toEqual({ agents: 0, options: 0 });
  });
});
