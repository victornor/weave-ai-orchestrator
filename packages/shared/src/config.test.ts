import { describe, expect, it } from 'vitest';
import { DEFAULT_MERGE_CONCURRENCY, DaemonConfigSchema, ProjectPoliciesSchema, WorkspaceDefaultsSchema, mergeConcurrencyOf, yoloEnabled } from './config.js';

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
    expect(cfg.upgrade.waitForIdleSec).toBe(3600);
    expect(cfg.upgrade.updateCheckIntervalSec).toBe(900);
  });

  it('leaves the existing upgrade keys alone', () => {
    const cfg = DaemonConfigSchema.parse({});
    expect(cfg.upgrade.ref).toBe('main');
    expect(cfg.upgrade.keep).toBe(3);
    expect(cfg.upgrade.drainTimeoutSec).toBe(900);
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
