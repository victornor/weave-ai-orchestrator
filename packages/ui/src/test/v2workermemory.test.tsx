/** VS-579: the Settings → Workspace worker-memory control — effective value, set, clear and invalid. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerMemorySection } from '../v2/settings/sections/Workspace';

const state = vi.hoisted(() => ({
  config: { defaults: { workerMemoryMb: null } } as Record<string, unknown>,
  workerMemory: { mb: 8192, source: 'derived' } as { mb: number; source: string } | undefined,
  writes: [] as unknown[],
}));

vi.mock('../api/hooks', () => ({
  useWorkspaceSummary: () => ({ data: { workspace: { id: 'acme', name: 'Acme', ticketPrefix: 'ACME' }, config: state.config, workerMemory: state.workerMemory } }),
  // Mirrors the server: the write updates the stored config, so the field's last-known-saved value moves.
  usePatchConfig: () => ({
    mutateAsync: async (v: { defaults?: Record<string, unknown> }) => {
      state.writes.push(v);
      state.config = { ...state.config, defaults: { ...(state.config['defaults'] as object), ...(v.defaults ?? {}) } };
    },
  }),
}));

beforeEach(() => {
  state.config = { defaults: { workerMemoryMb: null } };
  state.workerMemory = { mb: 8192, source: 'derived' };
  state.writes = [];
});

describe('WorkerMemorySection (VS-579)', () => {
  it('shows the effective value and that it was derived', () => {
    render(<WorkerMemorySection />);
    expect(screen.getByText('8192 MB')).toBeInTheDocument();
    expect(screen.getByText('derived')).toBeInTheDocument();
  });

  it('saves a whole number of MB', async () => {
    render(<WorkerMemorySection />);
    const input = screen.getByLabelText('Worker memory limit (MB)');
    fireEvent.change(input, { target: { value: '4096' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(state.writes).toEqual([{ defaults: { workerMemoryMb: 4096 } }]));
  });

  it('refuses a value below the floor and persists nothing', async () => {
    render(<WorkerMemorySection />);
    const input = screen.getByLabelText('Worker memory limit (MB)');
    fireEvent.change(input, { target: { value: '10' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/at least 1024 MB/)).toBeInTheDocument());
    expect(state.writes).toEqual([]);
  });

  it('clears back to the derived default', async () => {
    render(<WorkerMemorySection />);
    const input = screen.getByLabelText('Worker memory limit (MB)');
    fireEvent.change(input, { target: { value: '4096' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(state.writes).toHaveLength(1));
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(state.writes).toEqual([{ defaults: { workerMemoryMb: 4096 } }, { defaults: { workerMemoryMb: null } }]));
  });
});
