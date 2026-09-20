import { describe, expect, it } from 'vitest';
import { SteeringQueue } from './steering.js';

describe('SteeringQueue', () => {
  it('delivers queued messages in order and empties on drain', () => {
    const q = new SteeringQueue();
    expect(q.pending).toBe(0);
    q.push('first');
    q.push('second');
    expect(q.pending).toBe(2);
    expect(q.drain()).toEqual(['first', 'second']);
    expect(q.pending).toBe(0);
    expect(q.drain()).toEqual([]);
  });

  it('ignores empty text and keeps later messages queued', () => {
    const q = new SteeringQueue();
    q.push('');
    q.push('only');
    expect(q.drain()).toEqual(['only']);
    q.push('after');
    expect(q.pending).toBe(1);
  });
});
