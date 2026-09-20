import { describe, expect, it } from 'vitest';
import type { ThreadMessage } from '@weave-ai/shared';
import { chatEntries, dispatchStatus } from '../lib/dispatch';
import { agent, decision, ticket } from './factories';

function message(over: Partial<ThreadMessage> & Pick<ThreadMessage, 'id'>): ThreadMessage {
  return {
    threadId: 'th_1', direction: 'outbound', authorKind: 'agent', authorId: 'ag_conductor', runId: 'run_1', projectId: null, blockId: null,
    replyToMessageId: null, replyToMessageIds: [], replyToExcerpt: null,
    body: 'Filed it.', parts: [], externalMessageId: null, deliveryStatus: 'delivered',
    createdAt: '2026-09-01T09:00:00.000Z', ...over,
  };
}

const dispatched = (over = {}) => ticket({ createdRunId: 'run_1', assigneeRoleId: 'r1', workerId: null, ...over });

/** A decision card as it travels on a message's opaque `parts` array. */
const cardPart = (id: string) => ({ type: 'card', title: 't', body: 'b', actions: [], ref: { kind: 'decision', id } });

describe('dispatchStatus', () => {
  it('reads the worker while it is still live', () => {
    expect(dispatchStatus(ticket({ status: 'in_progress' }), agent({ status: 'running' }))).toBe('working');
    expect(dispatchStatus(ticket({ status: 'in_progress' }), agent({ status: 'paused' }))).toBe('paused');
    expect(dispatchStatus(ticket({ status: 'in_progress' }), agent({ status: 'error' }))).toBe('failed');
  });

  it('reads the ticket once the worker has stopped', () => {
    // agentUiStatus maps retired to done, so the retired worker alone would claim success here.
    expect(dispatchStatus(ticket({ status: 'done' }), agent({ status: 'retired' }))).toBe('done');
    expect(dispatchStatus(ticket({ status: 'cancelled' }), agent({ status: 'retired' }))).toBe('failed');
    expect(dispatchStatus(ticket({ status: 'in_review' }), agent({ status: 'retired' }))).toBe('needs-you');
    expect(dispatchStatus(ticket({ status: 'blocked' }), agent({ status: 'done' }))).toBe('blocked');
  });

  it('reads the ticket before a worker exists', () => {
    expect(dispatchStatus(ticket({ status: 'todo' }), null)).toBe('idle');
  });
});

describe('chatEntries', () => {
  it('anchors a dispatch to the last message of the run that filed it', () => {
    const messages = [message({ id: 'm1' }), message({ id: 'm2' }), message({ id: 'm3', runId: 'run_2' })];
    const { entries } = chatEntries(messages, [dispatched({ id: 'tk_1' })], []);

    expect(entries.map((e) => e.message.id)).toEqual(['m1', 'm2', 'm3']);
    expect(entries[0]!.dispatches).toHaveLength(0);
    expect(entries[1]!.dispatches.map((d) => d.ticket.id)).toEqual(['tk_1']);
    expect(entries[2]!.dispatches).toHaveLength(0);
  });

  it('ignores tickets that were never dispatched or never attributed to a message', () => {
    const messages = [message({ id: 'm1' })];
    const tickets = [
      dispatched({ id: 'tk_role_less', assigneeRoleId: null, workerId: null }),
      ticket({ id: 'tk_no_run', createdRunId: null }),
      dispatched({ id: 'tk_other_run', createdRunId: 'run_elsewhere' }),
      dispatched({ id: 'tk_ok' }),
    ];
    const { entries } = chatEntries(messages, tickets, []);
    expect(entries[0]!.dispatches.map((d) => d.ticket.id)).toEqual(['tk_ok']);
  });

  it('never anchors to a message the human sent', () => {
    const messages = [message({ id: 'm1', direction: 'inbound', authorKind: 'human', runId: 'run_1' })];
    expect(chatEntries(messages, [dispatched({ id: 'tk_1' })], []).entries[0]!.dispatches).toHaveLength(0);
  });

  it('orders several dispatches from one turn by the order they were filed', () => {
    const messages = [message({ id: 'm1' })];
    const tickets = [
      dispatched({ id: 'tk_b', createdAt: '2026-09-01T09:00:02.000Z' }),
      dispatched({ id: 'tk_a', createdAt: '2026-09-01T09:00:01.000Z' }),
      dispatched({ id: 'tk_c', createdAt: '2026-09-01T09:00:03.000Z' }),
    ];
    const { entries } = chatEntries(messages, tickets, []);
    expect(entries[0]!.dispatches.map((d) => d.ticket.id)).toEqual(['tk_a', 'tk_b', 'tk_c']);
  });

  it('gives each dispatch its own worker and its own state', () => {
    const messages = [message({ id: 'm1' })];
    const tickets = [
      dispatched({ id: 'tk_a', createdAt: '2026-09-01T09:00:01.000Z', status: 'in_progress' }),
      dispatched({ id: 'tk_b', createdAt: '2026-09-01T09:00:02.000Z', status: 'done' }),
    ];
    const workers = [
      agent({ id: 'w_a', ticketId: 'tk_a', name: 'Backend Engineer #1', status: 'running' }),
      agent({ id: 'w_b', ticketId: 'tk_b', name: 'Backend Engineer #2', status: 'retired' }),
    ];
    const [a, b] = chatEntries(messages, tickets, workers).entries[0]!.dispatches;
    expect([a!.worker?.name, a!.status]).toEqual(['Backend Engineer #1', 'working']);
    expect([b!.worker?.name, b!.status]).toEqual(['Backend Engineer #2', 'done']);
  });

  it('prefers the live worker when a ticket has been worked twice', () => {
    const workers = [
      agent({ id: 'w_old', ticketId: 'tk_1', name: 'Backend Engineer #1', status: 'retired', createdAt: '2026-09-01T09:00:00.000Z' }),
      agent({ id: 'w_new', ticketId: 'tk_1', name: 'Backend Engineer #2', status: 'running', createdAt: '2026-09-01T10:00:00.000Z' }),
    ];
    const { entries } = chatEntries([message({ id: 'm1' })], [dispatched({ id: 'tk_1' })], workers);
    expect(entries[0]!.dispatches[0]!.worker?.id).toBe('w_new');
  });

  it('leaves live work no message accounts for out of the entries', () => {
    const workers = [
      agent({ id: 'w_anchored', ticketId: 'tk_1', status: 'running' }),
      agent({ id: 'w_loose', ticketId: 'tk_loose', status: 'running' }),
      agent({ id: 'w_retired', ticketId: 'tk_gone', status: 'retired' }),
    ];
    const { unattributed } = chatEntries([message({ id: 'm1' })], [dispatched({ id: 'tk_1' })], workers);
    expect(unattributed.map((w) => w.id)).toEqual(['w_loose']);
  });
});

