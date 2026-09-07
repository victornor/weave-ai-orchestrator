import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { BAR, rem, tabRects } from '../app/barGeometry';
import { BottomBar, SWIPE_SHOW_PX } from '../app/BottomBar';
import { TABS } from '../app/nav';

vi.mock('../app/link', () => ({
  A: ({ to, children, className }: { to: string; children?: ReactNode; className?: string }) => (
    <a href={to} className={className}>{children}</a>
  ),
}));

/** Phone widths the design contract draws (390px frame) and the narrow ends. */
const PHONE_WIDTHS = [320, 360, 375, 390, 430];

describe('bottom bar geometry', () => {
  it('leaves every tab a thumb-sized target', () => {
    for (const width of PHONE_WIDTHS) {
      for (const tab of tabRects(width, TABS.length)) {
        expect(tab.w).toBeGreaterThanOrEqual(44);
        expect(tab.h).toBeGreaterThanOrEqual(44);
      }
    }
  });

  it('starts the tab row at the bar\u2019s own padding, with nothing sunk into it', () => {
    expect(BAR.tabTop).toBeLessThan(1);
  });

  it('fits the bar chrome into 56px', () => {
    expect(rem(BAR.height)).toBeLessThanOrEqual(56);
  });

  it('gives most of the bar back when it collapses to its handle', () => {
    expect(BAR.handle).toBeLessThan(BAR.height / 2);
  });
});

/** jsdom has no layout, so the rendered geometry is read off the inline styles. */
function remStyle(value: string): number {
  const n = Number.parseFloat(value.replace('rem', ''));
  expect(Number.isNaN(n)).toBe(false);
  return rem(n);
}

