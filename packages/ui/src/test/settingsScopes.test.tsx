/** Settings separates daemon-wide settings from workspace and device ones (VS-52), and since
 * VS-230 shows them as two destinations: the workspace's at /w/$ws/settings, the daemon's at
 * /settings — no switcher, each page naming its scope, and old area links redirected. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { qk } from '../api/keys';
import { readShowSilentTurns, writeShowSilentTurns } from '../lib/chatPrefs';
import {
  SETTINGS_AREAS,
  SETTINGS_SECTIONS,
  firstSectionOf,
  redirectForSettingsRoute,
  resolveSettingsLocation,
  sectionForRoute,
  sectionsOfArea,
} from '../lib/settings';

const state = vi.hoisted(() => ({
  search: {} as Record<string, string | undefined>,
  navigations: [] as Array<{ to: string; opts?: Record<string, unknown> }>,
  ctxWs: 'ws1' as string,
  update: null as Record<string, unknown> | null,
}));

vi.mock('../api/context', () => ({
  useWs: () => state.ctxWs || 'ws1',
  useHookWs: (o?: string) => o ?? state.ctxWs,
}));
vi.mock('../app/link', () => ({
  useGo: () => (to: string, opts?: Record<string, unknown>) => { state.navigations.push({ to, ...(opts ? { opts } : {}) }); },
  useSearchParams: () => state.search,
}));
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('../api/hooks', () => ({
  useWorkspaceSummary: () => ({ data: { workspace: { id: 'ws1', name: 'Acme', ticketPrefix: 'ACME' }, config: {} }, isLoading: false }),
  useWorkspaces: () => ({ data: [{ id: 'ws2', slug: 'other', name: 'Other' }] }),
  usePatchConfig: () => ({ mutate: vi.fn(), isPending: false }),
  useProjects: () => ({ data: [], isLoading: false }),
  useRuntimes: () => ({ data: [] }),
  useRuntimeModels: () => ({ data: [] }),
  useAddProject: () => ({ mutate: vi.fn(), isPending: false }),
  usePatchProject: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMoveProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useWorkers: () => ({ data: [], isLoading: false }),
  useModels: () => ({ data: { conductor: { runtime: 'claude', model: null }, workers: { runtime: 'claude', model: null } }, isLoading: false }),
  useModelsOptional: () => ({ data: undefined, isLoading: false }),
  useSetModels: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  usePatchConductor: () => ({ mutate: vi.fn(), isPending: false }),
  usePresentation: () => ({ data: { default: 'headless' }, isLoading: false, isError: false, refetch: vi.fn() }),
  usePresentationSurfaces: () => ({ data: { surfaces: ['headless'] } }),
  usePutPresentation: () => ({ mutate: vi.fn(), isPending: false }),
  useMe: () => ({ data: { totpEnabled: false, session: { id: 's1' } } }),
  useAuthSessions: () => ({ data: [], isLoading: false }),
  useDaemonUpdate: () => ({ data: state.update ?? { configured: false, running: { version: '1.0.0', path: '/rel', sha: 'a'.repeat(40) } }, isLoading: false, isError: false, refetch: vi.fn() }),
  useDaemonUpgrade: () => ({ data: { upgrade: null, waitingFor: [] }, isError: false }),
  useRefreshDaemonUpdate: () => ({ mutate: vi.fn(), isPending: false }),
  useRequestUpgrade: () => ({ mutate: vi.fn(), isPending: false }),
  useTelegramTokenStatus: () => ({ data: { configured: false, source: null, botUsername: null } }),
  useSetTelegramToken: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useClearTelegramToken: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTelegramPending: () => ({ data: { pending: [] } }),
  useApproveTelegramUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDisableTelegramAllowAll: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelUpgrade: () => ({ mutate: vi.fn(), isPending: false }),
  useTranscription: () => ({ data: { backend: 'chrome', model: null, voxtype: { installed: false, models: [] } }, isLoading: false }),
  useSetTranscription: () => ({ mutate: vi.fn(), isPending: false }),
  useDaemonModels: () => ({ data: { conductor: null, workers: null, workerOptions: null }, isLoading: false }),
  useSetDaemonModels: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useRoutines: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useRoutineUsage: () => ({ data: { tokensIn: 0, tokensOut: 0, tokensCached: 0, runs: 0, costCents: 0, costReportedCents: 0, window: '7d' }, isLoading: false }),
  useCreateRoutine: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  usePatchRoutine: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveRoutine: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { WorkspaceSettingsRoute, DaemonSettingsRoute } = await import('../routes/Settings');

/** SecuritySection reaches for the query client directly, so the page needs a real provider. */
const renderSettings = (route: 'workspace' | 'daemon'): void => {
  const Route = route === 'daemon' ? DaemonSettingsRoute : WorkspaceSettingsRoute;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Route />
    </QueryClientProvider>,
  );
};

