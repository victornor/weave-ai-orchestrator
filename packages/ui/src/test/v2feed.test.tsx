/**
 * VS-345: the shared V2 worker feed — one component Live, Roles, Chat and the card's Watch render.
 * It resolves the worker's current run, tails it, renders the trace, and bounds itself compactly.
 * VS-409: an expandable pane opens at 264px, follows its newest line, carries a resize grip and
 * offers no Refresh while live.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Run, RunEvent } from '@weave-ai/shared';
import { run as makeRun } from './factories';

const state = vi.hoisted(() => ({
  runs: [] as Run[],
  events: [] as RunEvent[],
  seenRunId: null as string | null,
  status: 'connected' as string,
  retry: vi.fn() as ReturnType<typeof vi.fn>,
}));

vi.mock('../api/hooks', () => ({
  // What the daemon's runtime list declares for each runtime (VS-615).
  usePartialOutput: (id?: string | null) => (({ opencode: 'full', claude: 'full', codex: 'full', cursor: 'text', gemini: 'text', weave: 'full' }) as Record<string, string>)[id ?? ''] ?? 'none',
  useRuns: (params: { status?: string } = {}) => ({
    data: state.runs.filter((r) => !params.status || r.status === params.status),
  }),
}));
vi.mock('../api/runStream', () => ({
  useRunEventStream: (id: string | null) => {
    state.seenRunId = id;
    return { events: state.events, status: { state: state.status }, retryNow: state.retry };
  },
}));

const { WorkerFeed, TRACE_PANE_HEIGHT_DEFAULT } = await import('../v2/WorkerFeed');

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
  state.status = 'connected';
  state.retry.mockClear();
  state.runs = [
    makeRun({ id: 'run_done', agentId: 'a1', status: 'succeeded', createdAt: '2026-09-01T09:00:00.000Z' }),
    makeRun({ id: 'run_active', agentId: 'a1', status: 'running', createdAt: '2026-09-01T10:00:00.000Z' }),
  ];
});

/** The pane's body box: the element whose height the caller or the grip sets. */
const body = (): HTMLElement => document.querySelector('[data-feed-body]') as HTMLElement;

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

  it('describes the run it renders for a card that passed an asking runId, rather than saying “No run yet”', () => {
    // The card's asking run belongs to no worker this feed can resolve, but the feed still shows it.
    state.runs = [makeRun({ id: 'run_asked', agentId: 'other', status: 'succeeded', finishedAt: '2026-09-01T09:30:00.000Z' })];
    state.events = [{ ...textEvent, runId: 'run_asked' }];
    render(<WorkerFeed agentId="a1" runId="run_asked" ws="ws1" />);
    expect(state.seenRunId).toBe('run_asked');
    expect(screen.getByText(/^succeeded · /)).toBeInTheDocument();
    expect(screen.queryByText('No run yet')).toBeNull();
  });

  it('bounds a compact pane at double the old 132px box, with its own scroll container', () => {
    render(<WorkerFeed agentId="a1" ws="ws1" compact />);
    const feed = document.querySelector('[data-worker-feed]');
    expect(feed).not.toBeNull();
    expect(parseInt(body().style.height, 10)).toBe(TRACE_PANE_HEIGHT_DEFAULT);
    expect(TRACE_PANE_HEIGHT_DEFAULT).toBe(264);
    expect(feed!.querySelector('div[style*="264px"]')).not.toBeNull();
    expect(screen.getByText('Deploying the fix now.')).toBeInTheDocument();
  });

  it('takes a body height override for the Live height ladder', () => {
    render(<WorkerFeed agentId="a1" ws="ws1" bodyHeight={240} />);
    const feed = document.querySelector('[data-worker-feed]');
    expect(feed!.querySelector('div[style*="240px"]')).not.toBeNull();
  });

  it('caps the page transcript and lets the transcript scroller share the same cap (VS-409)', () => {
    render(<WorkerFeed agentId="a1" ws="ws1" />);
    expect(body().style.maxHeight).toBe('420px');
    // The scroll element carries the same cap, so its scroll range reaches the last line.
    expect(document.querySelector('[role="log"]')).toHaveStyle({ maxHeight: '420px' });
  });

  it('shows no Refresh while the run is live', () => {
    render(<WorkerFeed agentId="a1" ws="ws1" compact />);
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
  });

  it('offers a Reconnect control only once the stream has dropped', () => {
    state.status = 'offline';
    render(<WorkerFeed agentId="a1" ws="ws1" compact />);
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(state.retry).toHaveBeenCalled();
  });

  it('drags the pane height with its corner grip and resets on double-click (VS-409)', () => {
    render(<WorkerFeed agentId="a1" ws="ws1" compact resizable />);
    expect(parseInt(body().style.height, 10)).toBe(TRACE_PANE_HEIGHT_DEFAULT);
    const grip = screen.getByRole('separator', { name: 'Resize trace pane' });
    fireEvent.pointerDown(grip, { pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 180 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(parseInt(body().style.height, 10)).toBe(TRACE_PANE_HEIGHT_DEFAULT + 80);
    fireEvent.doubleClick(grip);
    expect(parseInt(body().style.height, 10)).toBe(TRACE_PANE_HEIGHT_DEFAULT);
  });

  it('resizes the pane with the arrow keys and clamps to the minimum', () => {
    render(<WorkerFeed agentId="a1" ws="ws1" compact resizable />);
    const grip = screen.getByRole('separator', { name: 'Resize trace pane' });
    fireEvent.keyDown(grip, { key: 'ArrowDown' });
    expect(parseInt(body().style.height, 10)).toBe(TRACE_PANE_HEIGHT_DEFAULT + 24);
    for (let i = 0; i < 20; i += 1) fireEvent.keyDown(grip, { key: 'ArrowUp' });
    expect(parseInt(body().style.height, 10)).toBe(120);
  });

  it('has no grip unless the pane asked for one', () => {
    render(<WorkerFeed agentId="a1" ws="ws1" compact />);
    expect(screen.queryByRole('separator', { name: 'Resize trace pane' })).toBeNull();
  });

  it('renders an edit tool call as a highlighted diff through the shared transcript (VS-370)', () => {
    state.events = [
      {
        id: 'e2', runId: 'run_active', seq: 2, ts: '2026-09-13T10:01:00.000Z', type: 'tool.call', stream: 'stdout', level: 'info',
        payload: { name: 'Edit', callId: 'c1', input: { file_path: 'src/a.ts', old_string: 'const x = 1;', new_string: 'const x = 2;' } },
      },
    ];
    render(<WorkerFeed agentId="a1" ws="ws1" />);
    expect(screen.getAllByText('const x = 1;').length).toBeGreaterThan(0);
    expect(screen.getAllByText('const x = 2;').length).toBeGreaterThan(0);
  });
});
