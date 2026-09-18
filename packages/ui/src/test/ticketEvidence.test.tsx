/**
 * VS-555: the ticket-evidence strip an approval card renders. Images preview and open at full size,
 * a non-image stays a labelled download, and an empty list renders nothing at all.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TicketAttachment } from '@weave-ai/shared';
import { TicketEvidence } from '../components/TicketEvidence';

function attachment(over: Partial<TicketAttachment> = {}): TicketAttachment {
  const id = over.id ?? 'a1';
  return {
    id,
    ticketId: 'tk1',
    label: 'capture.png',
    mediaType: 'image/png',
    byteSize: 1234,
    sha256: 'sha',
    storageKey: `${id}.png`,
    createdAt: '2026-09-18T01:00:00.000Z',
    ...over,
    url: over.url ?? `/api/w/ws1/tickets/tk1/attachments/${id}`,
  };
}

/** The attachment ids in the order they render. */
function order(): string[] {
  return [...document.querySelectorAll('[data-v2-section="evidence"] [data-attachment]')].map(
    (el) => el.getAttribute('data-attachment') ?? '',
  );
}

describe('TicketEvidence', () => {
  it('renders nothing for an empty or absent list', () => {
    const { container: empty } = render(<TicketEvidence attachments={[]} />);
    expect(empty.firstChild).toBeNull();
    const { container: absent } = render(<TicketEvidence attachments={null} />);
    expect(absent.firstChild).toBeNull();
  });

  it('shows an image as a preview and opens it at full size, dismissed with Escape', () => {
    render(<TicketEvidence attachments={[attachment()]} />);
    expect(screen.getByAltText('capture.png')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View capture.png at full size' }));
    expect(screen.getByRole('dialog', { name: 'capture.png at full size' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps a non-image as a labelled download, never dropping it', () => {
    render(<TicketEvidence attachments={[attachment({ id: 'z1', label: 'shots.zip', mediaType: 'application/zip', byteSize: 2048 })]} />);
    const link = screen.getByRole('link', { name: /shots\.zip/ });
    expect(link).toHaveAttribute('download', 'shots.zip');
    expect(link.getAttribute('href')).toBe('/api/w/ws1/tickets/tk1/attachments/z1');
    expect(link.textContent).toContain('application/zip');
    expect(link.textContent).toContain('2,048 bytes');
  });

  it('orders newest first and keeps several images beside a non-image', () => {
    render(
      <TicketEvidence
        attachments={[
          attachment({ id: 'old', label: 'old.png', createdAt: '2026-09-17T00:00:00.000Z' }),
          attachment({ id: 'zip', label: 'logs.zip', mediaType: 'application/zip', createdAt: '2026-09-18T00:00:00.000Z' }),
          attachment({ id: 'new', label: 'new.png', createdAt: '2026-09-18T02:00:00.000Z' }),
        ]}
      />,
    );
    expect(order()).toEqual(['new', 'zip', 'old']);
  });
});
