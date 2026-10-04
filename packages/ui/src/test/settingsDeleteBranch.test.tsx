/** VS-770: the Projects section's "delete branch after merge" policy control. */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  patch: vi.fn(),
  projects: [] as Array<Record<string, unknown>>,
  config: {} as Record<string, unknown>,
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: vi.fn() }), ToastProvider: ({ children }: { children?: React.ReactNode }) => children }));
vi.mock('../api/hooks', () => ({
  useProjects: () => ({ data: state.projects, isLoading: false, isError: false }),
  useAddProject: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  usePatchProject: () => ({ mutate: state.patch, mutateAsync: vi.fn(), isPending: false }),
  useRepoInfo: () => ({ mutateAsync: async () => null, mutate: vi.fn(), isPending: false }),
  useRemoveProject: () => ({ mutate: vi.fn(), isPending: false }),
  useMoveProject: () => ({ mutate: vi.fn(), isPending: false }),
  useWorkers: () => ({ data: [] }),
  useWorkspaces: () => ({ data: [] }),
  useWorkspaceSummary: () => ({ data: { config: state.config } }),
}));

const { ProjectsSection } = await import('../settings/sections');

beforeEach(() => {
  state.patch = vi.fn();
  state.config = {};
  state.projects = [{
    id: 'p1', slug: 'api', name: 'api', status: 'ready', defaultBranch: 'main', landingBranch: null,
    clonePath: '/ws/projects/api', maxWorkers: 4, setupCommand: null, worktreeProvider: 'git',
    openspecEnabled: true, knowledgeRepoEnabled: false, knowledgeSwitch: null, policies: {},
  }];
});

function openPanel(): HTMLSelectElement {
  fireEvent.click(screen.getByText(/delivery & setup/i));
  return screen.getByLabelText('delete branch after merge for api') as HTMLSelectElement;
}

describe('the delete-branch-after-merge control (VS-770)', () => {
  it('inherits the workspace default (on) and PATCHes off', () => {
    render(<ProjectsSection />);
    const select = openPanel();
    expect(select.value).toBe('inherit');
    expect(screen.getByText('inherit (on)')).toBeTruthy();
    fireEvent.change(select, { target: { value: 'off' } });
    expect(state.patch).toHaveBeenCalledWith({ id: 'p1', patch: { policies: { deleteBranchAfterMerge: false } } });
  });

  it('names a workspace default of off', () => {
    state.config = { defaults: { deleteBranchAfterMerge: false } };
    render(<ProjectsSection />);
    openPanel();
    expect(screen.getByText('inherit (off)')).toBeTruthy();
  });
});
