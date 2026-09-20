/**
 * The `weave` runtime in the worker-model catalog editor (VS-610): the model picker is fed by
 * `listModels`, the effort picker by the model's declared `efforts`, and the parameters section is
 * generated from the adapter's `configSchema()` — with the schema's own message on an out-of-range
 * value. No hand-written field per parameter.
 */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { WEAVE_SCHEMA } = vi.hoisted(() => ({
  WEAVE_SCHEMA: {
    type: 'object',
    additionalProperties: false,
    properties: {
      temperature: { type: 'number', minimum: 0, maximum: 2, description: 'Sampling temperature; sent only when set' },
      topP: { type: 'number', minimum: 0, maximum: 1, description: 'Nucleus sampling; sent only when set' },
      frequencyPenalty: { type: 'number', minimum: -2, maximum: 2, description: 'Frequency penalty; sent only when set' },
      presencePenalty: { type: 'number', minimum: -2, maximum: 2, description: 'Presence penalty; sent only when set' },
      maxOutputTokens: { type: 'integer', minimum: 1, description: 'Output cap' },
      seed: { type: 'integer', description: 'Sampling seed' },
      stop: { type: 'array', items: { type: 'string' }, description: 'Stop sequences' },
      toolChoice: { type: 'string', enum: ['auto', 'required', 'none'], description: 'How the model may pick tools' },
      parallelToolCalls: { type: 'boolean', description: 'Parallel tool calls' },
      responseFormat: { type: 'string', enum: ['text', 'json_object'], description: 'Response format' },
      extraBody: { type: 'string', description: 'A JSON object merged last into the request body' },
      extraHeaders: { type: 'array', items: { type: 'string' }, description: 'Extra request headers' },
      contextWindowTokens: { type: 'integer', minimum: 1, description: 'The model window when the endpoint does not say' },
    },
  },
}));

const state = vi.hoisted(() => ({
  writes: [] as unknown[],
}));

vi.mock('../api/context', () => ({ useWs: () => 'acme', useHookWs: () => 'acme' }));
vi.mock('../api/hooks', () => ({
  useRuntimes: () => ({ data: [{ id: 'weave', displayName: 'Weave Agent', detection: { status: 'available' }, capabilities: {}, configSchema: WEAVE_SCHEMA }] }),
  useRuntimeModels: (runtime: string | null | undefined) => ({ data: runtime === 'weave' ? [{ id: 'or/r1', label: 'r1 (or)', provider: 'or', source: 'detected', efforts: ['low', 'high'] }] : [] }),
  useModels: () => ({
    isLoading: false,
    data: {
      weaver: { runtime: 'claude', model: null },
      workers: { runtime: 'weave', model: 'or/r1', options: { temperature: 3 } },
      workerOptions: [],
      source: { weaver: 'daemon', workers: 'workspace', workerOptions: 'default' },
    },
  }),
  useDaemonModels: () => ({ data: { weaver: null, workers: null, workerOptions: null } }),
  useSetModels: () => ({ mutate: (v: unknown) => { state.writes.push(v); } }),
}));

const { WorkspaceModelsSection } = await import('../v2/settings/sections/Models');

beforeEach(() => { state.writes = []; });

describe('the weave runtime in the model catalog editor', () => {
  it('renders a generated control for every parameter the schema declares', () => {
    render(<WorkspaceModelsSection />);
    for (const key of ['temperature', 'topP', 'frequencyPenalty', 'presencePenalty', 'maxOutputTokens', 'seed', 'stop', 'toolChoice', 'parallelToolCalls', 'responseFormat', 'extraBody', 'extraHeaders', 'contextWindowTokens']) {
      expect(screen.getAllByText(key).length, key).toBeGreaterThanOrEqual(1);
    }
  });

  it('shows the schema message for an out-of-range value, not a silent save', () => {
    render(<WorkspaceModelsSection />);
    expect(screen.getByRole('alert')).toHaveTextContent('temperature must be at most 2');
  });

  it('feeds the model picker from listModels and the effort picker from the model efforts', () => {
    render(<WorkspaceModelsSection />);
    const model = screen.getByLabelText('workers model') as HTMLSelectElement;
    expect(within(model).getByRole('option', { name: 'r1 (or) (or/r1)' })).toBeInTheDocument();
    const effort = screen.getByLabelText('workers thinking level') as HTMLSelectElement;
    expect(within(effort).getByRole('option', { name: 'high' })).toBeInTheDocument();
    expect(within(effort).getByRole('option', { name: 'low' })).toBeInTheDocument();
  });
});
