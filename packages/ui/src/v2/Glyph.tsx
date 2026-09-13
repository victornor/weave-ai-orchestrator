import type { CSSProperties } from 'react';
import { V2_GLYPH_STYLE, type V2GlyphName } from './nav';

/** One of the rail's marks (HANDOFF §4). Sized in `nav.ts`, drawn in `currentColor`. */
export function V2Glyph({ name, style }: { name: V2GlyphName; style?: CSSProperties }): React.ReactElement {
  return <span aria-hidden data-v2-glyph={name} style={{ ...V2_GLYPH_STYLE[name], flex: 'none', ...style }} />;
}