const tabNames = (): string[] => screen.getAllByRole('tab').map((t) => t.textContent ?? '');
const openWorkspaceSettings = (): void => renderSettings('workspace');
const openDaemonSettings = (): void => renderSettings('daemon');

beforeEach(() => {
  state.search = {};
  state.navigations = [];
  state.ctxWs = 'ws1';
  state.update = null;
  localStorage.clear();
});

/* --------------------------------------------------------------- the model */

describe('the area model', () => {
  it('files every section under exactly one area, and leaves no area empty', () => {
    for (const s of SETTINGS_SECTIONS) {
      const owning = SETTINGS_AREAS.filter((a) => sectionsOfArea(a.key).some((x) => x.key === s.key));
      expect(owning.map((a) => a.key)).toEqual([s.area]);
    }
    for (const a of SETTINGS_AREAS) expect(sectionsOfArea(a.key).length).toBeGreaterThan(0);
    expect(new Set(SETTINGS_SECTIONS.map((s) => s.key)).size).toBe(SETTINGS_SECTIONS.length);
  });

  it('puts each setting in the area its data actually belongs to', () => {
    const areaOf = (key: string): string | undefined => SETTINGS_SECTIONS.find((s) => s.key === key)?.area;
    for (const key of ['workspace', 'projects', 'models', 'channels', 'presentation', 'scheduled']) expect(areaOf(key)).toBe('workspace');
    for (const key of ['updates', 'dictation', 'security', 'device']) expect(areaOf(key)).toBe('daemon');
  });

  it('resolves a section named without an area, and lets the section win over a contradicting one', () => {
    expect(resolveSettingsLocation({ section: 'updates' })).toEqual({ area: 'daemon', section: 'updates' });
    expect(resolveSettingsLocation({ area: 'workspace', section: 'updates' })).toEqual({ area: 'daemon', section: 'updates' });
  });

  it('falls back rather than resolving to nothing', () => {
    expect(resolveSettingsLocation({})).toEqual({ area: 'workspace', section: firstSectionOf('workspace') });
    expect(resolveSettingsLocation({ section: 'nope' })).toEqual({ area: 'workspace', section: firstSectionOf('workspace') });
    expect(resolveSettingsLocation({ area: 'nope', section: 'nope' })).toEqual({ area: 'workspace', section: firstSectionOf('workspace') });
    expect(resolveSettingsLocation({ area: 'daemon', section: 'nope' })).toEqual({ area: 'daemon', section: firstSectionOf('daemon') });
  });

  it('splits the sections between the two routes, each keeping only its own', () => {
    expect(sectionForRoute('workspace', { section: 'channels' })).toBe('channels');
    expect(sectionForRoute('workspace', { section: 'updates' })).toBe(firstSectionOf('workspace'));
    expect(sectionForRoute('daemon', { section: 'dictation' })).toBe('dictation');
    expect(sectionForRoute('daemon', { section: 'projects' })).toBe(firstSectionOf('daemon'));
    expect(sectionForRoute('daemon', undefined)).toBe(firstSectionOf('daemon'));
  });
});

/* --------------------------------------------------- the redirect decider */

