import type { CSSProperties } from 'react';
import {
  Activity,
  BookOpen,
  CircleArrowUp,
  Clock,
  Ellipsis,
  Inbox,
  Kanban,
  List,
  Map as MapIcon,
  MessageSquare,
  MessagesSquare,
  Plug,
  Settings,
  TriangleAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { V2GlyphName } from './nav';

/**
 * The one icon set for V2 navigation (VS-420): Lucide, a uniform 24px grid with a single stroke, so
 * every mark is drawn by the same hand and no destination carries a hand-made shape. One destination
 * maps to one icon here, and the expanded rail, collapsed rail, phone tab bar and More list all read
 * this map through `V2Glyph`, so they cannot drift apart.
 */
export const V2_ICONS: Record<V2GlyphName, LucideIcon> = {
  chat: MessageSquare,
  chats: MessagesSquare,
  needs: Inbox,
  live: Activity,
  work: Kanban,
  roles: Users,
  knowledge: BookOpen,
  runs: List,
  scheduled: Clock,
  incidents: TriangleAlert,
  map: MapIcon,
  settings: Settings,
  plugin: Plug,
  more: Ellipsis,
  update: CircleArrowUp,
};

/** One size and one stroke for every V2 nav mark, so icons line up with their labels. */
export const V2_ICON_SIZE = 15;
export const V2_ICON_STROKE = 1.75;

/**
 * One of the rail's marks. A vector Lucide glyph in `currentColor`, so the row's active, hover and
 * muted text colours and both themes apply with no per-state icon CSS.
 */
export function V2Glyph({ name, style }: { name: V2GlyphName; style?: CSSProperties }): React.ReactElement {
  const Icon = V2_ICONS[name];
  return (
    <Icon
      aria-hidden
      data-v2-glyph={name}
      size={V2_ICON_SIZE}
      strokeWidth={V2_ICON_STROKE}
      style={{ flex: 'none', ...style }}
    />
  );
}
