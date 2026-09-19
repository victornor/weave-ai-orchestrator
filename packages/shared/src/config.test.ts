import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { compactionThreshold, DEFAULT_MERGE_CONCURRENCY, DEFAULT_MODEL_SETTING, DEFAULT_PROMOTION_MODE, DEFAULT_WORKER_TIERS, DEFAULT_WORKSPACE_MODELS, DaemonConfigSchema, DaemonModelsSchema, ModelSettingSchema, PresentationConfigSchema, ProjectConfigSchema, ProjectPoliciesSchema, promotionModeOf, promotionPrTitleOf, promotionStrategyOf, RoleSpecSchema, WorkerModelOptionSchema, WORKER_MEMORY_MIN_MB, WorkspaceConfigSchema, WorkspaceDefaultsSchema, WorkspaceModelsSchema, daemonConfigToLegacySpelling, deriveWorkerMemoryMb, isWorkerOptionConfigured, mergeConcurrencyOf, resolveWorkerMemoryMb, toLegacyRoleSpec, toLegacySpelling, withKeyAlias, yoloEnabled } from './config.js';

describe('automatic compaction policy', () => {
  it('is a fraction of the window for percent and the exact number for tokens', () => {
    expect(compactionThreshold({ mode: 'percent', value: 60 }, 1_000_000)).toBe(600_000);
    expect(compactionThreshold({ mode: 'tokens', value: 300_000 }, 1_000_000)).toBe(300_000);
    expect(compactionThreshold({ mode: 'tokens', value: 300_000 }, null)).toBe(300_000);
  });

  it('is null when off, when no value is set, or when a percent has no known window', () => {
    expect(compactionThreshold(undefined, 1_000_000)).toBeNull();
    expect(compactionThreshold({ mode: 'off' }, 1_000_000)).toBeNull();
    expect(compactionThreshold({ mode: 'percent' }, 1_000_000)).toBeNull();
    expect(compactionThreshold({ mode: 'percent', value: 60 }, null)).toBeNull();
    expect(compactionThreshold({ mode: 'percent', value: 0 }, 1_000_000)).toBeNull();
  });

  it('clamps a percent to 1–99 so it can never mean never or always', () => {
    expect(compactionThreshold({ mode: 'percent', value: 500 }, 1_000_000)).toBe(990_000);
    expect(compactionThreshold({ mode: 'percent', value: 0.1 }, 1_000_000)).toBe(10_000);
  });
});

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

