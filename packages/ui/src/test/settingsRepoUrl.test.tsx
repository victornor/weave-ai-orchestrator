/** VS-811: the Projects section's repo URL field. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  patch: vi.fn(),
  projects: [] as Array<Record<string, unknown>>,
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: vi.fn() }), ToastProvider: ({ children }: { children?: React.ReactNode }) => children }));
vi.mock('../api/hooks', () => ({
  useProjects: () => ({ data: state.projects, isLoading: false, isError: false }),
  useAddProject: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  usePatchProject: () => ({ mutate: vi.fn(), mutateAsync: state.patch, isPending: false }),
  useRepoInfo: () => ({ mutateAsync: async () => null, mutate: vi.fn(), isPending: false }),
  useRemoveProject: () => ({ mutate: vi.fn(), isPending: false }),
  useMoveProject: () => ({ mutate: vi.fn(), isPending: false }),
  useWorkers: () => ({ data: [] }),
  useWorkspaces: () => ({ data: [] }),
  useWorkspaceSummary: () => ({ data: { config: {} } }),
}));

const { ProjectsSection } = await import('../settings/sections');

beforeEach(() => {
  state.patch = vi.fn();
  state.projects = [{
    id: 'p1', slug: 'api', name: 'api', gitUrl: 'git@example.com:a/api.git', status: 'ready', defaultBranch: 'main', landingBranch: null,
    clonePath: '/ws/projects/api', maxWorkers: 4, setupCommand: null, worktreeProvider: 'git',
    openspecEnabled: true, knowledgeRepoEnabled: false, knowledgeSwitch: null, policies: {},
  }];
});

describe('the repo URL field (VS-811)', () => {
  it('shows the current URL and PATCHes the new one', async () => {
    state.patch.mockResolvedValue({});
    render(<ProjectsSection />);
    const input = screen.getByLabelText('repo URL for api') as HTMLInputElement;
    expect(input.value).toBe('git@example.com:a/api.git');
    fireEvent.change(input, { target: { value: ' git@example.com:b/api.git ' } });
    fireEvent.blur(input);
    await waitFor(() => expect(state.patch).toHaveBeenCalledWith({ id: 'p1', patch: { url: 'git@example.com:b/api.git' } }));
  });

  it('shows the server refusal', async () => {
    state.patch.mockRejectedValue(new Error("default branch 'main' was not found on x"));
    render(<ProjectsSection />);
    const input = screen.getByLabelText('repo URL for api');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.blur(input);
    expect(await screen.findByText(/default branch 'main' was not found/)).toBeTruthy();
  });
});
