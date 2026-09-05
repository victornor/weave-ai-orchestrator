import { describe, expect, it } from 'vitest';
import { createSerializer } from './serialize.js';

/** A job that records when it starts and ends, so overlap is observable. */
function tracked(log: string[], name: string, ms = 20): () => Promise<void> {
  return async () => {
    log.push(`${name}:start`);
    await new Promise((r) => setTimeout(r, ms));
    log.push(`${name}:end`);
  };
}

describe('createSerializer', () => {
  it('runs work under one key strictly one at a time, in submission order', async () => {
    const serialize = createSerializer();
    const log: string[] = [];
    await Promise.all([
      serialize('project-a', tracked(log, 'first')),
      serialize('project-a', tracked(log, 'second')),
    ]);
    expect(log).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('lets different keys overlap', async () => {
    const serialize = createSerializer();
    const log: string[] = [];
    await Promise.all([
      serialize('project-a', tracked(log, 'a')),
      serialize('project-b', tracked(log, 'b')),
    ]);
    expect(log.slice(0, 2).sort()).toEqual(['a:start', 'b:start']);
  });

  it('lets the next job run after one rejects, and surfaces the rejection to its own caller', async () => {
    const serialize = createSerializer();
    const log: string[] = [];
    const failing = serialize('project-a', async () => { throw new Error('landing failed'); });
    const after = serialize('project-a', tracked(log, 'next'));

    await expect(failing).rejects.toThrow('landing failed');
    await after;
    expect(log).toEqual(['next:start', 'next:end']);
  });

  it('returns the result of each job', async () => {
    const serialize = createSerializer();
    expect(await Promise.all([
      serialize('k', async () => 1),
      serialize('k', async () => 2),
    ])).toEqual([1, 2]);
  });
});
