/**
 * VS-634: the strip under a weaver message — one chip per referenced ticket, capped at six with a
 * "+N more" that expands in place, its status updating without a remount, and its click going
 * through the link handler it is given.
 */
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Agent, UiStatus } from '@weave-ai/shared';
import { V2TicketStrip, MAX_STRIP_CHIPS } from '../v2/ChatChips';
import { agent, ticket } from './factories';
import type { Dispatch } from '../lib/dispatch';

function reference(identifier: string, over: { status?: UiStatus; worker?: Agent | null } = {}): Dispatch {
  return {
    ticket: ticket({ id: `tk_${identifier}`, identifier, title: `${identifier} title`, projectId: null }),
    worker: over.worker ?? null,
    status: over.status ?? 'idle',
  };
}

describe('V2TicketStrip (VS-634)', () => {
  it('renders nothing, and reserves no height, for no references', () => {
    const { container } = render(<V2TicketStrip references={[]} projectIds={[]} open={vi.fn()} />);
    expect(container.querySelector('[data-v2-ticket-strip]')).toBeNull();
  });

  it('opens the ticket through the handler it is given', () => {
    const open = vi.fn();
    const { container } = render(
      <V2TicketStrip references={[reference('VS-1'), reference('VS-2')]} projectIds={[]} open={open} />,
    );
    const chips = container.querySelectorAll('[data-v2-dispatch-chip]');
    expect(chips).toHaveLength(2);
    fireEvent.click(chips[1]!);
    expect(open).toHaveBeenCalledWith('VS-2');
  });

  it('shows six chips and a "+N more" that expands the rest in place', () => {
    const references = Array.from({ length: MAX_STRIP_CHIPS + 2 }, (_, i) => reference(`VS-${i + 1}`));
    const { container } = render(<V2TicketStrip references={references} projectIds={[]} open={vi.fn()} />);
    expect(container.querySelectorAll('[data-v2-dispatch-chip]')).toHaveLength(MAX_STRIP_CHIPS);
    const more = container.querySelector('[data-v2-ticket-strip-more]')!;
    expect(more.textContent).toContain('+2 more');
    fireEvent.click(more);
    expect(container.querySelectorAll('[data-v2-dispatch-chip]')).toHaveLength(MAX_STRIP_CHIPS + 2);
    expect(container.querySelector('[data-v2-ticket-strip-more]')).toBeNull();
  });

  it('updates a chip status in place, without remounting it', () => {
    const references = [reference('VS-1', { status: 'working' })];
    const { container, rerender } = render(<V2TicketStrip references={references} projectIds={[]} open={vi.fn()} />);
    const before = container.querySelector('[data-v2-dispatch-chip]')!;
    expect(before.textContent).toContain('working');
    rerender(<V2TicketStrip references={[reference('VS-1', { status: 'done' })]} projectIds={[]} open={vi.fn()} />);
    const after = container.querySelector('[data-v2-dispatch-chip]')!;
    expect(after).toBe(before);
    expect(after.textContent).toContain('done');
  });

  it('names a ticket by its worker once one exists, else by its title', () => {
    const worker = agent({ id: 'w1', name: 'Platform Engineer #552', ticketId: 'tk_VS-2' });
    const { container } = render(
      <V2TicketStrip references={[reference('VS-1'), reference('VS-2', { worker })]} projectIds={[]} open={vi.fn()} />,
    );
    const chips = container.querySelectorAll('[data-v2-dispatch-chip]');
    expect(chips[0]!.textContent).toContain('VS-1 title');
    expect(chips[1]!.textContent).toContain('Platform Engineer #552');
  });
});
