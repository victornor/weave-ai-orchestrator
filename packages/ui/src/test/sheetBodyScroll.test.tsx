/**
 * VS-629: `Sheet`'s opt-in bounded, non-scrolling body — the layout the ticket modal takes so it can
 * pin its own header and scroll one inner feed — and focus restoration to the control that opened it.
 * The default body (the settings sheets) is unchanged and still scrolls.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

const { Sheet } = await import('../components/Sheet');

describe('Sheet bodyScroll (VS-629)', () => {
  it('defaults to the scrolling body', () => {
    render(
      <Sheet open onClose={() => undefined} title="A sheet">
        <p>content</p>
      </Sheet>,
    );
    const body = screen.getByText('content').parentElement as HTMLElement;
    expect(body.className).toContain('ac-scroll');
    expect(body.className).not.toContain('overflow-hidden');
  });

  it('bodyScroll={false} gives a bounded body that does not scroll', () => {
    render(
      <Sheet open onClose={() => undefined} title="A sheet" bodyScroll={false}>
        <p>content</p>
      </Sheet>,
    );
    const body = screen.getByText('content').parentElement as HTMLElement;
    expect(body.className).not.toContain('ac-scroll');
    expect(body.className).toContain('overflow-hidden');
    expect(body.className).toContain('flex-1');
  });

  it('returns focus to the control that opened it on close', () => {
    function Harness(): React.ReactElement {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            open
          </button>
          <Sheet open={open} onClose={() => setOpen(false)} title="A sheet">
            <p>content</p>
          </Sheet>
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'open' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});