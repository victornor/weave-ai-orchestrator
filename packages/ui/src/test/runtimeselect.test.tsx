/** The runtime selector in Settings → Projects reads detection.status, not a boolean (VS-45). */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeInfo } from '../api/types';

const state = vi.hoisted(() => ({ runtimes: [] as unknown[] }));

vi.mock('../api/context', () => ({ useWs: () => 'ws1' }));
vi.mock('../app/link', () => ({ useGo: () => vi.fn(), useSearchParams: () => ({}) }));
vi.mock('../lib/theme', () => ({ useTheme: () => ['dark', vi.fn()] }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('../api/hooks', () => ({
  useRuntimes: () => ({ data: state.runtimes }),
  useProjects: () => ({ data: [], isLoading: false }),
  useAddProject: () => ({ mutate: vi.fn(), isPending: false }),
  usePatchProject: () => ({ mutate: vi.fn(), isPending: false }),
  useWorkspaceSummary: () => ({ data: undefined, isLoading: false }),
  useWorkspaces: () => ({ data: [] }),
  usePatchConfig: () => ({ mutate: vi.fn(), isPending: false }),
  useDaemonUpdate: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
  useDaemonUpgrade: () => ({ data: undefined, isError: false }),
}));

const { SettingsRoute } = await import('../routes/Settings');

const runtime = (id: string, detection: RuntimeInfo['detection']): RuntimeInfo => ({
  id, displayName: id, detection, capabilities: {},
});

/** Render Settings and switch to the Projects tab, the way the operator gets there. */
function openProjects(): void {
  render(<SettingsRoute />);
  fireEvent.click(screen.getByRole('tab', { name: 'Projects' }));
}

beforeEach(() => {
  state.runtimes = [];
});

describe('Settings — runtime selector', () => {
  it('enables a runtime the daemon host detected', () => {
    state.runtimes = [runtime('claude', { status: 'available', version: '2.1.0' })];
    openProjects();
    const option = screen.getByRole('option', { name: 'claude' }) as HTMLOptionElement;
    expect(option.disabled).toBe(false);
  });

  it('disables and labels a runtime whose binary is missing', () => {
    state.runtimes = [runtime('codex', { status: 'missing_binary' })];
    openProjects();
    const option = screen.getByRole('option', { name: 'codex (not installed)' }) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
  });

  it('says why a detected but broken runtime cannot be used', () => {
    state.runtimes = [runtime('gemini', { status: 'broken', notes: 'exited 1' })];
    openProjects();
    const option = screen.getByRole('option', { name: 'gemini (installed but not working)' }) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
  });
});
