/**
 * VS-624: the Projects section's Visual plan artifact control. A direct PATCH of
 * `policies.visualPlanArtifact`, and the add-project form carrying the choice (default off).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  patch: vi.fn(),
  add: vi.fn(),
  projects: [] as Array<Record<string, unknown>>,
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: vi.fn() }), ToastProvider: ({ children }: { children?: React.ReactNode }) => children }));
vi.mock('../api/hooks', () => ({
  useProjects: () => ({ data: state.projects, isLoading: false, isError: false }),
  useAddProject: () => ({ mutate: state.add, mutateAsync: vi.fn(), isPending: false }),
  usePatchProject: () => ({ mutate: state.patch, mutateAsync: vi.fn(), isPending: false }),
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
  state.add = vi.fn();
  state.projects = [{
    id: 'p1', slug: 'api', name: 'api', status: 'ready', defaultBranch: 'main', landingBranch: null,
    clonePath: '/ws/projects/api', maxWorkers: 4, setupCommand: null, worktreeProvider: 'git',
    openspecEnabled: true, knowledgeRepoEnabled: false, knowledgeSwitch: null, policies: {},
  }];
});

describe('the Projects section Visual plan artifact control (VS-624)', () => {
  it('is on the project row without opening Delivery & setup, reads off by default and PATCHes on', () => {
    render(<ProjectsSection />);
    // The reviewer's requirement: visible in the row header, not behind the expander.
    expect(screen.queryByText('Hide delivery & setup')).toBeNull();
    const select = screen.getByLabelText('visual plan artifact for api') as HTMLSelectElement;
    expect(select.value).toBe('off');
    expect(screen.getAllByText('experimental').length).toBeGreaterThanOrEqual(1);
    fireEvent.change(select, { target: { value: 'on' } });
    expect(state.patch).toHaveBeenCalledWith({ id: 'p1', patch: { policies: { visualPlanArtifact: true } } });
  });

  it('turns off a project that has it on, still without opening the panel', () => {
    state.projects = [{ ...state.projects[0]!, policies: { visualPlanArtifact: true } }];
    render(<ProjectsSection />);
    expect(screen.queryByText('Hide delivery & setup')).toBeNull();
    fireEvent.change(screen.getByLabelText('visual plan artifact for api'), { target: { value: 'off' } });
    expect(state.patch).toHaveBeenCalledWith({ id: 'p1', patch: { policies: { visualPlanArtifact: false } } });
  });

  it('the add form defaults the choice off and sends it when checked', () => {
    render(<ProjectsSection />);
    const box = screen.getByLabelText('Visual plan artifact') as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.change(screen.getByPlaceholderText('git@github.com:acme/api.git'), { target: { value: 'git@github.com:acme/new.git' } });
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }));
    expect(state.add).toHaveBeenCalledWith(
      expect.objectContaining({ policies: { autoMergeDefault: false, visualPlanArtifact: true } }),
      expect.anything(),
    );
  });
});