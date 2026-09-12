import { describe, expect, it } from 'vitest';
import { WorkerModelOptionSchema, WorkerOptionsArraySchema } from '@weave-ai/shared';
import { parseFieldIssues } from './schema-field';

const option = (overrides: Partial<{ id: string; description: string; runtime: string }> = {}): unknown => ({
  id: 'cheap',
  description: 'Scouts and low complexity.',
  runtime: 'claude',
  model: null,
  ...overrides,
});

describe('parseFieldIssues', () => {
  it('a valid value parses with no issues', () => {
    expect(parseFieldIssues(WorkerModelOptionSchema, option())).toEqual({ valid: true, byPath: {} });
  });

  it('an over-length description lands on the description field, at the schema’s own limit', () => {
    const max = WorkerModelOptionSchema.shape.description.maxLength;
    expect(max).toBeTypeOf('number');
    const r = parseFieldIssues(WorkerModelOptionSchema, option({ description: 'x'.repeat((max as number) + 1) }));
    expect(r.valid).toBe(false);
    expect(r.byPath.description).toBeTypeOf('string');
  });

  it('an id the slug rule rejects lands on the id field', () => {
    const r = parseFieldIssues(WorkerModelOptionSchema, option({ id: 'Cheap Model' }));
    expect(r.valid).toBe(false);
    expect(r.byPath.id).toBeTypeOf('string');
    expect(r.byPath.description).toBeUndefined();
  });

  it('an array-schema duplicate id keys by the field name, not the offending index', () => {
    const r = parseFieldIssues(WorkerOptionsArraySchema, [option(), option({ id: 'cheap', description: 'Another one.' })]);
    expect(r.valid).toBe(false);
    expect(r.byPath.id).toMatch('cheap');
  });

  it('an array-schema root issue (the catalog cap) keys as the empty path', () => {
    const many = Array.from({ length: 17 }, (_, i) => option({ id: `option-${i}` }));
    const r = parseFieldIssues(WorkerOptionsArraySchema, many);
    expect(r.valid).toBe(false);
    expect(r.byPath['']).toBeTypeOf('string');
  });

  it('a valid catalog parses clean', () => {
    expect(parseFieldIssues(WorkerOptionsArraySchema, [option(), option({ id: 'strong', description: 'Hard tickets.' })])).toEqual({
      valid: true,
      byPath: {},
    });
  });
});
