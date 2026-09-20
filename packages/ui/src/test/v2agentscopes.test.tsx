/**
 * Settings → Providers and MCP servers in two scopes (VS-633): configured once in the daemon settings,
 * and in a workspace shown as the merged view — inherited entries marked "from daemon" and read-only,
 * with Override / Hide here, and Remove override for an entry the workspace replaces. Each hook is
 * handed the scope it acts on, so a daemon edit and a workspace edit reach different routes.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const profile = (baseUrl: string) => ({ baseUrl, apiKeySecret: 'WEAVE_LLM_X_KEY', auth: 'bearer', headers: {}, models: { m1: {} } });
const mcp = (command: string) => ({ type: 'stdio', command, args: [], env: {}, headers: {}, listTimeoutMs: 30000, callTimeoutMs: 60000, readOnly: false });

const state = vi.hoisted(() => ({
  search: {} as Record<string, string | undefined>,
  scopes: [] as string[],
  saves: [] as Array<{ scope: string; id: string }>,
  deletes: [] as Array<{ scope: string; id: string }>,
  hides: [] as Array<{ id: string; disabled: boolean }>,
  tests: [] as Array<{ scope: string; id: string; model?: string }>,
  discoveries: [] as Array<{ scope: string; id: string }>,
  secrets: [] as Array<{ scope: string; id: string; value: string }>,
}));

vi.mock('@tanstack/react-router', () => ({ Outlet: () => null, useRouterState: () => '/settings', useParams: () => ({}) }));
vi.mock('../app/link', () => ({
  A: ({ to, children }: { to: string; children?: ReactNode }) => <a href={to}>{children}</a>,
  useGo: () => () => undefined,
  useSearchParams: () => state.search,
}));
vi.mock('../api/context', () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useWs: () => 'acme', useHookWs: () => 'acme', useOptionalWorkspace: () => null,
}));
vi.mock('../api/hooks', () => {
  const daemonProviders = { providers: [{ id: 'dp', secretConfigured: true, models: ['m1'], source: 'daemon', profile: profile('https://d.example.test/v1') }], presets: [] };
  const wsProviders = {
    providers: [
      { id: 'dp', secretConfigured: true, models: ['m1'], source: 'daemon', profile: profile('https://d.example.test/v1') },
      { id: 'ov', secretConfigured: false, models: ['m1'], source: 'override', profile: profile('https://w.example.test/v1') },
      { id: 'own', secretConfigured: false, models: ['m1'], source: 'workspace', profile: profile('https://own.example.test/v1') },
    ],
    disabled: [{ id: 'gone', secretConfigured: false, models: [], source: 'daemon', profile: profile('https://gone.example.test/v1') }],
    presets: [],
  };
  const daemonMcp = { servers: [{ name: 'docs', secrets: [], source: 'daemon', config: mcp('npx-daemon') }] };
  const wsMcp = {
    servers: [
      { name: 'docs', secrets: [], source: 'daemon', config: mcp('npx-daemon') },
      { name: 'ovm', secrets: [], source: 'override', config: mcp('npx-ws') },
    ],
    disabled: [{ name: 'hidden-mcp', secrets: [], source: 'daemon', config: mcp('npx-hidden') }],
  };
  return {
    useWorkspaces: () => ({ data: [{ id: 'acme', name: 'Acme', ticketPrefix: 'ACME', root: '', projects: [], needsYou: 0 }] }),
    useWorkers: () => ({ data: [] }),
    useWorkersMany: (ids: readonly string[]) => ids.map(() => ({ data: [] })),
    useDecisionsMany: (ids: readonly string[]) => ids.map(() => ({ data: [] })),
    useIncidents: () => ({ data: { items: [] } }),
    useRuntimes: () => ({ data: [] }),
    useDaemonModels: () => ({ data: { weaver: null, workers: null, workerOptions: null } }),
    useSetDaemonModels: () => ({ mutate: () => undefined }),
    useModels: () => ({ isLoading: false, data: { weaver: { runtime: 'claude', model: null }, workers: { runtime: 'claude', model: null }, workerOptions: [], source: { weaver: 'daemon', workers: 'daemon', workerOptions: 'default' } } }),
    useSetModels: () => ({ mutate: () => undefined }),
    useWorkspaceSummary: () => ({ data: { workspace: { id: 'acme', name: 'Acme', ticketPrefix: 'ACME' }, config: {}, plugins: [] } }),
    usePatchConfig: () => ({ mutate: () => undefined, mutateAsync: async () => undefined }),
    useProviders: (scope = 'workspace') => { state.scopes.push(scope); return { isLoading: false, isError: false, data: scope === 'daemon' ? daemonProviders : wsProviders }; },
    useSaveProvider: (scope = 'workspace') => ({ mutate: () => undefined, mutateAsync: async (v: { id: string }) => { state.saves.push({ scope, id: v.id }); }, isError: false }),
    useDeleteProvider: (scope = 'workspace') => ({ mutate: (id: string) => { state.deletes.push({ scope, id }); } }),
    useSetProviderDisabled: () => ({ mutate: (v: { id: string; disabled: boolean }) => { state.hides.push(v); } }),
    useSetProviderSecret: (scope = 'workspace') => ({ mutate: (v: { id: string; value: string }) => { state.secrets.push({ scope, ...v }); }, isPending: false }),
    useClearProviderSecret: () => ({ mutate: () => undefined, isPending: false }),
    useTestProvider: (scope = 'workspace') => ({ mutate: (v: { id: string; model?: string }, o?: { onSuccess?: (r: unknown) => void }) => { state.tests.push({ scope, id: v.id, model: v.model }); o?.onSuccess?.({ ok: true, provider: v.id, model: 'm1', checks: [{ name: 'models list', ok: true, detail: '1 model' }], detected: {} }); }, isPending: false, isError: false, error: null }),
    useDiscoverProviderModels: (scope = 'workspace') => ({ mutate: (v: { id: string }, o?: { onSuccess?: (r: unknown) => void }) => { state.discoveries.push({ scope, id: v.id }); o?.onSuccess?.({ provider: v.id, ok: true, models: [{ id: 'm1' }] }); }, isPending: false, isError: false, error: null }),
    useMcpServers: (scope = 'workspace') => ({ isLoading: false, isError: false, data: scope === 'daemon' ? daemonMcp : wsMcp }),
    useSaveMcpServer: (scope = 'workspace') => ({ mutate: () => undefined, mutateAsync: async (v: { name: string }) => { state.saves.push({ scope, id: v.name }); }, isError: false }),
    useDeleteMcpServer: (scope = 'workspace') => ({ mutate: (id: string) => { state.deletes.push({ scope, id }); } }),
    useSetMcpDisabled: () => ({ mutate: (v: { name: string; disabled: boolean }) => { state.hides.push({ id: v.name, disabled: v.disabled }); } }),
    useSetMcpSecret: () => ({ mutate: () => undefined, isPending: false }),
    useClearMcpSecret: () => ({ mutate: () => undefined, isPending: false }),
    useTestMcpServer: (scope = 'workspace') => ({ mutate: (id: string, o?: { onSuccess?: (r: unknown) => void }) => { state.tests.push({ scope, id }); o?.onSuccess?.({ name: id, ok: true, tools: [{ name: 'echo', description: 'echo back' }] }); }, isPending: false, isError: false, error: null }),
  };
});
vi.mock('../settings/sections', () => ({
  UpdatesSection: () => null, SecuritySection: () => null, HostToolsSection: () => null, DictationSection: () => null,
  DeviceSection: () => null, ProjectsSection: () => null, ChannelsSection: () => null, PresentationSection: () => null,
  KnowledgeBudgetsSection: () => null, YoloSection: () => null,
}));

const { V2Settings } = await import('../v2/settings/V2Settings');

beforeEach(() => { state.scopes = []; state.saves = []; state.deletes = []; state.hides = []; state.tests = []; state.discoveries = []; state.secrets = []; });
afterEach(() => { cleanup(); delete document.documentElement.dataset['theme']; });

const openDaemon = (section: string): void => { state.search = { section }; render(<V2Settings />); };
const openWorkspace = (section: string): void => { state.search = { scope: 'acme', section }; render(<V2Settings />); };

describe.each(['light', 'dark'] as const)('in the %s theme', (theme) => {
  beforeEach(() => { document.documentElement.dataset['theme'] = theme; });

  describe('the daemon scope', () => {
    it('files Providers and MCP servers next to Models', () => {
      openDaemon('providers');
      expect(screen.getByRole('button', { name: 'Providers' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'MCP servers' })).toBeInTheDocument();
    });

    it('lists a provider unmarked, talks to the daemon routes, and tests and keys it from there', () => {
      openDaemon('providers');
      expect(state.scopes).toContain('daemon');
      expect(screen.getByText(/configured once here and visible to every workspace/)).toBeInTheDocument();
      expect(screen.queryByText('from daemon')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /dp/ }));
      expect(screen.getByText(/Held only in the daemon secret store/)).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('dp API key'), { target: { value: 'sk-daemon-secret' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
      expect(state.secrets).toEqual([{ scope: 'daemon', id: 'dp', value: 'sk-daemon-secret' }]);
      fireEvent.change(screen.getByLabelText('dp model to test'), { target: { value: 'm1' } });
      fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
      expect(state.tests).toEqual([{ scope: 'daemon', id: 'dp', model: 'm1' }]);
      expect(screen.getByText('models list')).toBeInTheDocument();
      expect(document.body.textContent).not.toContain('sk-daemon-secret');
    });

    it('shows a daemon MCP server and tests it', () => {
      openDaemon('mcp');
      expect(screen.getByText('docs')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /docs/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));
      expect(state.tests).toEqual([{ scope: 'daemon', id: 'docs' }]);
    });
  });

  describe('a workspace scope', () => {
    it('marks an inherited provider from daemon, read-only, and overrides it with its own profile', () => {
      openWorkspace('providers');
      expect(screen.getAllByText('from daemon').length).toBeGreaterThanOrEqual(1);
      fireEvent.click(screen.getByRole('button', { name: /dp/ }));
      expect(screen.queryByLabelText('dp base URL')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Override' }));
      expect(state.saves).toEqual([{ scope: 'workspace', id: 'dp' }]);
    });

    it('tests an inherited provider, and can hide it from this workspace', () => {
      openWorkspace('providers');
      fireEvent.click(screen.getByRole('button', { name: /dp/ }));
      fireEvent.change(screen.getByLabelText('dp model to test'), { target: { value: 'm1' } });
      fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
      expect(state.tests).toEqual([{ scope: 'workspace', id: 'dp', model: 'm1' }]);
      fireEvent.click(screen.getByRole('button', { name: 'Hide here' }));
      expect(state.hides).toEqual([{ id: 'dp', disabled: true }]);
    });

    it('marks an override, edits it, and Remove override restores the daemon entry', () => {
      openWorkspace('providers');
      expect(screen.getByText('overrides daemon')).toBeInTheDocument();
      expect(screen.getByText('this workspace')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^ov / }));
      expect(screen.getByLabelText('ov base URL')).toHaveValue('https://w.example.test/v1');
      fireEvent.click(screen.getByRole('button', { name: 'Remove override' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));
      expect(state.deletes).toEqual([{ scope: 'workspace', id: 'ov' }]);
    });

    it('lists what this workspace hides and shows it again', () => {
      openWorkspace('providers');
      expect(screen.getByText('Hidden from this workspace')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Show again' }));
      expect(state.hides).toEqual([{ id: 'gone', disabled: false }]);
    });

    it('does the same for MCP servers: inherited is read-only, overridable, hideable, and an override is removable', () => {
      openWorkspace('mcp');
      expect(screen.getByText('overrides daemon')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^docs/ }));
      expect(screen.queryByLabelText('docs command')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Override' }));
      fireEvent.click(screen.getByRole('button', { name: 'Hide here' }));
      expect(state.saves).toEqual([{ scope: 'workspace', id: 'docs' }]);
      expect(state.hides).toEqual([{ id: 'docs', disabled: true }]);
      fireEvent.click(screen.getByRole('button', { name: /^ovm/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Remove override' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));
      expect(state.deletes).toEqual([{ scope: 'workspace', id: 'ovm' }]);
      fireEvent.click(screen.getByRole('button', { name: 'Show again' }));
      expect(state.hides.at(-1)).toEqual({ id: 'hidden-mcp', disabled: false });
    });
  });
});
