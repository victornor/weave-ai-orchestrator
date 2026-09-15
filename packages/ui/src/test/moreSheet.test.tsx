/** The phone's More menu: what it lists, where each item goes, and how it is dismissed. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MORE_ITEMS, RAIL, TABS, href } from '../app/nav';
import { SWIPE_CLOSE_PX } from '../components/Sheet';
import type { WorkspaceListItem } from '../api/types';
import { project } from './factories';

vi.mock('../app/link', () => ({
  A: ({ to, params, search, children, onClick, ...rest }: {
    to: string;
    params?: Record<string, string>;
    search?: Record<string, unknown>;
    onClick?: () => void;
    children?: ReactNode;
  }) => (
    <a
      href={Object.entries(params ?? {}).reduce((acc, [k, v]) => acc.replace(`$${k}`, v), to)}
      data-search={search ? JSON.stringify(search) : undefined}
      onClick={(e) => {
        // jsdom cannot navigate, and the assertion is the handler, not the hop.
        e.preventDefault();
        onClick?.();
      }}
      {...rest}
    >
      {children}
    </a>
  ),
}));

const { MoreSheet } = await import('../app/MoreSheet');

const listItem = (over: Partial<WorkspaceListItem> = {}): WorkspaceListItem => ({
  id: 'ws1', internalId: 'ulid-ws1', name: 'Acme', ticketPrefix: 'ACME', root: '/tmp/ws1', projects: [], needsYou: 0, ...over,
});

const onClose = vi.fn();
const onNewWorkspace = vi.fn();

function open(over: Partial<React.ComponentProps<typeof MoreSheet>> = {}): void {
  render(
    <MoreSheet
      open
      onClose={onClose}
      ws="ws1"
      activeWs="ws1"
      workspaces={[listItem()]}
      projects={[]}
      needsCount={0}
      isActive={() => false}
      onNewWorkspace={onNewWorkspace}
      {...over}
    />,
  );
}

const sheet = (): HTMLElement => screen.getByRole('dialog', { name: 'More' });

beforeEach(() => {
  onClose.mockClear();
  onNewWorkspace.mockClear();
});

describe('what the More menu lists', () => {
  it('carries every destination the bottom bar leaves out', () => {
    const tabKeys = new Set(TABS.map((t) => t.key));
    const missing = RAIL.filter((r) => !tabKeys.has(r.key)).filter((r) => !MORE_ITEMS.some((m) => m.key === r.key));
    expect(missing.map((r) => r.key)).toEqual([]);
    expect(MORE_ITEMS.map((m) => m.key)).toContain('merge-queue');
    expect(MORE_ITEMS.map((m) => m.key)).toContain('live');
    expect(TABS).toHaveLength(5);
  });

  it('shows nothing while it is closed', () => {
    render(
      <MoreSheet
        open={false}
        onClose={onClose}
        ws="ws1"
        activeWs="ws1"
        workspaces={[listItem()]}
        projects={[]}
        needsCount={0}
        isActive={() => false}
        onNewWorkspace={onNewWorkspace}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('gives each destination a named link to that section of this workspace', () => {
    open();
    const nav = within(sheet()).getByRole('navigation', { name: 'More sections' });
    for (const item of MORE_ITEMS) {
      expect(within(nav).getByRole('link', { name: new RegExp(item.label) })).toHaveAttribute('href', href(item, 'ws1'));
    }
    expect(within(nav).getAllByRole('link')).toHaveLength(MORE_ITEMS.length);
  });

  it('lists Global Needs you, Live, Chats, Incidents, Map, Scheduled and the daemon Settings above the per-workspace leftovers', () => {
    open();
    const global = within(sheet()).getByRole('navigation', { name: 'Global' });
    expect(within(global).getByRole('link', { name: /Needs you/ })).toHaveAttribute('href', '/needs');
    expect(within(global).getByRole('link', { name: /^Live/ })).toHaveAttribute('href', '/live');
    expect(within(global).getByRole('link', { name: /Chats/ })).toHaveAttribute('href', '/chats');
    expect(within(global).getByRole('link', { name: /Incidents/ })).toHaveAttribute('href', '/incidents');
    expect(within(global).getByRole('link', { name: /Map/ })).toHaveAttribute('href', '/map');
    expect(within(global).getByRole('link', { name: /Scheduled/ })).toHaveAttribute('href', '/scheduled');
    // The daemon's settings have their own address above the workspaces (VS-230).
    expect(within(global).getByRole('link', { name: /Settings/ })).toHaveAttribute('href', '/settings');
  });

  it('marks the destination the app is already showing', () => {
    open({ isActive: (to) => to === '/w/ws1/runs' });
    const nav = within(sheet()).getByRole('navigation', { name: 'More sections' });
    expect(within(nav).getByRole('link', { name: /Runs/ })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: /Usage/ })).not.toHaveAttribute('aria-current');
  });

  it('lists the workspaces with their counts and links to each one', () => {
    open({
      workspaces: [listItem({ needsYou: 9 }), listItem({ id: 'beta', name: 'Beta', ticketPrefix: 'BET', needsYou: 4 })],
      needsCount: 2,
    });
    const list = within(sheet()).getByRole('region', { name: 'Workspaces' });
    // The live count for the workspace being shown; the listed one for the others.
    expect(within(list).getByLabelText('2 waiting for you')).toBeInTheDocument();
    expect(within(list).getByLabelText('4 waiting for you')).toBeInTheDocument();
    expect(within(list).queryByLabelText('9 waiting for you')).toBeNull();
    expect(within(list).getByRole('link', { name: /Beta/ })).toHaveAttribute('href', '/w/beta/needs');
    expect(within(list).getByText('current')).toBeInTheDocument();
  });

  it('offers the new-workspace action', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    expect(onNewWorkspace).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('names the daemon update and opens the Updates section of the daemon settings', () => {
    open({ update: { state: 'available', title: 'Update available', detail: 'main · bbbbbbbbbb' } });
    const entry = within(sheet()).getByLabelText('Daemon update available');
    expect(entry).toHaveTextContent('Update available');
    expect(entry).toHaveAttribute('href', '/settings');
    expect(JSON.parse(entry.getAttribute('data-search') ?? '{}')).toEqual({ section: 'updates' });
  });

  it('says nothing about the daemon when there is nothing to say', () => {
    open();
    expect(screen.queryByLabelText('Daemon update available')).toBeNull();
    expect(screen.queryByLabelText('Daemon upgrade in progress')).toBeNull();
  });

});

describe('dismissing the More menu', () => {
  it('closes when a destination is chosen', () => {
    open();
    fireEvent.click(screen.getByRole('link', { name: /Merge queue/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when another workspace is chosen', () => {
    open({ workspaces: [listItem(), listItem({ id: 'beta', name: 'Beta' })] });
    fireEvent.click(screen.getByRole('link', { name: /Beta/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on a tap outside', () => {
    open();
    fireEvent.click(sheet().previousElementSibling as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when the grab handle is swiped down past the threshold', () => {
    open();
    const handle = screen.getByTestId('sheet-grab');
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 100 + SWIPE_CLOSE_PX + 10 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(onClose).toHaveBeenCalled();
  });

  it('stays open when the swipe is a short one, and springs back', () => {
    open();
    const handle = screen.getByTestId('sheet-grab');
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 100 + SWIPE_CLOSE_PX - 20 });
    expect(sheet().style.transform).toBe(`translateY(${SWIPE_CLOSE_PX - 20}px)`);
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(onClose).not.toHaveBeenCalled();
    expect(sheet().style.transform).toBe('');
  });
});

describe('reaching the More menu with a keyboard', () => {
  it('puts the focus in the sheet when it opens', () => {
    open();
    expect(sheet().contains(document.activeElement)).toBe(true);
  });

  it('keeps Tab inside the sheet', () => {
    open();
    const focusable = [...sheet().querySelectorAll<HTMLElement>('a[href],button:not([disabled])')];
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});

/**
 * VS-95: the sidebar is desktop-only, so without this the project overview would be unreachable on a
 * phone. Projects are not a rail destination, so `MORE_ITEMS` is deliberately untouched — the
 * assertion above still pins it against `RAIL` and `TABS`.
 */
