import { describe, expect, it } from 'vitest';
import { DEFAULT_MERGE_CONCURRENCY, ProjectPoliciesSchema, mergeConcurrencyOf } from './config.js';

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
