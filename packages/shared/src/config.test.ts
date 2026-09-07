import { describe, expect, it } from 'vitest';
import { DEFAULT_MERGE_CONCURRENCY, DaemonConfigSchema, ProjectPoliciesSchema, RoleSpecSchema, WorkspaceConfigSchema, WorkspaceDefaultsSchema, mergeConcurrencyOf, yoloEnabled } from './config.js';

describe('project policies: mergeConcurrency', () => {
  it('leaves the value unset when the policies block does not mention it', () => {
    expect(ProjectPoliciesSchema.parse({}).mergeConcurrency).toBeUndefined();
  });

  it('accepts a configured limit inside the allowed range', () => {
    expect(ProjectPoliciesSchema.parse({ mergeConcurrency: 3 }).mergeConcurrency).toBe(3);
  });

  it('rejects a limit below one or above eight', () => {
    expect(ProjectPoliciesSchema.safeParse({ mergeConcurrency: 0 }).success).toBe(false);
    expect(ProjectPoliciesSchema.safeParse({ mergeConcurrency: 9 }).success).toBe(false);
    expect(ProjectPoliciesSchema.safeParse({ mergeConcurrency: 1.5 }).success).toBe(false);
  });

  it('reads the effective limit, falling back to one for anything unusable', () => {
    expect(mergeConcurrencyOf({ mergeConcurrency: 4 })).toBe(4);
    expect(mergeConcurrencyOf({})).toBe(DEFAULT_MERGE_CONCURRENCY);
    expect(mergeConcurrencyOf(null)).toBe(DEFAULT_MERGE_CONCURRENCY);
    expect(mergeConcurrencyOf(undefined)).toBe(DEFAULT_MERGE_CONCURRENCY);
    expect(mergeConcurrencyOf({ mergeConcurrency: 0 })).toBe(DEFAULT_MERGE_CONCURRENCY);
    expect(mergeConcurrencyOf({ mergeConcurrency: 'two' })).toBe(DEFAULT_MERGE_CONCURRENCY);
  });
});

describe('liveInput default (VS-99)', () => {
  it('defaults to true, so a workspace.yaml written before this change still parses live', () => {
    expect(WorkspaceDefaultsSchema.parse({}).liveInput).toBe(true);
    expect(WorkspaceDefaultsSchema.parse({ liveInput: false }).liveInput).toBe(false);
  });

  it('an existing full workspace config with no liveInput key still parses, defaulting to true', () => {
    const cfg = WorkspaceConfigSchema.parse({ version: 1, id: 'acme', name: 'Acme', ticketPrefix: 'ACME' });
    expect(cfg.defaults.liveInput).toBe(true);
  });
});

describe('YOLO mode: the setting', () => {
  it('is off unless the workspace turns it on', () => {
    expect(WorkspaceDefaultsSchema.parse({}).yolo).toBe(false);
    expect(WorkspaceDefaultsSchema.parse({ yolo: true }).yolo).toBe(true);
  });

  it('leaves the project override unset when the policies block does not mention it', () => {
    expect(ProjectPoliciesSchema.parse({}).yolo).toBeUndefined();
    expect(ProjectPoliciesSchema.parse({ yolo: false }).yolo).toBe(false);
  });

  it('inherits the workspace default when the project says nothing', () => {
    expect(yoloEnabled({}, true)).toBe(true);
    expect(yoloEnabled({}, false)).toBe(false);
    expect(yoloEnabled(null, true)).toBe(true);
    expect(yoloEnabled(undefined, false)).toBe(false);
  });

  it('lets a project override the workspace either way', () => {
    expect(yoloEnabled({ yolo: false }, true)).toBe(false);
    expect(yoloEnabled({ yolo: true }, false)).toBe(true);
  });

  it('inherits rather than guessing when the project value is unusable', () => {
    expect(yoloEnabled({ yolo: 'yes' }, false)).toBe(false);
    expect(yoloEnabled({ yolo: 'yes' }, true)).toBe(true);
    expect(yoloEnabled({ yolo: 1 }, false)).toBe(false);
  });
});

