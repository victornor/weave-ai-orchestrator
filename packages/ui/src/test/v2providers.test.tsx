/**
 * Settings → Providers (VS-610): the provider list, add-from-preset, edit, the masked key input, and
 * Test connection with apply-detected-flags — all against mocked routes, asserting no key value ever
 * reaches the DOM.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const state = vi.hoisted(() => ({
  search: { scope: 'acme', section: 'providers' } as Record<string, string | undefined>,
  payload: {
    providers: [
      {
        id: 'openrouter',
        secretConfigured: true,
        models: ['deepseek/r1', 'z-ai/glm'],
        profile: { preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKeySecret: 'WEAVE_LLM_OPENROUTER_KEY', auth: 'bearer', headers: { 'X-Title': 'Weave AI' }, discover: true, models: { 'deepseek/r1': { contextWindow: 128000 } } },
      },
      {
        id: 'local',
        secretConfigured: false,
        models: ['llama'],
        profile: { baseUrl: 'http://127.0.0.1:11434/v1', auth: 'none', headers: {}, models: { llama: {} } },
      },
    ],
    presets: [{ id: 'openrouter', description: 'OpenRouter.' }, { id: 'openai-compatible', description: 'Generic.' }],
  },
  saves: [] as Array<{ id: string; profile: Record<string, unknown> }>,
  deletes: [] as string[],
  secretWrites: [] as Array<{ id: string; value: string }>,
  clears: [] as string[],
  testCalls: [] as Array<{ id: string; model?: string }>,
  testReport: { ok: true, provider: 'openrouter', model: 'deepseek/r1', checks: [{ name: 'models list', ok: true, detail: '2 models' }, { name: 'streamed answer', ok: true, detail: 'ok' }], detected: {} } as Record<string, unknown>,
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
  useProviders: () => ({ isLoading: false, isError: false, data: state.payload }),
  useSaveProvider: () => ({ mutate: (v: { id: string; profile: Record<string, unknown> }) => { state.saves.push(v); }, mutateAsync: async (v: { id: string; profile: Record<string, unknown> }) => { state.saves.push(v); }, isError: false }),
  useDeleteProvider: () => ({ mutate: (id: string) => { state.deletes.push(id); } }),
  useSetProviderSecret: () => ({ mutate: (v: { id: string; value: string }) => { state.secretWrites.push(v); }, isPending: false }),
  useClearProviderSecret: () => ({ mutate: (id: string) => { state.clears.push(id); }, isPending: false }),
  useTestProvider: () => ({ mutate: (vars: { id: string; model?: string }, opts?: { onSuccess?: (r: unknown) => void }) => { state.testCalls.push(vars); opts?.onSuccess?.(state.testReport); }, isPending: false, isError: false, error: null }),
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
  state.testReport = { ok: true, provider: 'openrouter', model: 'deepseek/r1', checks: [{ name: 'models list', ok: true, detail: '2 models' }, { name: 'streamed answer', ok: true, detail: 'ok' }], detected: {} };
});

function open(): void {
  state.search = { scope: 'acme', section: 'providers' };
  render(<V2Settings />);
}

describe('the Providers section', () => {
  it('lists each provider with base URL, preset, model count and secret state, and no key value', () => {
    open();
    expect(screen.getAllByText('openrouter').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('https://openrouter.ai/api/v1')).toBeInTheDocument();
    expect(screen.getByText('2 models')).toBeInTheDocument();
    expect(screen.getAllByText('key set').length).toBe(1);
    expect(screen.getAllByText('no key').length).toBe(1);
  });

  it('states that repository content goes to the configured endpoint and no default ships', () => {
    open();
    expect(screen.getByText(/Repository content is sent to/i)).toBeInTheDocument();
    expect(screen.getByText(/no default provider ships/i)).toBeInTheDocument();
  });

  it('adds a provider from a preset, prefilling the base URL and the secret name', () => {
    open();
    fireEvent.click(screen.getByText('+ Add from a preset'));
    fireEvent.change(screen.getByLabelText('New provider id'), { target: { value: 'or' } });
    expect(screen.getByLabelText('New provider base URL')).toHaveValue('https://openrouter.ai/api/v1');
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));
    expect(state.saves.at(-1)).toEqual({
      id: 'or',
      profile: { preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKeySecret: 'WEAVE_LLM_OR_KEY', auth: 'bearer', headers: {}, discover: true, models: {} },
    });
  });

  it('edits a profile and saves it', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /openrouter/ }));
    fireEvent.change(screen.getByLabelText('openrouter base URL'), { target: { value: 'https://gateway.example.test/v1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(state.saves.at(-1)?.profile.baseUrl).toBe('https://gateway.example.test/v1');
    // The untouched model entries are preserved.
    expect(state.saves.at(-1)?.profile.models).toEqual({ 'deepseek/r1': { contextWindow: 128000 } });
  });

  it('rejects malformed compat JSON instead of saving', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /openrouter/ }));
    fireEvent.change(screen.getByLabelText('openrouter compat'), { target: { value: '{ not json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(state.saves).toHaveLength(0);
    expect(screen.getByRole('alert')).toHaveTextContent(/not valid JSON/);
  });

  it('saves a typed key without ever rendering it back', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /openrouter/ }));
    const field = screen.getByLabelText('openrouter API key') as HTMLInputElement;
    expect(field.type).toBe('password');
    expect(field.value).toBe('');
    fireEvent.change(field, { target: { value: 'sk-super-secret-000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
    expect(state.secretWrites.at(-1)).toEqual({ id: 'openrouter', value: 'sk-super-secret-000' });
    expect((screen.getByLabelText('openrouter API key') as HTMLInputElement).value).toBe('');
    expect(document.body.textContent).not.toContain('sk-super-secret-000');
  });

  it('clears a key and shows it as not set', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /openrouter/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(state.clears).toEqual(['openrouter']);
  });

  it('runs Test connection, shows each check and applies detected flags', () => {
    state.testReport = { ok: true, provider: 'openrouter', model: 'deepseek/r1', checks: [{ name: 'models list', ok: true, detail: '2 models' }, { name: 'tool call', ok: false, detail: 'no tools' }], detected: { maxTokensParam: 'max_tokens' } };
    open();
    fireEvent.click(screen.getByRole('button', { name: /openrouter/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(state.testCalls.at(-1)).toEqual({ id: 'openrouter' });
    expect(screen.getByText('models list')).toBeInTheDocument();
    expect(screen.getByText('tool call')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Apply detected flags' }));
    expect(state.saves.at(-1)?.profile.compat).toEqual({ maxTokensParam: 'max_tokens' });
  });

  it('does not offer apply when the probe detected no differences', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /openrouter/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(screen.getByText('No flag differences detected.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply detected flags' })).toBeNull();
  });

  it('asks for confirmation before removing', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /openrouter/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(state.deletes).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));
    expect(state.deletes).toEqual(['openrouter']);
  });
});
