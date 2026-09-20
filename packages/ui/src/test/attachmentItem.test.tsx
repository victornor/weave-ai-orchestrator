/** VS-597: an attachment is presented by kind, and a failed download shows its error and a Retry. */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttachmentItem } from '../components/AttachmentItem';
import { TicketEvidence } from '../components/TicketEvidence';

const URL_ = '/api/w/ws1/tickets/tk1/attachments/a1';
const props = { url: URL_, label: 'Rendered output (720p -> 1080p)', mediaType: 'video/mp4', byteSize: 14_000, attachmentId: 'a1' };

let saved: Array<{ href: string; download: string }> = [];
beforeEach(() => {
  saved = [];
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ href: this.href, download: this.download });
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('AttachmentItem', () => {
  it('plays a video in place with controls, inline playback and a download button', () => {
    const { container } = render(<AttachmentItem {...props} />);
    const video = container.querySelector('video')!;
    expect(video.getAttribute('src')).toBe(URL_);
    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.getAttribute('preload')).toBe('metadata');
    expect(video.hasAttribute('playsinline')).toBe(true);
    expect(screen.getByRole('button', { name: /Download Rendered output \(720p -> 1080p\)\.mp4/ })).toBeInTheDocument();
  });

  it('plays audio in place likewise', () => {
    const { container } = render(<AttachmentItem {...props} mediaType="audio/mpeg" label="note" />);
    expect(container.querySelector('audio')!.getAttribute('src')).toBe(URL_);
    expect(container.querySelector('video')).toBeNull();
    expect(screen.getByRole('button', { name: 'Download note.mp3' })).toBeInTheDocument();
  });

  it('opens a PDF and a text file in a new tab through the inline address', () => {
    const { unmount } = render(<AttachmentItem {...props} mediaType="application/pdf" label="report" />);
    const open = screen.getByRole('link', { name: 'Open in new tab' });
    expect(open.getAttribute('href')).toBe(`${URL_}?inline=1`);
    expect(open).toHaveAttribute('target', '_blank');
    unmount();
    render(<AttachmentItem {...props} mediaType="text/markdown" label="notes.md" />);
    expect(screen.getByRole('link', { name: 'Open in new tab' }).getAttribute('href')).toBe(`${URL_}?inline=1`);
  });

  it('downloads anything else as a blob through fetch, saved under a named file', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AttachmentItem {...props} mediaType="application/zip" label="shots" />);
    const link = screen.getByRole('link', { name: /shots/ });
    expect(link).toHaveAttribute('href', URL_);
    await act(async () => { fireEvent.click(link); });
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledWith(URL_, { credentials: 'include' });
    expect(saved[0]).toEqual({ href: 'blob:fake', download: 'shots.zip' });
  });

  it('shows the error and a Retry when the download fails, and Retry succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AttachmentItem {...props} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Download / })); });
    expect((await screen.findByRole('alert')).textContent).toContain('The download failed (HTTP 500).');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(saved[0]!.download).toBe('Rendered output (720p -> 1080p).mp4');
  });

  it('reports a network failure instead of failing silently', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    render(<AttachmentItem {...props} mediaType="application/zip" label="x" />);
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: /x/ })); });
    expect((await screen.findByRole('alert')).textContent).toContain('Could not reach the server');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(saved).toHaveLength(0);
  });

  it('falls back to playing from a blob the page fetched itself when the direct src fails', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([0, 1, 2]), { status: 200, headers: { 'content-type': 'video/mp4' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<AttachmentItem {...props} />);
    expect(container.querySelector('video')!.getAttribute('src')).toBe(URL_);
    await act(async () => { fireEvent.error(container.querySelector('video')!); });
    await waitFor(() => expect(container.querySelector('video')!.getAttribute('src')).toBe('blob:fake'));
    expect(fetchMock).toHaveBeenCalledWith(URL_, { credentials: 'include' });
    expect(screen.queryByText(/cannot be played here/)).toBeNull();
  });

  it('says a video cannot be played when the blob fallback fails too, keeping the download', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 401 })));
    const { container } = render(<AttachmentItem {...props} />);
    await act(async () => { fireEvent.error(container.querySelector('video')!); });
    expect(await screen.findByText(/cannot be played here/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Download / })).toBeInTheDocument();
  });
});

describe('TicketEvidence with a video', () => {
  it('renders a playable video for a video/mp4 attachment on the card', () => {
    const { container } = render(
      <TicketEvidence attachments={[{ id: 'v1', ticketId: 'tk1', label: 'clip', mediaType: 'video/mp4', byteSize: 5, sha256: 's', storageKey: 'k', createdAt: '2026-09-20T00:00:00.000Z', url: URL_ }]} />,
    );
    expect(container.querySelector('[data-v2-section="evidence"] [data-attachment="v1"] video')).not.toBeNull();
  });
});