describe('the projects block', () => {
  const web = project({ id: 'p1', slug: 'web', defaultBranch: 'main' });

  it('lists the active workspace"s projects, each opening its overview', () => {
    open({ projects: [web] });
    const block = within(sheet()).getByRole('region', { name: 'Projects' });
    // The mock substitutes `$param` into the path, so the href is the address the human lands on.
    expect(within(block).getByText('web').closest('a')?.getAttribute('href')).toBe('/w/ws1/p/web');
  });

  it('dismisses the menu when a project is chosen', () => {
    open({ projects: [web] });
    fireEvent.click(within(sheet()).getByText('web'));
    expect(onClose).toHaveBeenCalled();
  });

  it('still offers New project when the workspace has no projects', () => {
    open({ projects: [] });
    const block = within(sheet()).getByRole('region', { name: 'Projects' });
    expect(within(block).queryByText('web')).toBeNull();
    const link = within(block).getByRole('link', { name: 'New project' });
    expect(link).toHaveAttribute('href', '/w/ws1/settings');
    expect(JSON.parse(link.getAttribute('data-search') ?? '{}')).toEqual({ section: 'projects' });
  });

  it('puts New project under the listed projects', () => {
    open({ projects: [web] });
    const block = within(sheet()).getByRole('region', { name: 'Projects' });
    expect(within(block).getByText('web')).toBeInTheDocument();
    expect(within(block).getByRole('link', { name: 'New project' })).toBeInTheDocument();
  });

  it('dismisses the menu and addresses Settings Projects when New project is chosen', () => {
    open({ projects: [web] });
    const link = within(sheet()).getByRole('link', { name: 'New project' });
    expect(link).toHaveAttribute('href', '/w/ws1/settings');
    expect(JSON.parse(link.getAttribute('data-search') ?? '{}')).toEqual({ section: 'projects' });
    fireEvent.click(link);
    expect(onClose).toHaveBeenCalled();
  });
});
