import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WeaverArtifactSummary } from '../api/types';

const state = vi.hoisted(() => ({
  artifacts: [] as WeaverArtifactSummary[],
  revisions: [] as Array<{ revision: number; authorKind: string; createdAt: string; reason: string | null }>,
}));

const empty = { data: undefined, isLoading: false, isError: false };
const list = <T,>(data: T[]) => ({ data, isLoading: false, isError: false });

vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ key: 'overview' }) }));
vi.mock('../api/context', () => ({ useWs: () => 'ws1' }));
vi.mock('../api/hooks', () => ({
  useWorkspaceArtifacts: () => (state.artifacts.length ? list(state.artifacts) : { ...empty, data: state.artifacts }),
  useWorkspaceArtifactRevisions: () => list(state.revisions),
}));

const { WeaverArtifactRoute } = await import('../routes/WeaverArtifactPage');

function artifact(over: Partial<WeaverArtifactSummary> = {}): WeaverArtifactSummary {
  return { key: 'overview', title: 'Overview', kind: 'diagram', revision: 1, updatedAt: '2026-09-01T09:00:00.000Z', ...over };
}

afterEach(() => {
  cleanup();
  state.artifacts = [];
  state.revisions = [];
});

describe('WeaverArtifactRoute (VS-297)', () => {
  it('shows a not-found state when the key has no matching artifact', () => {
    state.artifacts = [];
    render(<WeaverArtifactRoute />);
    expect(screen.getByText('Artifact not found.')).toBeInTheDocument();
  });

  it('renders the artifact through ArtifactViewer, in a sandboxed frame pointed at the workspace-scoped raw route', () => {
    state.artifacts = [artifact()];
    render(<WeaverArtifactRoute />);
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    const frame = document.querySelector('iframe');
    expect(frame).toBeTruthy();
    expect(frame?.getAttribute('src')).toBe('/api/w/ws1/artifacts/overview/raw');
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-popups allow-downloads');
    expect(screen.getByText('Open in new tab ↗').getAttribute('href')).toBe('/api/w/ws1/artifacts/overview/raw');
  });

  it('offers a revision picker only once more than one revision exists', () => {
    state.artifacts = [artifact()];
    state.revisions = [{ revision: 1, createdAt: '2026-09-01T09:00:00.000Z', authorKind: 'agent', reason: null }];
    render(<WeaverArtifactRoute />);
    expect(screen.queryByText('Revisions')).not.toBeInTheDocument();

    cleanup();
    state.revisions = [
      { revision: 1, createdAt: '2026-09-01T09:00:00.000Z', authorKind: 'agent', reason: null },
      { revision: 2, createdAt: '2026-09-01T10:00:00.000Z', authorKind: 'agent', reason: null },
    ];
    render(<WeaverArtifactRoute />);
    expect(screen.getByText('Revisions')).toBeInTheDocument();
  });
});
