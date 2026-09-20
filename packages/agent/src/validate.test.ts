import { describe, expect, it } from 'vitest';
import { RUN_REPORT_JSON_SCHEMA } from '@weave-ai/shared';
import { validateAgainstSchema } from './validate.js';

const report = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  state: 'working', summary: 'did the thing', tickets: [{ id: 'VS-614', status: 'in_progress', note: null }],
  nextAction: { owner: 'self', what: 'finish' }, knowledge: { recorded: false, where: null, reason: 'none' }, uncommittedWork: false, ...over,
});

describe('validateAgainstSchema', () => {
  it('accepts a value that fits the run report schema', () => {
    expect(validateAgainstSchema(report(), RUN_REPORT_JSON_SCHEMA as unknown as Record<string, unknown>)).toEqual([]);
  });

  it('names a missing required property and an unexpected one, with its path', () => {
    const missing = report(); delete missing['knowledge'];
    expect(validateAgainstSchema(missing, RUN_REPORT_JSON_SCHEMA as unknown as Record<string, unknown>)).toEqual(['$: missing required property "knowledge"']);
    const extra = report({ nope: 1 });
    expect(validateAgainstSchema(extra, RUN_REPORT_JSON_SCHEMA as unknown as Record<string, unknown>)).toEqual(['$: unexpected property "nope"']);
  });

  it('reports a wrong type and a bad enum value, including inside an array item', () => {
    const schema = {
      type: 'object', additionalProperties: false, required: ['items'],
      properties: { items: { type: 'array', items: { type: 'object', required: ['content', 'status'], properties: { content: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] } } } } },
    };
    const errors = validateAgainstSchema({ items: [{ content: 'a', status: 'done' }, { status: 3 }] }, schema);
    expect(errors).toEqual([
      '$.items[0].status: expected one of "pending", "in_progress", "completed", got "done"',
      '$.items[1]: missing required property "content"',
      '$.items[1].status: expected string, got 3',
      '$.items[1].status: expected one of "pending", "in_progress", "completed", got 3',
    ]);
  });

  it('accepts a null where the schema allows a union type and rejects the wrong one', () => {
    const schema = { type: 'object', properties: { note: { type: ['string', 'null'] } } };
    expect(validateAgainstSchema({ note: null }, schema)).toEqual([]);
    expect(validateAgainstSchema({ note: 5 }, schema)).toEqual(['$.note: expected one of string, null, got 5']);
  });

  it('ignores keywords it does not know', () => {
    expect(validateAgainstSchema('x', { type: 'string', pattern: '^y$', minLength: 9 })).toEqual([]);
  });
});