describe('chatEntries — ticket references (VS-634)', () => {
  it('chips every ticket a message names, in first-mention order and without a dispatch', () => {
    const messages = [message({ id: 'm1', body: 'Moved VS-633 to review; re-queued VS-621.' })];
    const tickets = [ticket({ id: 'tk_a', identifier: 'VS-633' }), ticket({ id: 'tk_b', identifier: 'VS-621' })];
    const { entries } = chatEntries(messages, tickets, []);
    expect(entries[0]!.references.map((r) => r.ticket.identifier)).toEqual(['VS-633', 'VS-621']);
    expect(entries[0]!.dispatches).toEqual([]);
  });

  it('shows a ticket mentioned several times once', () => {
    const messages = [message({ id: 'm1', body: 'VS-633, then VS-633 again, and VS-633 once more.' })];
    const { entries } = chatEntries(messages, [ticket({ id: 'tk_a', identifier: 'VS-633' })], []);
    expect(entries[0]!.references.map((r) => r.ticket.identifier)).toEqual(['VS-633']);
  });

  it('skips an identifier that resolves to no ticket', () => {
    const messages = [message({ id: 'm1', body: 'VS-633 and the unknown VS-999.' })];
    const { entries } = chatEntries(messages, [ticket({ id: 'tk_a', identifier: 'VS-633' })], []);
    expect(entries[0]!.references.map((r) => r.ticket.identifier)).toEqual(['VS-633']);
  });

  it('does not double-count a ticket that is both named and dispatched', () => {
    const messages = [message({ id: 'm1', body: 'Filed VS-633 for the fix.' })];
    const tickets = [dispatched({ id: 'tk_a', identifier: 'VS-633' })];
    const { entries } = chatEntries(messages, tickets, []);
    expect(entries[0]!.references.map((r) => r.ticket.identifier)).toEqual(['VS-633']);
    expect(entries[0]!.dispatches.map((d) => d.ticket.identifier)).toEqual(['VS-633']);
  });

  it('includes a dispatch the message did not name, after the named tickets', () => {
    const messages = [message({ id: 'm1', body: 'Also see VS-99.' })];
    const tickets = [
      dispatched({ id: 'tk_dis', identifier: 'VS-1', createdAt: '2026-09-01T09:00:01.000Z' }),
      ticket({ id: 'tk_ref', identifier: 'VS-99' }),
    ];
    const { entries } = chatEntries(messages, tickets, []);
    expect(entries[0]!.references.map((r) => r.ticket.identifier)).toEqual(['VS-99', 'VS-1']);
  });

  it('does not chip a ticket that only appears inside a code span', () => {
    const messages = [message({ id: 'm1', body: 'The literal `VS-633` is not a reference.' })];
    const { entries } = chatEntries(messages, [ticket({ id: 'tk_a', identifier: 'VS-633' })], []);
    expect(entries[0]!.references).toEqual([]);
  });

  it('omits a running worker whose ticket a message merely names', () => {
    const messages = [message({ id: 'm1', body: 'Tracking VS-5 while it runs.' })];
    const tickets = [ticket({ id: 'tk_5', identifier: 'VS-5' })];
    const workers = [agent({ id: 'w5', ticketId: 'tk_5', status: 'running' })];
    expect(chatEntries(messages, tickets, workers).unattributed).toEqual([]);
  });

  it('carries the worker and its live status on a referenced ticket', () => {
    const messages = [message({ id: 'm1', body: 'Waiting on VS-5.' })];
    const tickets = [ticket({ id: 'tk_5', identifier: 'VS-5', title: 'Something' })];
    const workers = [agent({ id: 'w5', ticketId: 'tk_5', name: 'Platform Engineer #552', status: 'running' })];
    const [reference] = chatEntries(messages, tickets, workers).entries[0]!.references;
    expect(reference!.worker?.name).toBe('Platform Engineer #552');
    expect(reference!.status).toBe('working');
  });
});