describe('redirecting a link that names the other side (VS-230)', () => {
  describe('from the workspace route', () => {
    it('sends a daemon section to the daemon route, carrying the rest of the search', () => {
      expect(redirectForSettingsRoute('workspace', { section: 'updates' })).toEqual({
        type: 'redirect', to: '/settings', search: { section: 'updates' },
      });
      expect(redirectForSettingsRoute('workspace', { keep: 'me', section: 'security' })).toEqual({
        type: 'redirect', to: '/settings', search: { keep: 'me', section: 'security' },
      });
    });

    it('sends an explicit daemon area to its first section', () => {
      expect(redirectForSettingsRoute('workspace', { area: 'daemon' })).toEqual({
        type: 'redirect', to: '/settings', search: { section: firstSectionOf('daemon') },
      });
    });

    it('keeps its own sections and falls back on unknown ones', () => {
      expect(redirectForSettingsRoute('workspace', {})).toEqual({ type: 'stay' });
      expect(redirectForSettingsRoute('workspace', { section: 'channels' })).toEqual({ type: 'stay' });
      expect(redirectForSettingsRoute('workspace', { section: 'nope', area: 'nope' })).toEqual({ type: 'stay' });
      expect(redirectForSettingsRoute('workspace', { area: 'workspace', section: 'models' })).toEqual({ type: 'stay' });
    });
  });

  describe('from the daemon route', () => {
    it('sends a named workspace section to the remembered workspace\u2019s settings', () => {
      expect(redirectForSettingsRoute('daemon', { section: 'channels' }, 'ws9')).toEqual({
        type: 'redirect', to: '/w/$ws/settings', search: { section: 'channels' }, ws: 'ws9',
      });
      expect(redirectForSettingsRoute('daemon', { keep: 'me', section: 'projects' }, 'ws9')).toEqual({
        type: 'redirect', to: '/w/$ws/settings', search: { keep: 'me', section: 'projects' }, ws: 'ws9',
      });
    });

    it('sends an explicit workspace area to that workspace\u2019s first section', () => {
      expect(redirectForSettingsRoute('daemon', { area: 'workspace' }, 'ws9')).toEqual({
        type: 'redirect', to: '/w/$ws/settings', search: { section: firstSectionOf('workspace') }, ws: 'ws9',
      });
    });

    it('with no remembered workspace, sheds the stale names rather than showing another scope', () => {
      expect(redirectForSettingsRoute('daemon', { section: 'channels' }, null)).toEqual({
        type: 'redirect', to: '/settings', search: {},
      });
      expect(redirectForSettingsRoute('daemon', { area: 'workspace' }, '')).toEqual({
        type: 'redirect', to: '/settings', search: {},
      });
    });

    it('never redirects its own sections, its default, or an unknown one', () => {
      expect(redirectForSettingsRoute('daemon', {}, 'ws9')).toEqual({ type: 'stay' });
      expect(redirectForSettingsRoute('daemon', { section: 'updates' }, 'ws9')).toEqual({ type: 'stay' });
      expect(redirectForSettingsRoute('daemon', { section: 'device' }, null)).toEqual({ type: 'stay' });
      expect(redirectForSettingsRoute('daemon', { section: 'nope' }, 'ws9')).toEqual({ type: 'stay' });
    });
  });
});

/* ---------------------------------------------------------------- the pages */

describe('the workspace settings page', () => {
  it('lists only the workspace sections, and offers no area switcher', () => {
    openWorkspaceSettings();
    expect(tabNames()).toEqual(['Workspace', 'Projects', 'Models', 'Channels', 'Presentation', 'Scheduled tasks']);
    for (const label of SETTINGS_AREAS.map((a) => a.label)) {
      expect(screen.queryByRole('radio', { name: label })).not.toBeInTheDocument();
    }
  });

  it('names the workspace it configures', () => {
    openWorkspaceSettings();
    expect(screen.getByText('This workspace · Acme')).toBeInTheDocument();
  });

  it('opens the section a deep link names, and walks every section from one render', () => {
    state.search = { section: 'channels' };
    openWorkspaceSettings();
    expect(screen.getByRole('tab', { name: 'Channels' })).toHaveAttribute('aria-selected', 'true');
    for (const section of sectionsOfArea('workspace')) {
      fireEvent.click(screen.getByRole('tab', { name: section.label }));
      expect(screen.getByRole('tab', { name: section.label })).toHaveAttribute('aria-selected', 'true');
    }
  });

  it('falls back to its first section on a daemon section or a name that does not exist', () => {
    state.search = { section: 'updates' };
    openWorkspaceSettings();
    expect(screen.getByRole('tab', { name: 'Workspace' })).toHaveAttribute('aria-selected', 'true');
    cleanup();

    state.search = { section: 'nope' };
    openWorkspaceSettings();
    expect(screen.getByRole('tab', { name: 'Workspace' })).toHaveAttribute('aria-selected', 'true');
  });

  it('writes the section into the URL, and no area, without stacking history entries', () => {
    openWorkspaceSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Channels' }));
    expect(state.navigations.at(-1)).toEqual({
      to: '/w/$ws/settings',
      opts: { params: { ws: 'ws1' }, search: { section: 'channels' }, replace: true },
    });
  });
});

