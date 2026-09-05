import { describe, expect, it } from 'vitest';
import { DEFAULT_MERGE_CONCURRENCY, DaemonConfigSchema, ProjectPoliciesSchema, mergeConcurrencyOf } from './config.js';

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
