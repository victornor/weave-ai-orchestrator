/** VS-656: the bounded account of an earlier conversation handed to a new session. */
import { describe, expect, it } from 'vitest';
import type { ThreadMessage } from '@weave-ai/shared';
import { sessionCarryOverDigest } from './carryover.js';

let seq = 0;
const message = (over: Partial<ThreadMessage> = {}): ThreadMessage => ({
  id: `m${(seq += 1)}`,
  threadId: 'th1',
  direction: 'inbound',
  authorKind: 'human',
  authorId: null,
  runId: null,
  projectId: null,
  blockId: null,
  replyToMessageId: null,
  replyToMessageIds: [],
  replyToExcerpt: null,
  body: 'hello',
  parts: [],
  externalMessageId: null,
  deliveryStatus: 'received',
  createdAt: 't0',
  ...over,
});

describe('sessionCarryOverDigest', () => {
  it('returns nothing for an empty conversation', () => {
    expect(sessionCarryOverDigest([])).toBe('');
  });

  it('renders oldest-first, labelling the human, the session and the system', () => {
    const messages = [
      message({ id: 'm1', body: 'why did it fail?', createdAt: 't1' }),
      message({ id: 'm2', direction: 'outbound', authorKind: 'agent', authorId: 'a1', body: 'the deploy tool timed out', createdAt: 't2' }),
      message({ id: 'm3', direction: 'outbound', authorKind: 'system', authorId: null, body: 'This turn ended without an answer.', createdAt: 't3' }),
    ];
    const digest = sessionCarryOverDigest(messages, { agentLabel: 'Backend Engineer' });
    expect(digest).toBe([
      '- you: why did it fail?',
      '- Backend Engineer: the deploy tool timed out',
      '- system: This turn ended without an answer.',
    ].join('\n'));
  });

  it('caps a single message and collapses its whitespace', () => {
    const digest = sessionCarryOverDigest([message({ body: `line one\nline two ${'x'.repeat(2_000)}` })], { perMessageChars: 50 });
    const line = digest.split('\n')[0]!;
    expect(line.startsWith('- you: line one line two ')).toBe(true);
    expect(line.length).toBe('- you: '.length + 50);
    expect(line.endsWith('…')).toBe(true);
  });

  it('keeps the newest messages within the total bound and says how many were dropped', () => {
    const messages = Array.from({ length: 30 }, (_, i) => message({ id: `m${i}`, body: `${i}`.padEnd(40, '.'), createdAt: `t${i}` }));
    const digest = sessionCarryOverDigest(messages, { maxChars: 300, perMessageChars: 40 });
    expect(digest.startsWith('(')).toBe(true);
    expect(digest).toMatch(/earlier messages? omitted\)/);
    // The newest message survives; the oldest is dropped.
    expect(digest).toContain('- you: 29');
    expect(digest).not.toContain('- you: 0.');
  });

  it('leaves out the messages waking the current turn', () => {
    const messages = [message({ id: 'old', body: 'earlier' }), message({ id: 'now', body: 'the current message' })];
    const digest = sessionCarryOverDigest(messages, { excludeIds: ['now'] });
    expect(digest).toBe('- you: earlier');
  });
});
