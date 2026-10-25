/**
 * VS-578: the Projects section's OpenSpec mode control. A direct PATCH of `openspec.enabled`, and the
 * add-project form carrying the choice without breaking the strict POST body.
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
  useSetReleaseSource: () => ({ mutate: vi.fn(), isPending: false }),
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

describe('the Projects section OpenSpec control (VS-578)', () => {
  it('turns the mode off with a direct PATCH of openspec.enabled', () => {
    render(<ProjectsSection />);
    fireEvent.click(screen.getByText('Delivery & setup'));
    fireEvent.change(screen.getByLabelText('openspec for api'), { target: { value: 'off' } });
    expect(state.patch).toHaveBeenCalledWith({ id: 'p1', patch: { openspec: { enabled: false } } });
  });

  it('turns the mode on with a direct PATCH of openspec.enabled', () => {
    state.projects = [{ ...state.projects[0]!, openspecEnabled: false }];
    render(<ProjectsSection />);
    fireEvent.click(screen.getByText('Delivery & setup'));
    fireEvent.change(screen.getByLabelText('openspec for api'), { target: { value: 'on' } });
    expect(state.patch).toHaveBeenCalledWith({ id: 'p1', patch: { openspec: { enabled: true } } });
  });

  it('the add form sends the OpenSpec choice and defaults it on', () => {
    render(<ProjectsSection />);
    const box = screen.getByLabelText('Use OpenSpec') as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('git@github.com:acme/api.git'), { target: { value: 'git@github.com:acme/new.git' } });
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }));
    expect(state.add).toHaveBeenCalledWith(
      expect.objectContaining({ openspec: { enabled: false } }),
      expect.anything(),
    );
  });
});