describe('daemon config: upgrade', () => {
  it('defaults the deferred upgrade timings when daemon.yaml says nothing', () => {
    const cfg = DaemonConfigSchema.parse({});
    expect(cfg.upgrade.waitForIdleSec).toBe(30);
    expect(cfg.upgrade.updateCheckIntervalSec).toBe(900);
  });

  it('leaves the existing upgrade keys alone', () => {
    const cfg = DaemonConfigSchema.parse({});
    expect(cfg.upgrade.ref).toBe('main');
    expect(cfg.upgrade.keep).toBe(3);
    expect(cfg.upgrade.drainTimeoutSec).toBe(30);
    expect(cfg.upgrade.source).toBeUndefined();
  });

  it('takes explicit values over the defaults', () => {
    const cfg = DaemonConfigSchema.parse({ upgrade: { waitForIdleSec: 60, updateCheckIntervalSec: 0 } });
    expect(cfg.upgrade.waitForIdleSec).toBe(60);
    expect(cfg.upgrade.updateCheckIntervalSec).toBe(0);
  });

  it('rejects a negative wait', () => {
    expect(DaemonConfigSchema.safeParse({ upgrade: { waitForIdleSec: -1 } }).success).toBe(false);
  });
});

describe('model selection: the two workspace settings', () => {
  const base = { version: 1 as const, id: 'acme', name: 'Acme', ticketPrefix: 'ACME' };

  it('gives a workspace that names no models both settings on the default runtime', () => {
    const cfg = WorkspaceConfigSchema.parse(base);
    expect(cfg.models.conductor).toEqual({ runtime: 'claude', model: null });
    expect(cfg.models.workers).toEqual({ runtime: 'claude', model: null });
  });

  it('keeps effort, which is the only place it can still be set', () => {
    const cfg = WorkspaceConfigSchema.parse({ ...base, models: { workers: { runtime: 'codex', model: 'gpt-5', effort: 'high' } } });
    expect(cfg.models.workers).toEqual({ runtime: 'codex', model: 'gpt-5', effort: 'high' });
    // The setting the config did not name still exists, on the defaults.
    expect(cfg.models.conductor).toEqual({ runtime: 'claude', model: null });
  });

  it('rejects a setting with an empty runtime', () => {
    expect(WorkspaceConfigSchema.safeParse({ ...base, models: { workers: { runtime: '' } } }).success).toBe(false);
  });

  it('ignores the layered runtime and model keys an older workspace.yaml carries', () => {
    const cfg = WorkspaceConfigSchema.parse({
      ...base,
      defaults: { runtime: 'codex', model: 'gpt-5' },
      conductor: { runtime: 'opencode', model: 'grok', effort: 'low', humanName: 'captain' },
      projects: [{ id: 'api', url: 'git@example.com:acme/api.git', runtime: 'gemini', model: 'flash' }],
    });
    expect(cfg.defaults).not.toHaveProperty('runtime');
    expect(cfg.defaults).not.toHaveProperty('model');
    expect(cfg.conductor).not.toHaveProperty('runtime');
    expect(cfg.conductor).not.toHaveProperty('model');
    expect(cfg.conductor).not.toHaveProperty('effort');
    expect(cfg.conductor.humanName).toBe('captain');
    expect(cfg.projects[0]).not.toHaveProperty('runtime');
    expect(cfg.projects[0]).not.toHaveProperty('model');
    // Nothing layered survives: the two settings are what a fresh parse produces.
    expect(cfg.models).toEqual({ conductor: { runtime: 'claude', model: null }, workers: { runtime: 'claude', model: null } });
  });
});

describe('model selection: a role carries no runtime', () => {
  const role = {
    id: 'backend', name: 'Backend Engineer', project: 'api',
    charterSummary: 'Owns the API', scope: 'The api repo',
  };

  it('parses a role that names none of them', () => {
    const spec = RoleSpecSchema.parse(role);
    expect(spec).not.toHaveProperty('runtime');
    expect(spec).not.toHaveProperty('model');
    expect(spec).not.toHaveProperty('effort');
  });

  it('rejects a strict patch that tries to set one', () => {
    for (const key of ['runtime', 'model', 'effort']) {
      expect(RoleSpecSchema.partial().strict().safeParse({ [key]: 'claude' }).success).toBe(false);
    }
  });
});
