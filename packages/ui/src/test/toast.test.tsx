/**
 * `ToastProvider` mounts once at the app root, above the router (VS-367): its toast container is a
 * DOM sibling of `.v2-root`, not a descendant, so it never inherited V2's Mono tokens or its active
 * `data-theme`. These assert the structural fix — the container mirrors whichever `.v2-root` is
 * currently mounted, live, and leaves V1 (no `.v2-root` in the document) untouched.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ToastProvider, useToast } from '../components/Toast';

function Pusher(): React.ReactElement {
  const { push } = useToast();
  return (
    <button type="button" onClick={() => push({ title: 'Saved' })}>
      push
    </button>
  );
}

async function renderWithToast(): Promise<void> {
  render(
    <ToastProvider>
      <Pusher />
    </ToastProvider>,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'push' }));
  });
}

function toastContainer(): HTMLElement {
  return screen.getByText('Saved').closest('[aria-live="polite"]') as HTMLElement;
}

/** A fake `.v2-root` mounted directly on `document.body`, standing in for the real V2 route tree —
 *  tracked and removed by identity, never by `.v2-root` selector: the toast container mirrors that
 *  same class once fixed, and a selector-based sweep would catch it too. */
const mountedRoots: HTMLElement[] = [];
function mountV2Root(theme: 'dark' | 'light'): HTMLElement {
  const el = document.createElement('div');
  el.className = 'v2-root';
  el.setAttribute('data-theme', theme);
  document.body.appendChild(el);
  mountedRoots.push(el);
  return el;
}

afterEach(() => {
  mountedRoots.splice(0).forEach((el) => el.remove());
});

describe('the shared toast container under V1 (no .v2-root mounted)', () => {
  it('carries neither the v2-root class nor a data-theme attribute', async () => {
    await renderWithToast();
    const container = toastContainer();
    expect(container.classList.contains('v2-root')).toBe(false);
    expect(container.getAttribute('data-theme')).toBeNull();
  });
});

describe('the shared toast container under V2', () => {
  it('mirrors the mounted .v2-root\'s class and theme, and stays transparent itself', async () => {
    mountV2Root('light');

    await renderWithToast();
    const container = toastContainer();
    expect(container.classList.contains('v2-root')).toBe(true);
    expect(container.getAttribute('data-theme')).toBe('light');
    expect(container.style.background).toBe('transparent');
  });

  it('follows a live theme change on the mounted .v2-root', async () => {
    const v2root = mountV2Root('dark');

    await renderWithToast();
    expect(toastContainer().getAttribute('data-theme')).toBe('dark');

    await act(async () => {
      v2root.setAttribute('data-theme', 'light');
      // MutationObserver callbacks run as a microtask.
      await Promise.resolve();
    });
    expect(toastContainer().getAttribute('data-theme')).toBe('light');
  });

  it('drops the class and attribute once .v2-root unmounts (back to V1)', async () => {
    const v2root = mountV2Root('light');

    await renderWithToast();
    expect(toastContainer().classList.contains('v2-root')).toBe(true);

    await act(async () => {
      v2root.remove();
      await Promise.resolve();
    });
    expect(toastContainer().classList.contains('v2-root')).toBe(false);
    expect(toastContainer().getAttribute('data-theme')).toBeNull();
  });
});
