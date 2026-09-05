import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
    render(<BottomBar ws="ws1" items={TABS} needsCount={2} isActive={(to) => to.endsWith('/chat')} onStartWork={vi.fn()} />);
  }

  it('renders every tab plus the floating Start Work', () => {
    renderBar();
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    expect(within(nav).getAllByRole('link')).toHaveLength(TABS.length);
    for (const item of TABS) expect(within(nav).getByText(item.label)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start work' })).toBeInTheDocument();
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
