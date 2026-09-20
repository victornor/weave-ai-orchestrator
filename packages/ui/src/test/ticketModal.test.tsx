/**
 * VS-623: the one ticket link handler — desktop opens a modal over the chat, phone navigates, and
 * the modal's top control, Escape and not-found all behave.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TicketDetail } from '../api/types';
import { ticket } from './factories';

const state = vi.hoisted(() => ({
  go: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  ticket: null as ReturnType<typeof ticket> | null,
  error: false,
}));

vi.mock('../app/link', () => ({ useGo: () => state.go, useSearchParams: () => ({}) }));
vi.mock('../api/context', () => ({ useWs: () => 'ws1' }));
vi.mock('../api/workerActivity', () => ({ useWorkerActivity: () => new Map() }));
vi.mock('../api/hooks', () => ({
  useTicket: () => ({
    data: state.error ? undefined : ({ ticket: state.ticket, worker: null, project: null, role: null, blockers: [], attachments: [] } as unknown as TicketDetail),
    isLoading: false,
    isError: state.error,
  }),
  useTicketRuns: () => ({ data: [] }),
  useTicketComments: () => ({ data: [], isLoading: false }),
  useWorkers: () => ({ data: [] }),
}));

const { TicketModalProvider, useTicketLink } = await import('../v2/ticket/TicketModal');

function Opener(): React.ReactElement {
  const open = useTicketLink();
  return <button type="button" onClick={() => open('ACME-42')}>open</button>;
}

/** A chat-like child with a draft, to prove opening and closing never unmounts it. */
function DraftChat(): React.ReactElement {
  const open = useTicketLink();
  const [text, setText] = useState('');
  return (
    <>
      <input aria-label="draft" value={text} onChange={(e) => setText(e.target.value)} />
      <button type="button" onClick={() => open('ACME-42')}>open</button>
    </>
  );
}

function renderProvider(): void {
  render(
    <TicketModalProvider>
      <Opener />
    </TicketModalProvider>,
  );
}

/** Force the media query that decides modal (desktop) vs navigation (phone). */
function media(desktop: boolean): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (q: string) => ({ matches: desktop && q.includes('min-width: 768px'), media: q, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }) as unknown as MediaQueryList,
  );
}

let realMatchMedia: typeof window.matchMedia;
beforeEach(() => {
  realMatchMedia = window.matchMedia;
  state.go = vi.fn();
  state.ticket = ticket({ identifier: 'ACME-42', title: 'Dark mode for the dashboard' });
  state.error = false;
});
afterEach(() => {
  window.matchMedia = realMatchMedia;
});

describe('the shared ticket link handler (VS-623)', () => {
  it('opens the modal over the chat on a desktop viewport, without navigating', () => {
    media(true);
    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'open' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Dark mode for the dashboard')).toBeInTheDocument();
    expect(state.go).not.toHaveBeenCalled();
  });

  it('the top control opens the full ticket page', () => {
    media(true);
    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open ticket' }));
    expect(state.go).toHaveBeenCalledWith('/w/$ws/tickets/$ticketId', { params: { ws: 'ws1', ticketId: 'ACME-42' } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Escape and the close control both close it', () => {
    media(true);
    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'open' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows not-found rather than a broken modal for an unknown identifier', () => {
    media(true);
    state.error = true;
    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'open' }));
    expect(screen.getByText(/No ticket ACME-42 in this workspace\./)).toBeInTheDocument();
  });

  it('navigates to the ticket page on a phone viewport instead of opening the modal', () => {
    media(false);
    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'open' }));
    expect(state.go).toHaveBeenCalledWith('/w/$ws/tickets/$ticketId', { params: { ws: 'ws1', ticketId: 'ACME-42' } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('leaves the chat draft intact across opening and closing the modal', () => {
    media(true);
    render(
      <TicketModalProvider>
        <DraftChat />
      </TicketModalProvider>,
    );
    const draft = screen.getByLabelText('draft') as HTMLInputElement;
    fireEvent.change(draft, { target: { value: 'half-written message' } });
    fireEvent.click(screen.getByRole('button', { name: 'open' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('half-written message');
  });
});
