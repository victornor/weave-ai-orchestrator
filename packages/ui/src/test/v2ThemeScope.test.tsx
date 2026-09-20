/**
 * VS-623: a portalled surface (Sheet/Drawer) sits outside `.v2-root`, so it must mirror the active
 * theme or it silently falls back to the document's dark tokens. This is the regression test for the
 * light-theme modal finding.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Sheet } from '../components/Sheet';

describe('portalled surfaces mirror the v2 theme (VS-623)', () => {
  let root: HTMLDivElement | null = null;
  afterEach(() => {
    root?.remove();
    root = null;
  });

  function v2Root(theme: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'v2-root';
    el.setAttribute('data-theme', theme);
    document.body.appendChild(el);
    return el;
  }

  it('a light v2 root makes the Sheet portal light, not the document default', () => {
    root = v2Root('light');
    render(
      <Sheet open onClose={() => undefined} title="A sheet">
        <p>body</p>
      </Sheet>,
    );
    const wrapper = screen.getByRole('dialog').closest('.ac-viewport');
    expect(wrapper?.getAttribute('data-theme')).toBe('light');
  });

  it('leaves the portal unthemed when there is no v2 root', () => {
    render(
      <Sheet open onClose={() => undefined} title="A sheet">
        <p>body</p>
      </Sheet>,
    );
    const wrapper = screen.getByRole('dialog').closest('.ac-viewport');
    expect(wrapper?.hasAttribute('data-theme')).toBe(false);
  });
});
