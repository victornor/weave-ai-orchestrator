/**
 * Onboarding's create step (VS-37): a step backed by a job shows its sub-steps and output, a failed
 * one offers a retry, and a reload comes back attached to the job still running.
 */
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobStep } from '@agent-conductor/shared';

const state = vi.hoisted(() => ({
  posts: [] as Array<{ workspace: string; path: string; body: unknown }>,
  /** What the mocked `useJobStream` reports for the job the view attached to. */
  job: null as Record<string, unknown> | null,
  attached: [] as Array<string | null>,
}));

vi.mock('../app/link', () => ({ useGo: () => vi.fn() }));
vi.mock('../api/client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../api/client');
  return {
    ...actual,
    setWorkspaceId: vi.fn(),
    api: {
      ws: (workspace: string, path: string, init?: { body?: unknown }) => {
        state.posts.push({ workspace, path, body: init?.body });
        return Promise.resolve({ project: { id: 'p1' }, jobId: 'j1' });
      },
    },
  };
});
vi.mock('../api/hooks', () => ({
  useHealth: () => ({ data: { workspaces: [], host: { hostname: 'box', defaultWorkspaceRoot: '/root' } }, isLoading: false }),
  useMe: () => ({ data: { operatorId: 'op1' }, isLoading: false }),
  useRuntimes: () => ({ data: [{ id: 'claude', displayName: 'Claude', detection: { status: 'available', version: '1.0' } }], isLoading: false }),
  useRuntimeModels: () => ({ data: [] }),
  useInitWorkspace: () => ({ mutateAsync: () => Promise.resolve({ id: 'ws1', path: '/root/acme' }) }),
}));
vi.mock('../api/jobStream', () => ({
  useJobStream: (_ws: string | null, jobId: string | null) => {
    state.attached.push(jobId);
    return jobId ? state.job : null;
  },
}));

const { OnboardingRoute, slugOf } = await import('../routes/Onboarding');

const step = (id: string, label: string, s: JobStep['state']): JobStep => ({
  id, label, state: s, startedAt: '2026-09-05T10:00:00.000Z', endedAt: s === 'running' || s === 'pending' ? null : '2026-09-05T10:00:05.000Z',
});

const RESUME_KEY = 'ac.onboarding.resume';

/** The route invalidates queries when the create finishes, so it needs a client. */
const render = (node: React.ReactElement): ReturnType<typeof rtlRender> =>
  rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);

beforeEach(() => {
  state.posts = [];
  state.job = null;
  state.attached = [];
  window.localStorage.clear();
});
afterEach(() => window.localStorage.clear());

/** Walk the wizard to the create step with one project, and press Create. */
async function createWithProject(): Promise<void> {
  render(<OnboardingRoute />);
  fireEvent.change(screen.getByPlaceholderText('Acme Labs'), { target: { value: 'Acme' } });
  fireEvent.click(screen.getByText('Continue'));
  fireEvent.click(screen.getByText('Continue'));                       // conductor step
  fireEvent.click(screen.getByText('Add a project'));
  fireEvent.change(screen.getByPlaceholderText('git@github.com:acme/api.git'), { target: { value: 'git@github.com:acme/api.git' } });
  fireEvent.click(screen.getByText('Continue'));
  fireEvent.click(screen.getByText('Create workspace'));
  await waitFor(() => expect(state.posts.some((p) => p.path === '/projects')).toBe(true));
}

describe('slugOf', () => {
  it('slugs a workspace name', () => expect(slugOf('Acme Labs')).toBe('acme-labs'));
});

describe('Onboarding create step', () => {
  it('attaches the project step to the job the daemon started', async () => {
    await createWithProject();
    await waitFor(() => expect(state.attached).toContain('j1'));
    expect(state.posts.map((p) => p.path)).toEqual(['/config', '/projects']);
  });

  it('shows the running sub-step and its output while the project is being added', async () => {
    state.job = { steps: [step('clone', 'Clone the repository', 'running')], log: [{ seq: 1, step: 'clone', stream: 'stderr', text: 'Receiving objects: 40%' }], state: 'running', failedStep: null, message: null, finishedAt: null };
    await createWithProject();
    await waitFor(() => expect(screen.getByText('Clone the repository')).toBeInTheDocument());
    expect(screen.getByText(/Receiving objects: 40%/)).toBeInTheDocument();
    expect(screen.getByText('Add project api')).toBeInTheDocument();
  });

  it('shows the failing sub-step, its lines and a retry that re-runs the step', async () => {
    state.job = {
      steps: [step('clone', 'Clone the repository', 'failed')],
      log: [{ seq: 1, step: 'clone', stream: 'stderr', text: 'fatal: repository not found' }],
      state: 'failed', failedStep: 'clone', message: 'git clone failed', finishedAt: '2026-09-05T10:00:05.000Z',
    };
    await createWithProject();
    await waitFor(() => expect(screen.getByText('Retry')).toBeInTheDocument());
    expect(screen.getByText('Clone the repository')).toBeInTheDocument();
    expect(screen.getByText(/fatal: repository not found/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(state.posts.some((p) => p.path === '/projects/p1/retry')).toBe(true));
  });

  it('records enough to resume, and clears it once the human leaves', async () => {
    await createWithProject();
    await waitFor(() => {
      const resume = JSON.parse(window.localStorage.getItem(RESUME_KEY) ?? 'null') as { workspaceId: string; steps: Array<{ jobId?: string }> } | null;
      expect(resume?.workspaceId).toBe('ws1');
      expect(resume?.steps.some((s) => s.jobId === 'j1')).toBe(true);
    });
  });

  it('a reload mid-step comes back to the same steps, attached to the running job', async () => {
    window.localStorage.setItem(RESUME_KEY, JSON.stringify({
      workspaceId: 'ws1', name: 'Acme',
      steps: [
        { label: 'Create workspace Acme', state: 'done', startedAt: 1, endedAt: 2 },
        { label: 'Configure the conductor (claude)', state: 'done', startedAt: 2, endedAt: 3 },
        { label: 'Add project api', state: 'running', startedAt: 3, jobId: 'j1', projectId: 'p1' },
      ],
    }));
    state.job = { steps: [step('clone', 'Clone the repository', 'running')], log: [{ seq: 1, step: 'clone', stream: 'stderr', text: 'Receiving objects: 90%' }], state: 'running', failedStep: null, message: null, finishedAt: null };

    render(<OnboardingRoute />);
    expect(screen.getByText('Add project api')).toBeInTheDocument();
    expect(screen.getByText('Create workspace Acme')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Receiving objects: 90%/)).toBeInTheDocument());
    expect(state.attached).toContain('j1');
    expect(state.posts).toHaveLength(0);   // nothing is re-run by coming back
  });

  it('a reload after everything finished comes back to the way on', () => {
    window.localStorage.setItem(RESUME_KEY, JSON.stringify({
      workspaceId: 'ws1', name: 'Acme',
      steps: [{ label: 'Create workspace Acme', state: 'done', startedAt: 1, endedAt: 2 }],
    }));
    render(<OnboardingRoute />);
    expect(screen.getByText(/^Open/)).toBeInTheDocument();
  });
});