describe('the daemon settings page', () => {
  it('lists only the daemon sections, and offers no area switcher', () => {
    openDaemonSettings();
    expect(tabNames()).toEqual(['Updates', 'Models', 'Dictation', 'Security & Devices', 'This device']);
    for (const label of SETTINGS_AREAS.map((a) => a.label)) {
      expect(screen.queryByRole('radio', { name: label })).not.toBeInTheDocument();
    }
  });

  it('reads as daemon-wide', () => {
    openDaemonSettings();
    expect(screen.getByText('This daemon · applies to every workspace')).toBeInTheDocument();
  });

  it('opens the Updates section when the URL names no section, and walks every section from one render', () => {
    openDaemonSettings();
    expect(screen.getByRole('tab', { name: 'Updates' })).toHaveAttribute('aria-selected', 'true');
    for (const section of sectionsOfArea('daemon')) {
      fireEvent.click(screen.getByRole('tab', { name: section.label }));
      expect(screen.getByRole('tab', { name: section.label })).toHaveAttribute('aria-selected', 'true');
    }
  });

  it('opens the section a deep link names, and falls back on one it does not own', () => {
    for (const key of ['updates', 'dictation', 'daemon-models']) {
      cleanup();
      state.search = { section: key };
      openDaemonSettings();
      expect(screen.getByRole('tab', { name: SETTINGS_SECTIONS.find((s) => s.key === key)!.label })).toHaveAttribute('aria-selected', 'true');
    }
    cleanup();
    state.search = { section: 'channels' };
    openDaemonSettings();
    expect(screen.getByRole('tab', { name: 'Updates' })).toHaveAttribute('aria-selected', 'true');
    cleanup();
    state.search = { section: 'nope' };
    openDaemonSettings();
    expect(screen.getByRole('tab', { name: 'Updates' })).toHaveAttribute('aria-selected', 'true');
  });

  it('writes the section into the URL without stacking history entries', () => {
    openDaemonSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Dictation' }));
    expect(state.navigations.at(-1)).toEqual({
      to: '/settings',
      opts: { search: { section: 'dictation' }, replace: true },
    });
  });

  it('announces a daemon update, opening the Updates section, and hides it once Updates is shown', () => {
    state.update = { configured: true, updateAvailable: true, ref: 'main', targetSha: 'b'.repeat(40), running: { version: '1.0.0', path: '/rel', sha: 'a'.repeat(40) } };
    state.search = { section: 'dictation' };
    openDaemonSettings();
    const banner = screen.getByLabelText('Daemon update available');
    fireEvent.click(banner);
    expect(state.navigations.at(-1)).toEqual({
      to: '/settings',
      opts: { search: { section: 'updates' }, replace: true },
    });

    cleanup();
    state.search = { section: 'updates' };
    openDaemonSettings();
    expect(screen.queryByLabelText('Daemon update available')).not.toBeInTheDocument();
  });
});

/* -------------------------------------------------------------- the device */

describe('settings held in this browser', () => {
  it('sits in the daemon area, labelled as this device\u2019s and stored in this browser only', () => {
    state.search = { section: 'device' };
    openDaemonSettings();
    expect(screen.getByRole('tab', { name: 'This device' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/stored in this browser only/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'dark' })).toBeInTheDocument();
    for (const label of ['Decisions', 'Landed work', 'Everything else']) {
      expect(screen.getByRole('switch', { name: label })).toBeInTheDocument();
    }
  });

  it('offers the chat\u2019s trace-only rows as a device preference, on by default (VS-74)', () => {
    state.search = { section: 'device' };
    openDaemonSettings();
    const rows = screen.getByRole('switch', { name: 'Turns with no reply' });
    expect(rows).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(rows);

    expect(screen.getByRole('switch', { name: 'Turns with no reply' })).toHaveAttribute('aria-checked', 'false');
    expect(readShowSilentTurns()).toBe(false);
    writeShowSilentTurns(true);
  });

  it('keeps push addressable, per workspace, from the daemon page (VS-230)', () => {
    state.search = { section: 'device' };
    openDaemonSettings();
    expect(screen.getByRole('button', { name: 'Get notified when something needs you' })).toBeInTheDocument();
  });

  it('says push is registered per workspace when this browser remembers none', () => {
    state.ctxWs = '';
    state.search = { section: 'device' };
    openDaemonSettings();
    expect(screen.getByText(/Push is registered per workspace/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Get notified when something needs you' })).not.toBeInTheDocument();
  });

  it('no longer offers the theme as a workspace setting, and keeps the workspace list there', () => {
    openWorkspaceSettings();
    expect(screen.queryByRole('button', { name: 'dark' })).not.toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
  });
});

/* --------------------------------------------------------------- the cache */

describe('daemon state is not cached per workspace', () => {
  it('gives daemon-level queries a key with no workspace segment', () => {
    for (const key of [qk.daemonUpdate(), qk.daemonUpgrade(), qk.sessions(), qk.me(), qk.workspaces(), qk.runtimes()]) {
      expect(key).not.toContain('w');
      expect(key).not.toContain('ws1');
    }
  });

  it('keeps workspace-level queries under their workspace', () => {
    for (const key of [qk.workspace('ws1'), qk.projects('ws1'), qk.conductor('ws1'), qk.presentation('ws1'), qk.routines('ws1')]) {
      expect(key.slice(0, 2)).toEqual(['w', 'ws1']);
    }
    expect(qk.workspace('ws1')).not.toEqual(qk.workspace('ws2'));
  });
});
