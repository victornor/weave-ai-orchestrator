import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MERGE_CONCURRENCY, DEFAULT_MODEL_SETTING, DEFAULT_WORKER_TIERS, DEFAULT_WORKSPACE_MODELS, DaemonConfigSchema, DaemonModelsSchema, ModelSettingSchema, PresentationConfigSchema, ProjectConfigSchema, ProjectPoliciesSchema, RoleSpecSchema, WorkerModelOptionSchema, WorkspaceConfigSchema, WorkspaceDefaultsSchema, WorkspaceModelsSchema, daemonConfigToLegacySpelling, isWorkerOptionConfigured, mergeConcurrencyOf, toLegacyRoleSpec, toLegacySpelling, withKeyAlias, yoloEnabled } from './config.js';

describe('project config: landingBranch (VS-119)', () => {
  it('parses without a landing branch declared', () => {
    const cfg = ProjectConfigSchema.parse({ id: 'api', url: 'git@example.com:acme/api.git' });
    expect(cfg.landingBranch).toBeUndefined();
  });

  it('parses a declared landing branch', () => {
    const cfg = ProjectConfigSchema.parse({ id: 'fernwood', url: 'git@example.com:acme/fernwood.git', landingBranch: 'edge' });
    expect(cfg.landingBranch).toBe('edge');
  });
});

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

