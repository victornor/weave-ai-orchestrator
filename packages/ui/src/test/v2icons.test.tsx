/** VS-420: every V2 navigation glyph is one Lucide icon, and each destination renders its mapped one. */
import { cleanup, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { V2Glyph, V2_ICONS } from '../v2/Glyph';
import { V2_EVERYWHERE, V2_KEPT, V2_WORKSPACE, type V2GlyphName } from '../v2/nav';

/** The icon each glyph must render, named the way Lucide's own class names it. */
const EXPECTED: Record<V2GlyphName, string> = {
  chat: 'message-square',
  chats: 'messages-square',
  needs: 'inbox',
  live: 'activity',
  work: 'kanban',
  roles: 'users',
  knowledge: 'book-open',
  runs: 'list',
  scheduled: 'clock',
  incidents: 'triangle-alert',
  map: 'map',
  settings: 'settings',
  plugin: 'plug',
  more: 'ellipsis',
  update: 'circle-arrow-up',
};

function assertGlyph(name: V2GlyphName): void {
  const { container } = render(<V2Glyph name={name} />);
  const svg = container.querySelector(`svg[data-v2-glyph="${name}"]`);
  expect(svg, `${name} must render a glyph`).not.toBeNull();
  // Lucide puts its own icon name in the class list, so this asserts the mapped icon, not just an SVG.
  expect(svg!.classList.contains(`lucide-${EXPECTED[name]}`), `${name} must be Lucide ${EXPECTED[name]}`).toBe(true);
  cleanup();
}

describe('V2 navigation icons are Lucide (VS-420)', () => {
  it('renders every registry destination with its mapped Lucide icon', () => {
    const destinations = [...V2_EVERYWHERE, ...V2_WORKSPACE, ...V2_KEPT];
    for (const dest of destinations) assertGlyph(dest.glyph);
  });

  it('covers every glyph in the map, including the ones no registry row lists', () => {
    expect(Object.keys(V2_ICONS).sort()).toEqual(Object.keys(EXPECTED).sort());
    assertGlyph('plugin');
    assertGlyph('more');
  });

  it('draws only vector glyphs, never a hand-made span', () => {
    const { container } = render(<V2Glyph name="work" />);
    expect(container.querySelector('svg[data-v2-glyph="work"]')).not.toBeNull();
    expect(container.querySelector('span[data-v2-glyph]')).toBeNull();
  });
});
