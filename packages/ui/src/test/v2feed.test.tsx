/**
 * VS-345: the shared V2 worker feed — one component Live, Roles, Chat and the card's Watch render.
 * It resolves the worker's current run, tails it, renders the trace, and bounds itself compactly.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Run, RunEvent } from '@weave-ai/shared';
import { run as makeRun } from './factories';

const state = vi.hoisted(() => ({
  runs: [] as Run[],
  events: [] as RunEvent[],
  seenRunId: null as string | null,
}));

vi.mock('../api/hooks', () => ({
  useRuns: (params: { status?: string } = {}) => ({
    data: state.runs.filter((r) => !params.status || r.status === params.status),
  }),
}));
vi.mock('../api/runStream', () => ({
  useRunEventStream: (id: string | null) => {
    state.seenRunId = id;
    return { events: state.events, status: { state: 'connected' }, retryNow: vi.fn() };
  },
}));

const { WorkerFeed } = await import('../v2/WorkerFeed');

const textEvent: RunEvent = {
  id: 'e1',
  runId: 'run_active',
  seq: 1,
  ts: '2026-09-13T10:00:00.000Z',
  type: 'assistant.text',
  stream: 'stdout',
  level: 'info',
  payload: { text: 'Deploying the fix now.' },
};

beforeEach(() => {
  state.seenRunId = null;
  state.events = [textEvent];
  state.runs = [
    makeRun({ id: 'run_done', agentId: 'a1', status: 'succeeded', createdAt: '2026-09-01T09:00:00.000Z' }),
    makeRun({ id: 'run_active', agentId: 'a1', status: 'running', createdAt: '2026-09-01T10:00:00.000Z' }),
  ];
});

describe('the shared worker feed', () => {
  it('follows the worker’s active run over an older one', () => {
    render(<WorkerFeed agentId="a1" ws="ws1" />);
    expect(state.seenRunId).toBe('run_active');
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('Deploying the fix now.')).toBeInTheDocument();
  });

  it('falls back to the worker’s newest finished run between turns', () => {
    state.runs = [
      makeRun({ id: 'run_older', agentId: 'a1', status: 'succeeded', createdAt: '2026-09-01T08:00:00.000Z' }),
      makeRun({ id: 'run_newest', agentId: 'a1', status: 'succeeded', createdAt: '2026-09-01T11:00:00.000Z' }),
    ];
    state.events = [{ ...textEvent, runId: 'run_newest' }];
    render(<WorkerFeed agentId="a1" ws="ws1" />);
    expect(state.seenRunId).toBe('run_newest');
  });

  it('bounds itself in the compact variant, with its own scroll container', () => {
    render(<WorkerFeed agentId="a1" ws="ws1" compact />);
    const feed = document.querySelector('[data-worker-feed]');
    expect(feed).not.toBeNull();
    expect(feed!.querySelector('div[style*="132px"]')).not.toBeNull();
    expect(screen.getByText('Deploying the fix now.')).toBeInTheDocument();
  });
});