describe('stalledWorkerTimeoutSec default (VS-202)', () => {
  it('defaults to 300 seconds, and accepts an override', () => {
    expect(WorkspaceDefaultsSchema.parse({}).stalledWorkerTimeoutSec).toBe(300);
    expect(WorkspaceDefaultsSchema.parse({ stalledWorkerTimeoutSec: 900 }).stalledWorkerTimeoutSec).toBe(900);
  });

  it('a full workspace config with no override still parses, defaulting to 300', () => {
    const cfg = WorkspaceConfigSchema.parse({ version: 1, id: 'acme', name: 'Acme', ticketPrefix: 'ACME' });
    expect(cfg.defaults.stalledWorkerTimeoutSec).toBe(300);
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

describe('daemon config: transcription', () => {
  it('defaults dictation to chrome with no model', () => {
    const cfg = DaemonConfigSchema.parse({});
    expect(cfg.transcription.backend).toBe('chrome');
    expect(cfg.transcription.model).toBeUndefined();
    expect(cfg.transcription.provider).toBe('none');
  });

  it('still parses a yaml command provider', () => {
    const cfg = DaemonConfigSchema.parse({ transcription: { provider: 'command', command: 'whisper -' } });
    expect(cfg.transcription.provider).toBe('command');
    expect(cfg.transcription.command).toBe('whisper -');
    expect(cfg.transcription.backend).toBe('chrome');
  });

  it('accepts voxtype backend and a model', () => {
    const cfg = DaemonConfigSchema.parse({ transcription: { backend: 'voxtype', model: 'base.en' } });
    expect(cfg.transcription.backend).toBe('voxtype');
    expect(cfg.transcription.model).toBe('base.en');
  });
});

describe('daemon config: models overlays (VS-185)', () => {
  it('defaults to no filled overlays', () => {
    const cfg = DaemonConfigSchema.parse({});
    expect(cfg.models.weaver).toBeUndefined();
    expect(cfg.models.workers).toBeUndefined();
    expect(cfg.models.workerOptions).toBeUndefined();
  });

  it('fills weaver independently', () => {
    const cfg = DaemonConfigSchema.parse({
      models: { weaver: { runtime: 'claude', model: 'claude-fable-5-1' } },
    });
    expect(cfg.models.weaver).toEqual({ runtime: 'claude', model: 'claude-fable-5-1' });
    expect(cfg.models.workers).toBeUndefined();
    expect(cfg.models.workerOptions).toBeUndefined();
  });

  it('parses an empty workerOptions list and rejects a duplicate id', () => {
    expect(DaemonConfigSchema.parse({ models: { workerOptions: [] } }).models.workerOptions).toEqual([]);
    expect(DaemonConfigSchema.safeParse({
      models: {
        workerOptions: [
          { id: 'cheap', description: 'a', runtime: 'claude', model: null },
          { id: 'cheap', description: 'b', runtime: 'codex', model: null },
        ],
      },
    }).success).toBe(false);
  });
});

describe('worker option runtime unset (VS-236)', () => {
  it('parses an omitted runtime as null, not claude', () => {
    expect(WorkerModelOptionSchema.parse({ id: 'quick', description: 'x' })).toEqual({
      id: 'quick', description: 'x', runtime: null, model: null,
    });
  });

  it('keeps an explicit runtime configured', () => {
    expect(WorkerModelOptionSchema.parse({ id: 'quick', description: 'x', runtime: 'codex', model: null })).toEqual({
      id: 'quick', description: 'x', runtime: 'codex', model: null,
    });
    expect(isWorkerOptionConfigured({ id: 'quick', description: 'x', runtime: 'codex', model: null })).toBe(true);
    expect(isWorkerOptionConfigured({ id: 'quick', description: 'x', runtime: null, model: null })).toBe(false);
  });

  it('does not change weaver/workers defaults or empty daemon overlays', () => {
    expect(ModelSettingSchema.parse({})).toEqual({ runtime: 'claude', model: null });
    const cfg = DaemonConfigSchema.parse({});
    expect(cfg.models.weaver).toBeUndefined();
    expect(cfg.models.workers).toBeUndefined();
    expect(cfg.models.workerOptions).toBeUndefined();
  });

  it('seeds three unconfigured tiers with the verbatim descriptions', () => {
    expect(DEFAULT_WORKER_TIERS.map((o) => o.id)).toEqual(['quick', 'standard', 'deep']);
    expect(DEFAULT_WORKER_TIERS.every((o) => o.runtime === null && o.model === null)).toBe(true);
    expect(DEFAULT_WORKER_TIERS[0]!.description).toBe(
      'Fastest. The fix is already located and specified — a known one-liner, rename, or config value. No diagnosis, no design choice, nothing production-facing.',
    );
    expect(DEFAULT_WORKER_TIERS[1]!.description).toBe(
      'Default for specified work: cause known, approach clear, but spans several files or needs judgement on tests and edge cases. Not for finding out why something broke.',
    );
    expect(DEFAULT_WORKER_TIERS[2]!.description).toBe(
      'Cause unknown, a design decision is open, or it touches production or shared infrastructure. All scouts. "Find out why" belongs here however small the fix looks.',
    );
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

  it('gives a workspace that names no models neither setting configured (VS-284)', () => {
    const cfg = WorkspaceConfigSchema.parse(base);
    expect(cfg.models.weaver).toBeUndefined();
    expect(cfg.models.workers).toBeUndefined();
    expect(cfg.models.workerOptions).toEqual([]);
  });

  it('keeps effort, which is the only place it can still be set', () => {
    const cfg = WorkspaceConfigSchema.parse({ ...base, models: { workers: { runtime: 'codex', model: 'gpt-5', effort: 'high' } } });
    expect(cfg.models.workers).toEqual({ runtime: 'codex', model: 'gpt-5', effort: 'high' });
    // The setting the config did not name stays unconfigured (VS-284) rather than acquiring the
    // schema's own defaults, so it is distinguishable from a deliberate claude/no-model choice.
    expect(cfg.models.weaver).toBeUndefined();
  });

  it('rejects a setting with an empty runtime', () => {
    expect(WorkspaceConfigSchema.safeParse({ ...base, models: { workers: { runtime: '' } } }).success).toBe(false);
  });

  it('a configured setting is a real ModelSetting, distinct from unconfigured (VS-284)', () => {
    const cfg = WorkspaceConfigSchema.parse({ ...base, models: { weaver: { runtime: 'claude' } } });
    // Explicitly choosing claude with no model pinned is a configured setting, not "unset".
    expect(cfg.models.weaver).toEqual({ runtime: 'claude', model: null });
    expect(cfg.models.workers).toBeUndefined();
  });

  it('ignores the layered runtime and model keys an older workspace.yaml carries', () => {
    const cfg = WorkspaceConfigSchema.parse({
      ...base,
      defaults: { runtime: 'codex', model: 'gpt-5' },
      weaver: { runtime: 'opencode', model: 'grok', effort: 'low', humanName: 'captain' },
      projects: [{ id: 'api', url: 'git@example.com:acme/api.git', runtime: 'gemini', model: 'flash' }],
    });
    expect(cfg.defaults).not.toHaveProperty('runtime');
    expect(cfg.defaults).not.toHaveProperty('model');
    expect(cfg.weaver).not.toHaveProperty('runtime');
    expect(cfg.weaver).not.toHaveProperty('model');
    expect(cfg.weaver).not.toHaveProperty('effort');
    expect(cfg.weaver.humanName).toBe('captain');
    expect(cfg.projects[0]).not.toHaveProperty('runtime');
    expect(cfg.projects[0]).not.toHaveProperty('model');
    // Nothing layered survives, and neither setting is configured by a fresh parse (VS-284).
    expect(cfg.models).toEqual({ workerOptions: [] });
  });

  it('parses a worker-options catalog and rejects a duplicate id (VS-162)', () => {
    const cfg = WorkspaceConfigSchema.parse({
      ...base,
      models: {
        workers: { runtime: 'claude', model: 'claude-opus-5' },
        workerOptions: [
          { id: 'cheap', description: 'Scouts and low complexity.', runtime: 'opencode', model: 'glm-4.6' },
          { id: 'strong', description: 'Backend-heavy changes.', runtime: 'claude', model: 'claude-opus-5', effort: 'high' },
        ],
      },
    });
    expect(cfg.models.workerOptions).toHaveLength(2);
    expect(cfg.models.workerOptions[0]).toMatchObject({ id: 'cheap', description: 'Scouts and low complexity.', runtime: 'opencode', model: 'glm-4.6' });
    expect(WorkspaceConfigSchema.safeParse({
      ...base,
      models: {
        workerOptions: [
          { id: 'cheap', description: 'a', runtime: 'claude', model: null },
          { id: 'cheap', description: 'b', runtime: 'codex', model: null },
        ],
      },
    }).success).toBe(false);
  });
});

describe('WorkspaceModelsSchema: unconfigured is representable (VS-284)', () => {
  it('parses {} to neither setting configured', () => {
    const models = WorkspaceModelsSchema.parse({});
    expect(models).toEqual({ workerOptions: [] });
    expect(models.weaver).toBeUndefined();
    expect(models.workers).toBeUndefined();
  });

  it('configuring one setting leaves the other unconfigured', () => {
    const models = WorkspaceModelsSchema.parse({ weaver: { runtime: 'codex' } });
    expect(models.weaver).toEqual({ runtime: 'codex', model: null });
    expect(models.workers).toBeUndefined();
  });

  it('DEFAULT_MODEL_SETTING and DEFAULT_WORKSPACE_MODELS are the last-resort default, not a stored value', () => {
    expect(DEFAULT_MODEL_SETTING).toEqual({ runtime: 'claude', model: null });
    expect(DEFAULT_WORKSPACE_MODELS).toEqual({ weaver: DEFAULT_MODEL_SETTING, workers: DEFAULT_MODEL_SETTING, workerOptions: [] });
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

describe('withKeyAlias (VS-263)', () => {
  const inner = z.object({ weaver: z.string().default('x'), other: z.number().default(1) });
  const aliased = withKeyAlias(inner, 'conductor', 'weaver');

  it('resolves the old key to the new one', () => {
    expect(aliased.parse({ conductor: 'foo' })).toEqual({ weaver: 'foo', other: 1 });
  });

  it('resolves the new key as given', () => {
    expect(aliased.parse({ weaver: 'bar' })).toEqual({ weaver: 'bar', other: 1 });
  });

  it('falls back to the default when neither is present', () => {
    expect(aliased.parse({})).toEqual({ weaver: 'x', other: 1 });
  });

  it('refuses both spellings present at once, naming both', () => {
    const result = aliased.safeParse({ conductor: 'foo', weaver: 'bar' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('conductor');
      expect(result.error.issues[0]?.message).toContain('weaver');
    }
  });
});

describe('config key rename: conductor -> weaver (VS-263)', () => {
  const base = { version: 1 as const, id: 'acme', name: 'Acme', ticketPrefix: 'ACME' };

  it('WorkspaceModelsSchema accepts either spelling for the same value', () => {
    const viaOld = WorkspaceModelsSchema.parse({ conductor: { runtime: 'codex', model: 'gpt-5' } });
    const viaNew = WorkspaceModelsSchema.parse({ weaver: { runtime: 'codex', model: 'gpt-5' } });
    expect(viaOld.weaver).toEqual({ runtime: 'codex', model: 'gpt-5' });
    expect(viaNew.weaver).toEqual({ runtime: 'codex', model: 'gpt-5' });
  });

  it('WorkspaceModelsSchema refuses both spellings at once', () => {
    expect(WorkspaceModelsSchema.safeParse({
      conductor: { runtime: 'codex' }, weaver: { runtime: 'claude' },
    }).success).toBe(false);
  });

  it('DaemonModelsSchema accepts the legacy key', () => {
    const cfg = DaemonModelsSchema.parse({ conductor: { runtime: 'claude', model: 'claude-fable-5-1' } });
    expect(cfg.weaver).toEqual({ runtime: 'claude', model: 'claude-fable-5-1' });
  });

  it('WorkspaceConfigSchema accepts the legacy top-level block and refuses both', () => {
    const cfg = WorkspaceConfigSchema.parse({ ...base, conductor: { humanName: 'captain' } });
    expect(cfg.weaver.humanName).toBe('captain');
    expect(WorkspaceConfigSchema.safeParse({
      ...base, conductor: { humanName: 'a' }, weaver: { humanName: 'b' },
    }).success).toBe(false);
  });

  it('WorkspaceDefaultsSchema accepts the legacy digest-interval key', () => {
    expect(WorkspaceDefaultsSchema.parse({ conductorDigestIntervalSec: 5 }).weaverDigestIntervalSec).toBe(5);
    expect(WorkspaceDefaultsSchema.parse({ weaverDigestIntervalSec: 5 }).weaverDigestIntervalSec).toBe(5);
    expect(WorkspaceDefaultsSchema.safeParse({
      conductorDigestIntervalSec: 5, weaverDigestIntervalSec: 9,
    }).success).toBe(false);
  });

  it('WorkspaceDefaultsSchema still enforces the handover-minutes refine after the alias wrap', () => {
    expect(WorkspaceDefaultsSchema.safeParse({
      handoverQuietMinutes: 500, handoverAbandonTimeoutMinutes: 10,
    }).success).toBe(false);
  });

  it('PresentationConfigSchema accepts the legacy conductor block', () => {
    const cfg = PresentationConfigSchema.parse({ conductor: { surface: 'tmux' } });
    expect(cfg.weaver).toEqual({ surface: 'tmux' });
  });

  it('RoleSpecSchema.createdBy accepts the legacy value and defaults to the new one', () => {
    expect(RoleSpecSchema.parse({
      id: 'backend', name: 'Backend', project: 'api', charterSummary: 'x', scope: 'y', createdBy: 'conductor',
    }).createdBy).toBe('weaver');
    expect(RoleSpecSchema.parse({
      id: 'backend', name: 'Backend', project: 'api', charterSummary: 'x', scope: 'y',
    }).createdBy).toBe('weaver');
  });

  it('ProjectPoliciesSchema and WorkspaceDefaultsSchema accept the legacy APPROVAL_OWNERS value', () => {
    expect(ProjectPoliciesSchema.parse({ proposalApproval: 'conductor' }).proposalApproval).toBe('weaver');
    expect(ProjectPoliciesSchema.parse({ taskApproval: 'conductor' }).taskApproval).toBe('weaver');
    expect(WorkspaceDefaultsSchema.parse({ proposalApproval: 'conductor' }).proposalApproval).toBe('weaver');
    expect(WorkspaceDefaultsSchema.parse({ hireApproval: 'conductor' }).hireApproval).toBe('weaver');
  });

  it('recovers every setting from a workspace.yaml shaped like this workspace\'s real one (acceptance criterion 5)', () => {
    // Modeled on this ticket's own description of the live workspace.yaml's shape (a worker cannot
    // read the actual live file — outside the worktree, and against this project's own rules — so
    // this is built from what the ticket's filing quoted, not a hand-simplified object).
    const legacyWorkspaceYaml = {
      version: 1 as const,
      id: 'fern-services',
      name: 'V Services',
      ticketPrefix: 'VS',
      defaults: {
        proposalApproval: 'human',
        hireApproval: 'human',
      },
      models: {
        conductor: { runtime: 'claude', model: 'claude-opus-5' },
        workers: { runtime: 'claude', model: 'claude-sonnet-5' },
      },
      conductor: {
        channels: ['web', 'cli'],
        heartbeatIntervalSec: 300,
        humanName: 'captain',
      },
      projects: [{ id: 'agent-conductor', url: 'git@example.com:acme/agent-conductor.git' }],
    };
    const cfg = WorkspaceConfigSchema.parse(legacyWorkspaceYaml);
    expect(cfg.models.weaver).toEqual({ runtime: 'claude', model: 'claude-opus-5' });
    expect(cfg.models.workers).toEqual({ runtime: 'claude', model: 'claude-sonnet-5' });
    expect(cfg.weaver.humanName).toBe('captain');
    expect(cfg.weaver.heartbeatIntervalSec).toBe(300);
    expect(cfg.weaver.channels).toEqual(['web', 'cli']);
    expect(cfg.projects[0]?.id).toBe('agent-conductor');
  });
});

describe('toLegacySpelling / daemonConfigToLegacySpelling (VS-263 Decision 6)', () => {
  const base = { version: 1 as const, id: 'acme', name: 'Acme', ticketPrefix: 'ACME' };

  it('reverts every governed workspace.yaml field to its old spelling', () => {
    const cfg = WorkspaceConfigSchema.parse({
      ...base,
      weaver: { humanName: 'captain', channels: ['web'] },
      models: { weaver: { runtime: 'codex', model: 'gpt-5' } },
      defaults: { weaverDigestIntervalSec: 5, proposalApproval: 'weaver', hireApproval: 'weaver' },
      presentation: { weaver: { surface: 'tmux' } },
    });
    const legacy = toLegacySpelling(cfg) as Record<string, unknown>;
    expect(legacy).not.toHaveProperty('weaver');
    expect(legacy['conductor']).toEqual({ humanName: 'captain', channels: ['web'] });
    expect((legacy['models'] as Record<string, unknown>)['conductor']).toEqual({ runtime: 'codex', model: 'gpt-5' });
    expect((legacy['models'] as Record<string, unknown>)).not.toHaveProperty('weaver');
    const defaults = legacy['defaults'] as Record<string, unknown>;
    expect(defaults['conductorDigestIntervalSec']).toBe(5);
    expect(defaults['proposalApproval']).toBe('conductor');
    expect(defaults['hireApproval']).toBe('conductor');
    expect(defaults).not.toHaveProperty('weaverDigestIntervalSec');
    expect((legacy['presentation'] as Record<string, unknown>)['conductor']).toEqual({ surface: 'tmux' });
  });

  it('a value round-tripped through toLegacySpelling parses back to the same in-memory config', () => {
    const cfg = WorkspaceConfigSchema.parse({ ...base, weaver: { humanName: 'captain' } });
    const reparsed = WorkspaceConfigSchema.parse(toLegacySpelling(cfg));
    expect(reparsed).toEqual(cfg);
  });

  it('reverts daemon.yaml models.weaver to models.conductor', () => {
    const cfg = DaemonConfigSchema.parse({ models: { weaver: { runtime: 'claude', model: 'x' } } });
    const legacy = daemonConfigToLegacySpelling(cfg) as { models: Record<string, unknown> };
    expect(legacy.models['conductor']).toEqual({ runtime: 'claude', model: 'x' });
    expect(legacy.models).not.toHaveProperty('weaver');
  });

  it('reverts a role file\'s createdBy to the legacy value, and round-trips through RoleSpecSchema', () => {
    const spec = RoleSpecSchema.parse({
      id: 'backend', name: 'Backend', project: 'api', charterSummary: 'x', scope: 'y', createdBy: 'weaver',
    });
    const legacy = toLegacyRoleSpec(spec) as Record<string, unknown>;
    expect(legacy['createdBy']).toBe('conductor');
    const reparsed = RoleSpecSchema.parse(legacy);
    expect(reparsed.createdBy).toBe('weaver');
  });
});
