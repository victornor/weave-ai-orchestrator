/**
 * VS-830: after a project re-point, the Projects section offers to move the daemon's release source —
 * but only when the re-point reports that it left the source on the project's previous URL, and never
 * without the offer being taken.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  patch: vi.fn(),
  setSource: vi.fn(),
  projects: [] as Array<Record<string, unknown>>,
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: vi.fn() }), ToastProvider: ({ children }: { children?: React.ReactNode }) => children }));
vi.mock('../api/hooks', () => ({
  useProjects: () => ({ data: state.projects, isLoading: false, isError: false }),
  useAddProject: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  usePatchProject: () => ({ mutate: state.patch, mutateAsync: state.patch, isPending: false }),
  useSetReleaseSource: () => ({ mutate: state.setSource, isPending: false }),
  useRepoInfo: () => ({ mutateAsync: async () => null, mutate: vi.fn(), isPending: false }),
  useRemoveProject: () => ({ mutate: vi.fn(), isPending: false }),
  useMoveProject: () => ({ mutate: vi.fn(), isPending: false }),
  useWorkers: () => ({ data: [] }),
  useWorkspaces: () => ({ data: [] }),
  useWorkspaceSummary: () => ({ data: { config: {} } }),
}));

const { ProjectsSection } = await import('../settings/sections');

const oldUrl = 'git@github.com:victornor/agent-conductor.git';
const newUrl = 'git@github.com:victornor/weave-ai-orchestrator.git';

beforeEach(() => {
  state.setSource = vi.fn();
  state.projects = [{
    id: 'p1', slug: 'api', name: 'api', status: 'ready', defaultBranch: 'main', landingBranch: null,
    gitUrl: oldUrl, clonePath: '/ws/projects/api', maxWorkers: 4, setupCommand: null, worktreeProvider: 'git',
    openspecEnabled: true, knowledgeRepoEnabled: false, knowledgeSwitch: null, policies: {},
  }];
});

/** Commit the repo URL field, with `patch` answering what the server would. */
async function repoint(answer: Record<string, unknown>): Promise<void> {
  state.patch = vi.fn(async () => ({ ...state.projects[0], gitUrl: newUrl, ...answer }));
  render(<ProjectsSection />);
  fireEvent.click(screen.getByText('Delivery & setup'));
  const field = screen.getByLabelText('repo URL for api');
  fireEvent.change(field, { target: { value: newUrl } });
  fireEvent.blur(field);
}

describe('the Projects section re-point offer (VS-830)', () => {
  it('offers to move the release source the re-point left behind', async () => {
    await repoint({ releaseSource: { previousUrl: oldUrl, currentUrl: newUrl } });
    const offer = await screen.findByRole('status');
    expect(offer.textContent).toContain(oldUrl);
    expect(screen.getByRole('button', { name: /move it to this repo/i })).toBeTruthy();
  });

  it('takes the offer through the release-source write', async () => {
    await repoint({ releaseSource: { previousUrl: oldUrl, currentUrl: newUrl } });
    fireEvent.click(await screen.findByRole('button', { name: /move it to this repo/i }));
    expect(state.setSource).toHaveBeenCalledWith({ source: newUrl }, expect.anything());
  });

  it('never changes the release source on its own', async () => {
    await repoint({ releaseSource: { previousUrl: oldUrl, currentUrl: newUrl } });
    await screen.findByRole('status');
    expect(state.setSource).not.toHaveBeenCalled();
  });

  it('offers nothing when the source was an independent choice', async () => {
    await repoint({});
    await waitFor(() => expect(state.patch).toHaveBeenCalled());
    expect(screen.queryByText(/still names/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /move it to this repo/i })).toBeNull();
  });

  it('dismisses the offer without changing anything', async () => {
    await repoint({ releaseSource: { previousUrl: oldUrl, currentUrl: newUrl } });
    fireEvent.click(await screen.findByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText(/still names/i)).toBeNull();
    expect(state.setSource).not.toHaveBeenCalled();
  });
});
