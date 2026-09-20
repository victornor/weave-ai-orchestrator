/** VS-618: ordering a persistent session's raw conversation from its thread messages and its runs. */
import { describe, expect, it } from 'vitest';
import type { ThreadMessage } from '@weave-ai/shared';
import { run } from '../test/factories';
import { sessionConversationRows } from './sessionConversation';

const message = (over: Partial<ThreadMessage> = {}): ThreadMessage => ({
  id: 'm1',
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
  body: 'hi',
  parts: [],
  externalMessageId: null,
  deliveryStatus: 'received',
  createdAt: 't0',
  ...over,
});

describe('sessionConversationRows', () => {
  it('orders a human message and the run it woke, and drops the delivered answer', () => {
    const messages = [
      message({ id: 'm1', createdAt: 't1', body: 'first' }),
      // The engine's delivered answer for run1 — its words are the transcript's final text.
      message({ id: 'm2', runId: 'run1', direction: 'outbound', authorKind: 'agent', authorId: 'a1', body: 'answer one', createdAt: 't3' }),
      message({ id: 'm3', createdAt: 't4', body: 'second' }),
    ];
    const runs = [run({ id: 'run1', agentId: 'a1', startedAt: 't2', createdAt: 't2' })];
    const { rows, answersByRun } = sessionConversationRows(messages, runs, 'a1');

    expect(rows.map((r) => r.kind)).toEqual(['message', 'turn', 'message']);
    expect(rows.map((r) => r.key)).toEqual(['m:m1', 'r:run1', 'm:m3']);
    expect(answersByRun.get('run1')).toBe('answer one');
  });

  it('keeps a system notice and another agent\'s message, and an untagged session message', () => {
    const messages = [
      message({ id: 'm1', body: 'any update?' }),
      message({ id: 'm2', direction: 'outbound', authorKind: 'system', authorId: null, body: 'The turn failed: it crashed.', createdAt: 't1' }),
      message({ id: 'm3', direction: 'outbound', authorKind: 'agent', authorId: 'weaver1', body: 'relayed', createdAt: 't2' }),
      // No runId: not an engine delivery, so it stays as a message.
      message({ id: 'm4', direction: 'outbound', authorKind: 'agent', authorId: 'a1', body: 'not a delivery', createdAt: 't3' }),
    ];
    const { rows } = sessionConversationRows(messages, [], 'a1');

    expect(rows.map((r) => r.key)).toEqual(['m:m1', 'm:m2', 'm:m3', 'm:m4']);
  });

  it('places a run with no delivered message after the message that precedes it', () => {
    const runs = [run({ id: 'run1', agentId: 'a1', startedAt: 't2', createdAt: 't2' })];
    const { rows } = sessionConversationRows([message({ id: 'm1', createdAt: 't1' })], runs, 'a1');

    expect(rows.map((r) => r.key)).toEqual(['m:m1', 'r:run1']);
  });
});