describe('project config: knowledgeRepo (VS-358)', () => {
  it('defaults to disabled when omitted', () => {
    const cfg = ProjectConfigSchema.parse({ id: 'api', url: 'git@example.com:acme/api.git' });
    expect(cfg.knowledgeRepo).toEqual({ enabled: false });
  });

  it('parses an explicit opt-in', () => {
    const cfg = ProjectConfigSchema.parse({ id: 'api', url: 'git@example.com:acme/api.git', knowledgeRepo: { enabled: true } });
    expect(cfg.knowledgeRepo).toEqual({ enabled: true });
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

describe('project policies: promotion strategy (VS-584)', () => {
  it('leaves the mode unset when the policies block does not mention it', () => {
    expect(ProjectPoliciesSchema.parse({}).promotionMode).toBeUndefined();
    expect(ProjectPoliciesSchema.parse({ promotionMode: 'pull-request' }).promotionMode).toBe('pull-request');
  });

  it('rejects an unknown mode', () => {
    expect(ProjectPoliciesSchema.safeParse({ promotionMode: 'push' }).success).toBe(false);
  });

  it('defaults an absent or unusable mode to auto, never to a direct push', () => {
    expect(promotionModeOf({})).toBe(DEFAULT_PROMOTION_MODE);
    expect(promotionModeOf(null)).toBe(DEFAULT_PROMOTION_MODE);
    expect(promotionModeOf(undefined)).toBe(DEFAULT_PROMOTION_MODE);
    expect(promotionModeOf({ promotionMode: 'nonsense' })).toBe(DEFAULT_PROMOTION_MODE);
  });

  it('resolves auto to a pull request when a forge can open one, and to a direct push when none can', () => {
    expect(promotionStrategyOf({}, true)).toBe('pull-request');
    expect(promotionStrategyOf({}, false)).toBe('direct-push');
    expect(promotionStrategyOf({ promotionMode: 'auto' }, true)).toBe('pull-request');
  });

  it('honours an explicit mode regardless of the forge', () => {
    expect(promotionStrategyOf({ promotionMode: 'pull-request' }, false)).toBe('pull-request');
    expect(promotionStrategyOf({ promotionMode: 'direct-push' }, true)).toBe('direct-push');
  });

  it('reads a declared pull-request title, and null when none is usable', () => {
    expect(promotionPrTitleOf({ promotionPrTitle: 'Edge' })).toBe('Edge');
    expect(promotionPrTitleOf({ promotionPrTitle: '  Edge  ' })).toBe('Edge');
    expect(promotionPrTitleOf({})).toBeNull();
    expect(promotionPrTitleOf({ promotionPrTitle: '' })).toBeNull();
    expect(promotionPrTitleOf({ promotionPrTitle: 7 })).toBeNull();
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

describe('stalledWorkerMaxAutoRecoverAttempts default (VS-498)', () => {
  it('defaults to 2, and accepts an override', () => {
    expect(WorkspaceDefaultsSchema.parse({}).stalledWorkerMaxAutoRecoverAttempts).toBe(2);
    expect(WorkspaceDefaultsSchema.parse({ stalledWorkerMaxAutoRecoverAttempts: 0 }).stalledWorkerMaxAutoRecoverAttempts).toBe(0);
    expect(WorkspaceDefaultsSchema.parse({ stalledWorkerMaxAutoRecoverAttempts: 5 }).stalledWorkerMaxAutoRecoverAttempts).toBe(5);
  });

  it('a full workspace config with no override still parses, defaulting to 2', () => {
    const cfg = WorkspaceConfigSchema.parse({ version: 1, id: 'acme', name: 'Acme', ticketPrefix: 'ACME' });
    expect(cfg.defaults.stalledWorkerMaxAutoRecoverAttempts).toBe(2);
  });
});

describe('YOLO mode: the setting', () => {
  it('is a per-project setting with no workspace default', () => {
    // VS-382: `defaults.yolo` is gone; the schema strips it if an old config still carries it.
    expect('yolo' in WorkspaceDefaultsSchema.parse({})).toBe(false);
    expect('yolo' in WorkspaceDefaultsSchema.parse({ yolo: true })).toBe(false);
  });

  it('leaves the project value unset when the policies block does not mention it', () => {
    expect(ProjectPoliciesSchema.parse({}).yolo).toBeUndefined();
    expect(ProjectPoliciesSchema.parse({ yolo: false }).yolo).toBe(false);
    expect(ProjectPoliciesSchema.parse({ yolo: true }).yolo).toBe(true);
  });

  it('is off for a project that says nothing', () => {
    expect(yoloEnabled({})).toBe(false);
    expect(yoloEnabled(null)).toBe(false);
    expect(yoloEnabled(undefined)).toBe(false);
  });

  it('is on only for an explicit project true', () => {
    expect(yoloEnabled({ yolo: true })).toBe(true);
    expect(yoloEnabled({ yolo: false })).toBe(false);
  });

  it('is off rather than guessing when the project value is unusable', () => {
    expect(yoloEnabled({ yolo: 'yes' })).toBe(false);
    expect(yoloEnabled({ yolo: 1 })).toBe(false);
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

describe('worker option description accepts a newline (VS-322)', () => {
  it('parses a multi-line description unchanged and still enforces the 200 cap', () => {
    const description = 'First line.\nSecond line.';
    expect(WorkerModelOptionSchema.parse({ id: 'tier', description }).description).toBe(description);
    expect(WorkerModelOptionSchema.safeParse({ id: 'tier', description: 'x'.repeat(201) }).success).toBe(false);
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

describe('daemon config: host tool paths (VS-318)', () => {
  it('defaults to no configured directories, so a deployment needs zero configuration', () => {
    expect(DaemonConfigSchema.parse({}).hostToolPaths).toEqual([]);
  });

  it('keeps a populated list in order', () => {
    const cfg = DaemonConfigSchema.parse({ hostToolPaths: ['/opt/tools/bin', '/snap/bin'] });
    expect(cfg.hostToolPaths).toEqual(['/opt/tools/bin', '/snap/bin']);
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

describe('worker memory limits (VS-579)', () => {
  it('defaults to null, meaning derive, and refuses a value below the floor', () => {
    expect(WorkspaceDefaultsSchema.parse({}).workerMemoryMb).toBeNull();
    expect(RoleSpecSchema.parse({ id: 'r', name: 'R', project: 'p', charterSummary: 'x', scope: 'y' }).memoryLimitMb).toBeNull();
    expect(WorkspaceDefaultsSchema.safeParse({ workerMemoryMb: WORKER_MEMORY_MIN_MB - 1 }).success).toBe(false);
    expect(WorkspaceDefaultsSchema.safeParse({ workerMemoryMb: 4096 }).data?.workerMemoryMb).toBe(4096);
  });

  it('derives a share of memory split across the run concurrency', () => {
    expect(deriveWorkerMemoryMb(60 * 1024, 6)).toBe(Math.floor((60 * 1024 * 0.8) / 6));
    expect(deriveWorkerMemoryMb(1024, 6)).toBe(WORKER_MEMORY_MIN_MB);
  });

  it('resolves role over workspace over derived, and reports the source', () => {
    const base = { baseMemoryMb: 60 * 1024, maxConcurrentRuns: 6 };
    expect(resolveWorkerMemoryMb({ ...base, roleMb: 2048, workspaceMb: 4096 })).toEqual({ mb: 2048, source: 'role' });
    expect(resolveWorkerMemoryMb({ ...base, workspaceMb: 4096 })).toEqual({ mb: 4096, source: 'workspace' });
    expect(resolveWorkerMemoryMb({ ...base }).source).toBe('derived');
    expect(resolveWorkerMemoryMb({ ...base, roleMb: null, workspaceMb: null }).mb).toBe(deriveWorkerMemoryMb(60 * 1024, 6));
  });
});
