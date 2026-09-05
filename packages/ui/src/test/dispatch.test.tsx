import { describe, expect, it } from 'vitest';
import type { ThreadMessage } from '@agent-conductor/shared';
import { chatEntries, dispatchStatus } from '../lib/dispatch';
import { agent, ticket } from './factories';

function message(over: Partial<ThreadMessage> & Pick<ThreadMessage, 'id'>): ThreadMessage {
  return {
    threadId: 'th_1', direction: 'outbound', authorKind: 'agent', authorId: 'ag_conductor', runId: 'run_1', projectId: null,
    body: 'Filed it.', parts: [], externalMessageId: null, deliveryStatus: 'delivered',
    createdAt: '2026-09-01T09:00:00.000Z', ...over,
  };
}

const dispatched = (over = {}) => ticket({ createdRunId: 'run_1', assigneeRoleId: 'r1', workerId: null, ...over });

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