describe('chatEntries — decisions', () => {
  const asked = (over = {}) => decision({ kind: 'question', askedInRunId: 'run_1', ...over });

  it('anchors a decision to the message of the run that raised it', () => {
    const messages = [message({ id: 'm1' }), message({ id: 'm2', runId: 'run_2' })];
    const { entries } = chatEntries(messages, [], [], [asked({ id: 'd1' })]);
    expect(entries[0]!.decisions.map((d) => d.id)).toEqual(['d1']);
    expect(entries[1]!.decisions).toEqual([]);
  });

  it('anchors to the last message of a run that sent several', () => {
    const messages = [message({ id: 'm1' }), message({ id: 'm2' }), message({ id: 'm3', runId: 'run_2' })];
    const { entries } = chatEntries(messages, [], [], [asked({ id: 'd1' })]);
    expect(entries[0]!.decisions).toEqual([]);
    expect(entries[1]!.decisions.map((d) => d.id)).toEqual(['d1']);
  });

  it('anchors a decision to the message that carries its card, not the raising run', () => {
    const messages = [
      message({ id: 'm_run', runId: 'run_1' }),
      message({ id: 'm_card', runId: null, parts: [cardPart('d1')] }),
    ];
    const { entries } = chatEntries(messages, [], [], [asked({ id: 'd1' })]);
    expect(entries[0]!.decisions).toEqual([]);
    expect(entries[1]!.decisions.map((d) => d.id)).toEqual(['d1']);
  });

  it('anchors a decision whose raising run left no message, by its card message', () => {
    const messages = [message({ id: 'm_card', runId: null, parts: [cardPart('d1')] })];
    const answered = asked({ id: 'd1', askedInRunId: 'run_worker', status: 'answered', answerKey: 'file' });
    const { entries } = chatEntries(messages, [], [], [answered]);
    expect(entries[0]!.decisions.map((d) => d.id)).toEqual(['d1']);
  });

  it('leaves a decision with neither a card nor a raising-run message out of the entries', () => {
    const messages = [message({ id: 'm1' })];
    const loose = asked({ id: 'd_worker', askedInRunId: 'run_worker' });
    const noRun = asked({ id: 'd_none', askedInRunId: null });
    const { entries } = chatEntries(messages, [], [], [loose, noRun]);
    expect(entries[0]!.decisions).toEqual([]);
  });

  it('keeps an answered decision anchored where it was asked', () => {
    const messages = [message({ id: 'm1' }), message({ id: 'm2', runId: 'run_2', createdAt: '2026-09-01T10:00:00.000Z' })];
    const answered = asked({ id: 'd1', status: 'answered', answerKey: 'yes', answeredAt: '2026-09-01T09:30:00.000Z' });
    const { entries } = chatEntries(messages, [], [], [answered]);
    expect(entries[0]!.decisions.map((d) => d.id)).toEqual(['d1']);
    expect(entries[1]!.decisions).toEqual([]);
  });

  it('orders two decisions from one run by when they were raised', () => {
    const messages = [message({ id: 'm1' })];
    const first = asked({ id: 'd_first', createdAt: '2026-09-01T09:00:00.000Z' });
    const second = asked({ id: 'd_second', createdAt: '2026-09-01T09:05:00.000Z' });
    const { entries } = chatEntries(messages, [], [], [second, first]);
    expect(entries[0]!.decisions.map((d) => d.id)).toEqual(['d_first', 'd_second']);
  });

  it('carries both the dispatches and the decisions of one turn', () => {
    const messages = [message({ id: 'm1' })];
    const { entries } = chatEntries(messages, [dispatched({ id: 'tk_1' })], [], [asked({ id: 'd1' })]);
    expect(entries[0]!.dispatches.map((d) => d.ticket.id)).toEqual(['tk_1']);
    expect(entries[0]!.decisions.map((d) => d.id)).toEqual(['d1']);
  });

  it('defaults to no decisions when none are passed', () => {
    const { entries } = chatEntries([message({ id: 'm1' })], [], []);
    expect(entries[0]!.decisions).toEqual([]);
  });
});
