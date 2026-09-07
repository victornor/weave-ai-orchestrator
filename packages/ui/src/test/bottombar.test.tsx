import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { BAR, fabRect, intersects, rem, tabRects } from '../app/barGeometry';
import type { Rect } from '../app/barGeometry';
import { BottomBar } from '../app/BottomBar';
import { TABS } from '../app/nav';

vi.mock('../app/link', () => ({
  A: ({ to, children, className }: { to: string; children?: ReactNode; className?: string }) => (
    <a href={to} className={className}>{children}</a>
  ),
}));

/** Phone widths the design contract draws (390px frame) and the narrow ends. */
const PHONE_WIDTHS = [320, 360, 375, 390, 430];

describe('bottom bar geometry', () => {
  it('keeps the Start Work button clear of every tab at phone widths', () => {
    for (const width of PHONE_WIDTHS) {
      const fab = fabRect(width);
      for (const tab of tabRects(width, TABS.length)) {
        expect({ width, hit: intersects(fab, tab) }).toEqual({ width, hit: false });
      }
    }
  });

  it('leaves every tab a thumb-sized target', () => {
    for (const width of PHONE_WIDTHS) {
      for (const tab of tabRects(width, TABS.length)) {
        expect(tab.w).toBeGreaterThanOrEqual(44);
        expect(tab.h).toBeGreaterThanOrEqual(44);
      }
    }
  });

  it('sinks the button no further than the tab row starts', () => {
    expect(BAR.fabTop + BAR.fabSize).toBeLessThanOrEqual(BAR.tabTop);
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
    render(<BottomBar ws="ws1" items={TABS} needsCount={2} isActive={(to) => to.endsWith('/chat')} onStartWork={vi.fn()} onMore={vi.fn()} />);
  }

  it('renders every tab plus the floating Start Work', () => {
    renderBar();
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    // Four tabs navigate; More opens the menu, so it is a button rather than a link.
    expect(within(nav).getAllByRole('link')).toHaveLength(TABS.length - 1);
    for (const item of TABS) expect(within(nav).getByText(item.label)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start work' })).toBeInTheDocument();
  });

  it('opens the More menu instead of navigating to Settings', () => {
    const onMore = vi.fn();
    render(<BottomBar ws="ws1" items={TABS} needsCount={0} isActive={() => false} onStartWork={vi.fn()} onMore={onMore} />);
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    const more = within(nav).getByText('More').closest('button') as HTMLButtonElement;
    expect(more).toHaveAttribute('aria-haspopup', 'dialog');
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(within(nav).queryByRole('link', { name: /More/ })).toBeNull();
    fireEvent.click(more);
    expect(onMore).toHaveBeenCalled();
  });

  it('reports the menu as expanded while it is open', () => {
    render(<BottomBar ws="ws1" items={TABS} needsCount={0} isActive={() => false} onStartWork={vi.fn()} onMore={vi.fn()} moreOpen />);
    expect(screen.getByText('More').closest('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('marks More active on a page the menu leads to', () => {
    render(
      <BottomBar ws="ws1" items={TABS} needsCount={0} isActive={(to) => to === '/w/ws1/usage'} onStartWork={vi.fn()} onMore={vi.fn()} moreOpen={false} />,
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
      <BottomBar ws="ws1" items={TABS} needsCount={0} otherWorkspacesNeed={3} isActive={() => false} onStartWork={vi.fn()} onMore={vi.fn()} />,
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
        onStartWork={vi.fn()}
        onMore={vi.fn()}
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
        onStartWork={vi.fn()}
        onMore={vi.fn()}
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

  it('positions the button so it intersects no tab at 390px', () => {
    renderBar();
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    const button = screen.getByRole('button', { name: 'Start work' });
    const width = 390;

    const size = remStyle(button.style.width);
    expect(remStyle(button.style.height)).toBe(size);
    const fab: Rect = { x: width / 2 - size / 2, y: remStyle(button.style.top), w: size, h: size };

    const top = remStyle(nav.style.paddingTop);
    const tabs = tabRects(width, TABS.length, { ...BAR, tabTop: top / 16, fabSize: size / 16 });

    for (const tab of tabs) expect(intersects(fab, tab)).toBe(false);
  });
});
