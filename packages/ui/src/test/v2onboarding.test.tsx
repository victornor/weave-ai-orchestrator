/**
 * V2 onboarding (VS-353): the autonomy question maps to existing workspace settings, the three chips
 * are offered with none pre-selected, and the policy is written only when the workspace is created.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mutateAsync, ws } = vi.hoisted(() => ({ mutateAsync: vi.fn(), ws: vi.fn() }));

vi.mock('../app/link', () => ({ useGo: () => vi.fn() }));
vi.mock('@tanstack/react-query', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-query')>();
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});
vi.mock('../api/client', async (orig) => {
  const actual = await orig<typeof import('../api/client')>();
  return { ...actual, api: { root: vi.fn(), ws, qs: actual.api.qs }, setWorkspaceId: vi.fn() };
});
vi.mock('../api/hooks', () => ({
  useHealth: () => ({
    data: { version: 'x', tlsMode: 'none', operatorConfigured: true, workspaces: [], host: { defaultWorkspaceRoot: '~/weave' } },
    isLoading: false,
    isError: false,
  }),
  useRuntimes: () => ({ data: [{ id: 'claude', displayName: 'Claude', detection: { status: 'available' } }], isLoading: false }),
  useRuntimeModels: () => ({ data: [] }),
  useInitWorkspace: () => ({ mutateAsync }),
}));

const { autonomyDefaults, V2OnboardingPage } = await import('../v2/V2Onboarding');

describe('the autonomy answer mapping', () => {
  it('asks before any plan', () => {
    expect(autonomyDefaults('human')).toEqual({ proposalApproval: 'human', yolo: false });
  });
  it('routes plans to the weaver but leaves merges and actions to the human', () => {
    expect(autonomyDefaults('merges')).toEqual({ proposalApproval: 'weaver', yolo: false });
  });
  it('lets the weaver decide', () => {
    expect(autonomyDefaults('yolo')).toEqual({ yolo: true });
  });
});

/** Walk the conversation to the review step, picking a plan. */
function reachReview(): void {
  render(<V2OnboardingPage />);
  fireEvent.change(screen.getByLabelText('Business name'), { target: { value: 'Acme Labs' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // 1 → 2
  fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // 2 → 3
  fireEvent.click(screen.getByRole('button', { name: 'Ask me before any plan' }));
  fireEvent.click(screen.getByRole('button', { name: 'Skip for now' })); // 3 → 4
  fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // 4 → 5
}

beforeEach(() => {
  localStorage.clear();
  mutateAsync.mockReset();
  ws.mockReset();
});

describe('the autonomy chips', () => {
  it('offers all three with none pre-selected and says what they do', () => {
    render(<V2OnboardingPage />);
    fireEvent.change(screen.getByLabelText('Business name'), { target: { value: 'Acme Labs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    for (const label of ['Ask me before any plan', 'Only merges and actions', 'Let the weaver decide']) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false');
    }
    expect(screen.getByText(/Action approvals always stay with you/)).toBeInTheDocument();
  });
});

describe('creating the workspace', () => {
  it('writes the chosen policy only after the workspace exists', async () => {
    mutateAsync.mockResolvedValue({ id: 'acme', path: '~/weave/acme-labs' });
    ws.mockResolvedValue({});
    reachReview();
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    await screen.findByRole('button', { name: 'Open Acme Labs' });
    expect(mutateAsync).toHaveBeenCalledWith({ id: 'acme-labs', name: 'Acme Labs', ticketPrefix: 'AL', path: '~/weave/acme-labs' });
    expect(ws).toHaveBeenCalledWith('acme', '/config', { method: 'PATCH', body: { defaults: { proposalApproval: 'human', yolo: false } } });
  });

  it('writes no policy when creating the workspace fails', async () => {
    mutateAsync.mockRejectedValue(new Error('boom'));
    reachReview();
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(ws).not.toHaveBeenCalled();
  });
});
