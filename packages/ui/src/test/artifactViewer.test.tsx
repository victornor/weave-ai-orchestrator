import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactViewer, isPreviewableArtifactUrl } from '../components/ArtifactViewer';

const apiWs = vi.hoisted(() => vi.fn());

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../api/client');
  return { ...actual, api: { ws: apiWs } };
});

describe('isPreviewableArtifactUrl', () => {
  it('accepts a workspace raw-serve path and rejects anything else', () => {
    expect(isPreviewableArtifactUrl('/api/w/ws1/tickets/tk_1/artifacts/overview/raw', 'ws1')).toBe(true);
    expect(isPreviewableArtifactUrl('/api/w/ws1/artifacts/overview/raw?revision=2', 'ws1')).toBe(true);
    expect(isPreviewableArtifactUrl('/api/w/ws1/tickets/tk_1/artifacts/overview/raw', 'other')).toBe(false);
    expect(isPreviewableArtifactUrl('file:///tmp/artifacts/', 'ws1')).toBe(false);
    expect(isPreviewableArtifactUrl('', 'ws1')).toBe(false);
  });
});

describe('ArtifactViewer (VS-331)', () => {
  it('shows an explicit state for an empty URL, with no frame and disabled actions', () => {
    render(<ArtifactViewer ws="ws1" artifact={{ key: 'overview', title: 'Overview', url: '' }} revisions={[]} />);

    expect(screen.getByText('This artifact has no stored content to preview.')).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeDisabled();
  });

  it('shows the same state for a file:// URL and never mounts a frame with it', () => {
    render(<ArtifactViewer ws="ws1" artifact={{ key: 'shots', title: 'Phone screenshots', url: 'file:///tmp/artifacts/' }} revisions={[]} />);

    expect(screen.getByText('This artifact has no stored content to preview.')).toBeInTheDocument();
    expect(screen.getByText('file:///tmp/artifacts/')).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled();
  });

  it('renders the sandboxed frame for a real raw-serve URL', () => {
    render(
      <ArtifactViewer
        ws="ws1"
        artifact={{ key: 'overview', title: 'Overview', url: '/api/w/ws1/tickets/tk_1/artifacts/overview/raw' }}
        revisions={[]}
      />,
    );

    const frame = document.querySelector('iframe');
    expect(frame?.getAttribute('src')).toBe('/api/w/ws1/tickets/tk_1/artifacts/overview/raw');
    expect(screen.getByRole('button', { name: 'Download' })).not.toBeDisabled();
  });

  it('surfaces a failed download instead of swallowing it', async () => {
    apiWs.mockRejectedValueOnce(new Error('boom'));
    render(
      <ArtifactViewer
        ws="ws1"
        artifact={{ key: 'overview', title: 'Overview', url: '/api/w/ws1/tickets/tk_1/artifacts/overview/raw' }}
        revisions={[]}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Download failed: boom');
    expect(screen.getByRole('button', { name: 'Download' })).not.toBeDisabled();
  });
});
