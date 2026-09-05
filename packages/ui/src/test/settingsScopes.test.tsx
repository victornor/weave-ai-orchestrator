/** Settings separates daemon-wide settings from workspace and device ones (VS-52). */
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { qk } from '../api/keys';
import {
  SETTINGS_AREAS,
  SETTINGS_SECTIONS,
  firstSectionOf,
  resolveSettingsLocation,
  sectionsOfArea,
} from '../lib/settings';

const state = vi.hoisted(() => ({
  search: {} as Record<string, string | undefined>,
  navigations: [] as Array<{ to: string; opts?: Record<string, unknown> }>,
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1' }));
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
  useConductor: () => ({ data: { agent: { runtimeId: 'claude', model: null } }, isLoading: false }),
  usePatchConductor: () => ({ mutate: vi.fn(), isPending: false }),
  usePresentation: () => ({ data: { default: 'headless' }, isLoading: false, isError: false, refetch: vi.fn() }),
  usePresentationSurfaces: () => ({ data: { surfaces: ['headless'] } }),
  usePutPresentation: () => ({ mutate: vi.fn(), isPending: false }),
  useMe: () => ({ data: { totpEnabled: false, session: { id: 's1' } } }),
  useAuthSessions: () => ({ data: [], isLoading: false }),
  useDaemonUpdate: () => ({ data: { configured: false, running: { version: '1.0.0', path: '/rel', sha: 'a'.repeat(40) } }, isLoading: false, isError: false, refetch: vi.fn() }),
  useDaemonUpgrade: () => ({ data: { upgrade: null, waitingFor: [] }, isError: false }),
  useRefreshDaemonUpdate: () => ({ mutate: vi.fn(), isPending: false }),
  useRequestUpgrade: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelUpgrade: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { SettingsRoute } = await import('../routes/Settings');

/** SecuritySection reaches for the query client directly, so the page needs a real provider. */
const renderSettings = (): void => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsRoute />
    </QueryClientProvider>,
  );
};

const tabNames = (): string[] => screen.getAllByRole('tab').map((t) => t.textContent ?? '');
const areaSwitch = (label: string): HTMLElement => screen.getByRole('radio', { name: label });

beforeEach(() => {
  state.search = {};
  state.navigations = [];
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
    for (const key of ['workspace', 'projects', 'conductor', 'channels', 'presentation']) expect(areaOf(key)).toBe('workspace');
    for (const key of ['updates', 'security', 'device']) expect(areaOf(key)).toBe('daemon');
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
});

/* ---------------------------------------------------------------- the page */

describe('the two areas', () => {
  it('offers both areas and lists only the selected one’s sections', () => {
    renderSettings();
    expect(areaSwitch('This workspace')).toHaveAttribute('aria-checked', 'true');
    expect(areaSwitch('This daemon')).toHaveAttribute('aria-checked', 'false');
    expect(tabNames()).toEqual(['Workspace', 'Projects', 'Conductor', 'Channels', 'Presentation']);

    fireEvent.click(areaSwitch('This daemon'));
    expect(areaSwitch('This daemon')).toHaveAttribute('aria-checked', 'true');
    expect(tabNames()).toEqual(['Updates', 'Security & Devices', 'This device']);
  });

  it('writes the area and the section into the URL without stacking history entries', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Channels' }));
    expect(state.navigations.at(-1)).toEqual({
      to: '/w/$ws/settings',
      opts: { params: { ws: 'ws1' }, search: { area: 'workspace', section: 'channels' }, replace: true },
    });

    fireEvent.click(areaSwitch('This daemon'));
    expect(state.navigations.at(-1)?.opts).toMatchObject({ search: { area: 'daemon', section: 'updates' }, replace: true });
  });

  it('opens the section a deep link names, with that section’s own area selected', () => {
    state.search = { section: 'updates' };
    renderSettings();
    expect(areaSwitch('This daemon')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('tab', { name: 'Updates' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows a valid area when the URL names one that does not exist', () => {
    state.search = { area: 'nope', section: 'nope' };
    renderSettings();
    expect(areaSwitch('This workspace')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('tab', { name: 'Workspace' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps every section reachable from one render, the way the phone’s More tab arrives', () => {
    renderSettings();
    for (const area of SETTINGS_AREAS) {
      fireEvent.click(areaSwitch(area.label));
      for (const section of sectionsOfArea(area.key)) {
        fireEvent.click(screen.getByRole('tab', { name: section.label }));
        expect(screen.getByRole('tab', { name: section.label })).toHaveAttribute('aria-selected', 'true');
      }
    }
  });
});

/* -------------------------------------------------------------- the device */

describe('settings held in this browser', () => {
  const openDevice = (): void => {
    renderSettings();
    fireEvent.click(areaSwitch('This daemon'));
    fireEvent.click(screen.getByRole('tab', { name: 'This device' }));
  };

  it('groups the theme and the notification preferences and says where they are stored', () => {
    openDevice();
    expect(screen.getByText(/stored in this browser only/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'dark' })).toBeInTheDocument();
    for (const label of ['Decisions', 'Landed work', 'Everything else']) {
      expect(screen.getByRole('switch', { name: label })).toBeInTheDocument();
    }
  });

  it('no longer offers the theme as a workspace setting, and keeps the workspace list there', () => {
    renderSettings();
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
    for (const key of [qk.workspace('ws1'), qk.projects('ws1'), qk.conductor('ws1'), qk.presentation('ws1')]) {
      expect(key.slice(0, 2)).toEqual(['w', 'ws1']);
    }
    expect(qk.workspace('ws1')).not.toEqual(qk.workspace('ws2'));
  });
});
