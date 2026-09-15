/** VS-350: the V2 run detail — metadata, trigger and the plain-language ending. */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Run, RunEvent } from '@weave-ai/shared';
import { run as makeRun } from './factories';

const state = vi.hoisted(() => ({ run: null as Run | null, summary: null as string | null }));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: (o?: { select?: (s: { location: { pathname: string } }) => unknown }) => (o?.select ? o.select({ location: { pathname: '/runs/run_1' } }) : '/runs/run_1'),
  useParams: () => ({ runId: 'run_1' }),
}));
vi.mock('../app/link', () => ({ useSearchParams: () => ({}), useGo: () => vi.fn() }));
vi.mock('../api/runStream', () => ({ useRunEventStream: () => ({ events: [] as RunEvent[], status: { state: 'connected' }, retryNow: vi.fn() }) }));
vi.mock('../api/hooks', () => ({
  useRunGlobal: () => ({ data: state.run ? { run: state.run, agent: null, ticket: null, phases: [], usage: state.run.usage } : undefined, isLoading: false, isError: false }),
  useWorkersMany: () => [{ data: [{ id: 'a1', name: 'Backend Engineer #7' }] }],
  useWeaverMany: () => [{ data: { agent: { id: 'weaver-1', name: 'Acme Weaver' } } }],
  useRuntimeModels: () => ({ data: [{ id: 'sonnet-4.6', label: 'Sonnet', contextWindowTokens: 200_000 }] }),
  useRuns: () => ({ data: [] }),
}));

const { RunBody } = await import('../v2/RunPage');

beforeEach(() => {
  state.run = makeRun({
    id: 'run_1',
    agentId: 'a1',
    status: 'succeeded',
    model: 'sonnet-4.6',
    summary: 'The turn ended by asking you something.',
    usage: { inputTokens: 1000, outputTokens: 200, cachedInputTokens: 0, contextTokens: 5000, basis: 'provider' },
    startedAt: '2026-09-01T09:00:00.000Z',
    finishedAt: '2026-09-01T09:00:51.000Z',
  });
});

describe('V2 Run detail', () => {
  it('shows the state, metadata with context and the plain-language ending', () => {
    render(<RunBody runId="run_1" />);
    expect(screen.getByText('succeeded')).toBeInTheDocument();
    const meta = document.querySelector('[data-v2-run-meta]') as HTMLElement;
    expect(meta.textContent).toContain('Backend Engineer #7');
    expect(meta.textContent).toContain('Sonnet (sonnet-4.6)');
    expect(meta.textContent).toContain('ctx');
    expect(meta.textContent).toContain('Started directly');
    expect(document.querySelector('[data-v2-run-summary]')?.textContent).toContain('asking you something');
  });

  it('names the retry when the run is a retry', () => {
    state.run = makeRun({ id: 'run_1', status: 'running', retryOfRunId: 'run_previous_abcdef', startedAt: '2026-09-01T09:00:00.000Z' });
    render(<RunBody runId="run_1" />);
    expect((document.querySelector('[data-v2-run-meta]') as HTMLElement).textContent).toContain('Retry of run_prev');
  });

  it('names the weaver when the run is the weaver\u2019s', () => {
    state.run = makeRun({ id: 'run_1', agentId: 'weaver-1', status: 'succeeded', startedAt: '2026-09-01T09:00:00.000Z', finishedAt: '2026-09-01T09:00:51.000Z' });
    render(<RunBody runId="run_1" />);
    expect((document.querySelector('[data-v2-run-meta]') as HTMLElement).textContent).toContain('Acme Weaver');
  });

  it('never shows a raw agent id when the agent is unknown', () => {
    state.run = makeRun({ id: 'run_1', agentId: 'ghost-agent', status: 'succeeded', startedAt: '2026-09-01T09:00:00.000Z', finishedAt: '2026-09-01T09:00:51.000Z' });
    render(<RunBody runId="run_1" />);
    const meta = document.querySelector('[data-v2-run-meta]') as HTMLElement;
    expect(meta.textContent).toContain('Unknown agent');
    expect(meta.textContent).not.toContain('ghost');
  });

  it('says a run was started by a wake when it carries wakes', () => {
    state.run = makeRun({ id: 'run_1', status: 'running', wakeupIds: ['w1', 'w2'], startedAt: '2026-09-01T09:00:00.000Z' });
    render(<RunBody runId="run_1" />);
    expect((document.querySelector('[data-v2-run-meta]') as HTMLElement).textContent).toContain('Started by a wake (2)');
  });
});
