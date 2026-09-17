import { describe, expect, it } from 'vitest';
import { workerOptionErrors } from './runtime-options.js';

describe('workerOptionErrors', () => {
  const runtime = { configSchema: () => ({ type: 'object', properties: { limit: { type: 'integer', maximum: 10 } }, additionalProperties: false }) };

  it('rejects an option whose runtime is not registered', () => {
    expect(workerOptionErrors(() => undefined, [{ id: 'deep', runtime: 'missing' }])).toEqual([
      "deep: runtime 'missing' is not registered",
    ]);
  });

  it('uses the registered runtime schema for option values', () => {
    expect(workerOptionErrors(() => runtime, [{ id: 'deep', runtime: 'fake', options: { limit: 11 } }])).toEqual([
      'deep: fake: limit must be at most 10',
    ]);
  });

  it('allows an explicitly unconfigured option', () => {
    expect(workerOptionErrors(() => undefined, [{ id: 'deep', runtime: null }])).toEqual([]);
  });
});
