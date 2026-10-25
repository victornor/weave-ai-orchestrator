/** VS-830: Settings → Release surfaces a stale release source and offers to move it. */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  update: undefined as unknown,
  writes: [] as unknown[],
  pending: false,
  failWith: null as string | null,
}));

vi.mock('../components/Toast', () => ({ useToast: () => ({ push: () => undefined }) }));

vi.mock('../api/hooks', () => ({
  useDaemonUpdate: () => ({ isLoading: false, isError: false, data: state.update }),
  useDaemonUpgrade: () => ({ data: { upgrade: null, waitingFor: [] }, isError: false }),
  useRefreshDaemonUpdate: () => ({ mutate: () => undefined, isPending: false }),
  useRequestUpgrade: () => ({ mutate: () => undefined, isPending: false }),
  useCancelUpgrade: () => ({ mutate: () => undefined, isPending: false }),
  useSetReleaseSource: () => ({
    isPending: state.pending,
    mutate: (body: unknown, opts?: { onSuccess?: () => void; onError?: (e: Error) => void }) => {
      state.writes.push(body);
      if (state.failWith) opts?.onError?.(new Error(state.failWith));
      else opts?.onSuccess?.();
    },
  }),
}));

const { UpdatesSection } = await import('../settings/sections');

const status = (over: Record<string, unknown> = {}) => ({
  configured: true,
  running: { version: '1.0.0', path: '/rel/20260101-120000-aaaaaaaaaa', sha: 'a'.repeat(40) },
  source: 'git@github.com:victornor/agent-conductor.git',
  ref: 'main',
  targetSha: 'a'.repeat(40),
  updateAvailable: false,
  checkedAt: '2026-10-25T00:00:00.000Z',
  error: null,
  runtimeSource: 'git@github.com:victornor/agent-conductor.git',
  staleSource: null,
  ...over,
});

const staleOf = {
  configured: 'git@github.com:victornor/agent-conductor.git',
  project: { id: 'p1', slug: 'conductor', url: 'git@github.com:victornor/weave-ai-orchestrator.git' },
};

beforeEach(() => {
  state.update = status();
  state.writes = [];
  state.pending = false;
  state.failWith = null;
});

describe('Settings → Release with a stale source (VS-830)', () => {
  it('warns, naming the old source and the project\'s new one', () => {
    state.update = status({ staleSource: staleOf });
    render(<UpdatesSection />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('git@github.com:victornor/agent-conductor.git');
    expect(alert.textContent).toContain('git@github.com:victornor/weave-ai-orchestrator.git');
    expect(alert.textContent).toContain('conductor');
  });

  it('keeps the plain up-to-date answer visible alongside the warning', () => {
    state.update = status({ staleSource: staleOf });
    render(<UpdatesSection />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getAllByText('Up to date').length).toBeGreaterThan(0);
  });

  it('moves the source to the project\'s new URL when the offer is taken', () => {
    state.update = status({ staleSource: staleOf });
    render(<UpdatesSection />);
    fireEvent.click(screen.getByRole('button', { name: /build from conductor's repo/i }));
    expect(state.writes).toEqual([{ source: 'git@github.com:victornor/weave-ai-orchestrator.git' }]);
  });

  it('shows no warning and offers nothing when the source is fine', () => {
    render(<UpdatesSection />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: /build from/i })).toBeNull();
  });
});