describe('BottomBar', () => {
  function renderBar(): void {
    render(<BottomBar ws="ws1" items={TABS} needsCount={2} isActive={(to) => to.endsWith('/chat')} onMore={vi.fn()} onToggleHidden={vi.fn()} />);
  }

  it('renders every tab and nothing else', () => {
    renderBar();
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    // Four tabs navigate; More opens the menu, so it is a button rather than a link.
    expect(within(nav).getAllByRole('link')).toHaveLength(TABS.length - 1);
    for (const item of TABS) expect(within(nav).getByText(item.label)).toBeInTheDocument();
    // VS-81: work is asked for in the chat, so the bar carries no action of its own — the only two
    // buttons are More and, from VS-80, the nub that folds the bar away.
    expect(within(nav).getAllByRole('button')).toHaveLength(2);
    expect(within(nav).getByRole('button', { name: 'Hide the tab bar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start work/i })).toBeNull();
  });

  it('opens the More menu instead of navigating to Settings', () => {
    const onMore = vi.fn();
    render(<BottomBar ws="ws1" items={TABS} needsCount={0} isActive={() => false} onMore={onMore} onToggleHidden={vi.fn()} />);
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    const more = within(nav).getByText('More').closest('button') as HTMLButtonElement;
    expect(more).toHaveAttribute('aria-haspopup', 'dialog');
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(within(nav).queryByRole('link', { name: /More/ })).toBeNull();
    fireEvent.click(more);
    expect(onMore).toHaveBeenCalled();
  });

  it('reports the menu as expanded while it is open', () => {
    render(<BottomBar ws="ws1" items={TABS} needsCount={0} isActive={() => false} onMore={vi.fn()} onToggleHidden={vi.fn()} moreOpen />);
    expect(screen.getByText('More').closest('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('marks More active on a page the menu leads to', () => {
    render(
      <BottomBar ws="ws1" items={TABS} needsCount={0} isActive={(to) => to === '/w/ws1/usage'} onMore={vi.fn()} onToggleHidden={vi.fn()} moreOpen={false} />,
    );
    expect(screen.getByText('More')).toHaveClass('text-text-1');
    expect(screen.getByText('Chat')).toHaveClass('text-text-nav');
  });

  it('leaves More inactive on a page one of the tabs carries', () => {
    renderBar();
    expect(screen.getByText('More')).toHaveClass('text-text-nav');
    expect(screen.getByText('Chat')).toHaveClass('text-text-1');
  });

  it('badges More with what the other workspaces are waiting on', () => {
    render(
      <BottomBar ws="ws1" items={TABS} needsCount={0} otherWorkspacesNeed={3} isActive={() => false} onMore={vi.fn()} onToggleHidden={vi.fn()} />,
    );
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    const badge = within(nav).getByLabelText('3 waiting for you in other workspaces');
    expect(within(nav).getByText('More').closest('button')).toContainElement(badge);
    expect(badge.className).toContain('absolute');
  });

  it('gives the update the one badge slot when both would show', () => {
    render(
      <BottomBar
        ws="ws1"
        items={TABS}
        needsCount={0}
        otherWorkspacesNeed={3}
        update={{ state: 'available', title: 'Update available', detail: 'main · bbbbbbbbbb' }}
        isActive={() => false}
        onMore={vi.fn()}
        onToggleHidden={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Daemon update available')).toBeInTheDocument();
    expect(screen.queryByLabelText('3 waiting for you in other workspaces')).toBeNull();
  });

  it('badges More when the daemon has an update, without moving the tabs', () => {
    render(
      <BottomBar
        ws="ws1"
        items={TABS}
        needsCount={0}
        update={{ state: 'available', title: 'Update available', detail: 'main · bbbbbbbbbb' }}
        isActive={() => false}
        onMore={vi.fn()}
        onToggleHidden={vi.fn()}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    const badge = within(nav).getByLabelText('Daemon update available');
    expect(within(nav).getByText('More').closest('button')).toContainElement(badge);
    // Out of flow, like the Needs-you count: the bar keeps the geometry the rest of this file pins down.
    expect(badge.className).toContain('absolute');
    expect(nav.style.paddingTop).toBe(`${BAR.tabTop}rem`);
  });

  it('badges nothing when there is no update', () => {
    renderBar();
    expect(screen.queryByLabelText('Daemon update available')).toBeNull();
  });

  it('lays the rendered row out from the padding the geometry declares', () => {
    renderBar();
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    const top = remStyle(nav.style.paddingTop);
    expect(top).toBe(rem(BAR.tabTop));
    // The row the render produces is the one the geometry tests above are about.
    for (const tab of tabRects(390, TABS.length, { ...BAR, tabTop: top / 16 })) {
      expect(tab.h).toBeGreaterThanOrEqual(44);
    }
  });
});

describe('hiding the bar', () => {
  function renderHidden(onToggleHidden = vi.fn()): { onToggleHidden: ReturnType<typeof vi.fn>; handle: HTMLElement } {
    render(
      <BottomBar ws="ws1" items={TABS} needsCount={0} isActive={() => false} onMore={vi.fn()} hidden onToggleHidden={onToggleHidden} />,
    );
    return { onToggleHidden, handle: screen.getByRole('button', { name: 'Show the tab bar' }) };
  }

  it('folds the bar away from a nub on its top edge', () => {
    const onToggleHidden = vi.fn();
    render(
      <BottomBar ws="ws1" items={TABS} needsCount={0} isActive={() => false} onMore={vi.fn()} onToggleHidden={onToggleHidden} />,
    );
    const hide = screen.getByRole('button', { name: 'Hide the tab bar' });
    // Straddling the top edge, on the left — clear of More's badge on the far side.
    expect(hide.className).toContain('bottom-full');
    expect(hide.className).toContain('left-2.5');
    expect(hide.className).toContain('bottom-full');
    fireEvent.click(hide);
    expect(onToggleHidden).toHaveBeenCalledWith(true);
  });

  it('leaves nothing but the handle once it is hidden', () => {
    renderHidden();
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hide the tab bar' })).toBeNull();
    for (const item of TABS) expect(screen.queryByText(item.label)).toBeNull();
  });

  it('spans the bottom edge, so the way back is not a target to hunt for', () => {
    const { handle } = renderHidden();
    expect(handle.className).toContain('inset-x-0');
    expect(handle.className).toContain('ac-bar-handle');
  });

  it('comes back on a tap', () => {
    const { onToggleHidden, handle } = renderHidden();
    fireEvent.click(handle);
    expect(onToggleHidden).toHaveBeenCalledWith(false);
  });

  it('comes back on a swipe up, without waiting for the finger to lift', () => {
    const { onToggleHidden, handle } = renderHidden();
    fireEvent.pointerDown(handle, { clientY: 800 });
    fireEvent.pointerMove(handle, { clientY: 800 - SWIPE_SHOW_PX - 1 });
    expect(onToggleHidden).toHaveBeenCalledWith(false);
  });

  it('reads a short drag as a press rather than a swipe', () => {
    const { onToggleHidden, handle } = renderHidden();
    fireEvent.pointerDown(handle, { clientY: 800 });
    fireEvent.pointerMove(handle, { clientY: 800 - SWIPE_SHOW_PX + 1 });
    expect(onToggleHidden).not.toHaveBeenCalled();
  });

  it('ignores a drag that never started on the handle', () => {
    const { onToggleHidden, handle } = renderHidden();
    fireEvent.pointerMove(handle, { clientY: 100 });
    expect(onToggleHidden).not.toHaveBeenCalled();
  });

  it('does not fire twice while the finger keeps moving', () => {
    const { onToggleHidden, handle } = renderHidden();
    fireEvent.pointerDown(handle, { clientY: 800 });
    fireEvent.pointerMove(handle, { clientY: 700 });
    fireEvent.pointerMove(handle, { clientY: 600 });
    expect(onToggleHidden).toHaveBeenCalledTimes(1);
  });
});
