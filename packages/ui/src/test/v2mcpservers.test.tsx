/**
 * Settings → MCP servers (VS-621): the server list, add/edit/remove, Test, and the masked secret
 * input for a `${SECRET_NAME}` reference — all against mocked routes, asserting no secret value ever
 * reaches the DOM.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const state = vi.hoisted(() => ({
  search: { scope: 'acme', section: 'mcp' } as Record<string, string | undefined>,
  payload: {
    servers: [
      {
        name: 'github',
        config: { type: 'stdio', command: 'npx', args: ['-y', 'server-github'], env: { GITHUB_TOKEN: '${MCP_GITHUB_TOKEN}' }, headers: {}, listTimeoutMs: 30000, callTimeoutMs: 60000, readOnly: false },
        secrets: [{ name: 'MCP_GITHUB_TOKEN', configured: true }],
      },
      {
        name: 'docs',
        config: { type: 'http', url: 'https://mcp.example/sse', args: [], env: {}, headers: { Authorization: 'Bearer ${MCP_DOCS_TOKEN}' }, listTimeoutMs: 30000, callTimeoutMs: 60000, readOnly: true },
        secrets: [{ name: 'MCP_DOCS_TOKEN', configured: false }],
      },
    ],
  },
  saves: [] as Array<{ name: string; config: Record<string, unknown> }>,
  deletes: [] as string[],
  secretWrites: [] as Array<{ name: string; value: string }>,
  clears: [] as string[],
  testCalls: [] as string[],
  testReport: { name: 'github', ok: true, tools: [{ name: 'search', description: 'search issues' }] } as Record<string, unknown>,
}));

vi.mock('@tanstack/react-router', () => ({ Outlet: () => null, useRouterState: () => '/settings', useParams: () => ({}) }));
vi.mock('../app/link', () => ({
  A: ({ to, children }: { to: string; children?: ReactNode }) => <a href={to}>{children}</a>,
  useGo: () => () => undefined,
  useSearchParams: () => state.search,
}));
vi.mock('../api/context', () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useWs: () => 'acme',
  useHookWs: () => 'acme',
  useOptionalWorkspace: () => null,
}));
vi.mock('../api/hooks', () => ({
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
  useMcpServers: () => ({ isLoading: false, isError: false, data: state.payload }),
  useSaveMcpServer: () => ({ mutateAsync: async (v: { name: string; config: Record<string, unknown> }) => { state.saves.push(v); }, isError: false }),
  useDeleteMcpServer: () => ({ mutate: (name: string) => { state.deletes.push(name); } }),
  useSetMcpSecret: () => ({ mutate: (v: { name: string; value: string }) => { state.secretWrites.push(v); }, isPending: false }),
  useClearMcpSecret: () => ({ mutate: (name: string) => { state.clears.push(name); }, isPending: false }),
  useTestMcpServer: () => ({ mutate: (name: string, opts?: { onSuccess?: (r: unknown) => void }) => { state.testCalls.push(name); opts?.onSuccess?.(state.testReport); }, isPending: false, isError: false, error: null }),
}));
vi.mock('../settings/sections', () => ({
  UpdatesSection: () => null, SecuritySection: () => null, HostToolsSection: () => null, DictationSection: () => null,
  DeviceSection: () => null, ProjectsSection: () => null, ChannelsSection: () => null, PresentationSection: () => null,
  KnowledgeBudgetsSection: () => null, YoloSection: () => null,
}));

const { V2Settings } = await import('../v2/settings/V2Settings');

beforeEach(() => {
  state.saves = [];
  state.deletes = [];
  state.secretWrites = [];
  state.clears = [];
  state.testCalls = [];
  state.testReport = { name: 'github', ok: true, tools: [{ name: 'search', description: 'search issues' }] };
});

function open(): void { state.search = { scope: 'acme', section: 'mcp' }; render(<V2Settings />); }

describe('the MCP servers section', () => {
  it('lists each server with its transport, target and secret state, and no secret value', () => {
    open();
    expect(screen.getAllByText('stdio').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('http').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('npx')).toBeInTheDocument();
    expect(screen.getByText('https://mcp.example/sse')).toBeInTheDocument();
    expect(screen.getAllByText('1/1 secret').length).toBeGreaterThanOrEqual(1);
  });

  it('states that a stdio server is arbitrary code the human chose to run', () => {
    open();
    expect(screen.getByText(/arbitrary code you chose to run on the host/i)).toBeInTheDocument();
  });

  it('adds a server and saves the definition', () => {
    open();
    fireEvent.click(screen.getByText('+ Add a server'));
    fireEvent.change(screen.getByLabelText('New MCP server name'), { target: { value: 'linear' } });
    fireEvent.change(screen.getByLabelText('New MCP server target'), { target: { value: 'npx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add server' }));
    expect(state.saves.at(-1)?.name).toBe('linear');
    expect(state.saves.at(-1)?.config).toMatchObject({ type: 'stdio', command: 'npx' });
  });

  it('refuses the reserved name weave-ai', () => {
    open();
    fireEvent.click(screen.getByText('+ Add a server'));
    fireEvent.change(screen.getByLabelText('New MCP server name'), { target: { value: 'weave-ai' } });
    fireEvent.change(screen.getByLabelText('New MCP server target'), { target: { value: 'npx' } });
    expect(screen.getByRole('button', { name: 'Add server' })).toBeDisabled();
  });

  it('edits a server and saves it', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /github/ }));
    fireEvent.change(screen.getByLabelText('github command'), { target: { value: '/usr/bin/mcp-github' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!);
    expect((state.saves.at(-1)?.config as { command: string }).command).toBe('/usr/bin/mcp-github');
  });

  it('saves a referenced secret without ever rendering it back', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /github/ }));
    const field = screen.getByLabelText('MCP_GITHUB_TOKEN value') as HTMLInputElement;
    expect(field.type).toBe('password');
    expect(field.value).toBe('');
    fireEvent.change(field, { target: { value: 'ghp-super-secret-000' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!);
    expect(state.secretWrites.at(-1)).toEqual({ name: 'MCP_GITHUB_TOKEN', value: 'ghp-super-secret-000' });
    expect((screen.getByLabelText('MCP_GITHUB_TOKEN value') as HTMLInputElement).value).toBe('');
    expect(document.body.textContent).not.toContain('ghp-super-secret-000');
  });

  it('tests a server by listing its tools', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /github/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(state.testCalls).toEqual(['github']);
    expect(screen.getByText('search')).toBeInTheDocument();
    expect(screen.getByText('search issues')).toBeInTheDocument();
  });

  it('shows a test failure', () => {
    state.testReport = { name: 'github', ok: false, tools: [], error: 'spawn npx ENOENT' };
    open();
    fireEvent.click(screen.getByRole('button', { name: /github/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(screen.getByRole('alert')).toHaveTextContent('spawn npx ENOENT');
  });

  it('asks for confirmation before removing', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /github/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(state.deletes).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));
    expect(state.deletes).toEqual(['github']);
  });
});
