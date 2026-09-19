import { describe, expect, it } from 'vitest';
import { testParallelismDefaults } from './engine.js';

describe('worker test parallelism defaults (VS-579)', () => {
  it('caps vitest and libuv when the environment sets nothing', () => {
    expect(testParallelismDefaults({})).toEqual({ VITEST_MAX_WORKERS: '4', VITEST_MAX_THREADS: '4', UV_THREADPOOL_SIZE: '4' });
  });

  it('never overrides a value the environment already carries', () => {
    const defaults = testParallelismDefaults({ VITEST_MAX_WORKERS: '12', UV_THREADPOOL_SIZE: '8' });
    expect(defaults).not.toHaveProperty('VITEST_MAX_WORKERS');
    expect(defaults).not.toHaveProperty('UV_THREADPOOL_SIZE');
    expect(defaults['VITEST_MAX_THREADS']).toBe('4');
  });
});
