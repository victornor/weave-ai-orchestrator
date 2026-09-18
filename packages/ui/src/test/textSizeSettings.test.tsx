/** The text-size setting (VS-551): the device ladder, the real-message preview, and the root attribute. */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextSizeSection } from '../settings/sections';
import { readTextSize, writeTextSize } from '../v2/textSize';

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => null,
  useParams: () => ({}),
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
  useNavigate: () => () => {},
  useRouterState: (opts?: { select?: (s: unknown) => unknown }) =>
    opts?.select ? opts.select({ location: { pathname: '/' } }) : '/',
}));

const { V2Root } = await import('../v2/V2Root');

describe('the text-size setting', () => {
  afterEach(() => localStorage.clear());

  it('shows the ladder with the current step marked and a real-message preview', () => {
    const { container } = render(<TextSizeSection />);
    for (const label of ['Smallest', 'Smaller', 'Default', 'Large', 'Largest']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Default' }).getAttribute('aria-pressed')).toBe('true');
    const preview = container.querySelector('[data-text-size-preview]')!;
    // Both directions render through the shared body class: one user bubble, one weaver reply.
    expect(preview.querySelectorAll('.text-body').length).toBe(2);
    expect(preview.textContent).toContain('text-size control under Settings');
  });

  it('writes the chosen step and marks it', () => {
    render(<TextSizeSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Largest' }));
    expect(readTextSize()).toBe('xl');
    expect(screen.getByRole('button', { name: 'Largest' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('publishes the stored size on the app root, so the whole scale follows', () => {
    writeTextSize('lg');
    const { container } = render(<V2Root />);
    expect(container.querySelector('.v2-root')?.getAttribute('data-text-size')).toBe('lg');
  });
});
