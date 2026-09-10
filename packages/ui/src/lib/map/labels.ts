/**
 * Label decluttering for the global Map (VS-192): a priority pass over screen-space bounding
 * boxes, computed from each node's stable (undrifted) radial position and the current zoom only
 * — not per animation frame. See design.md §3.
 */

export interface LabelCandidate {
  id: string;
  /** Screen-space position (graph position already multiplied by the current zoom). */
  x: number;
  y: number;
  text: string;
  /** Lower shows first. Ties keep insertion order (workspace, project, conductor, role, then leaves). */
  priority: number;
}

interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const CHAR_W = 6.2;
const PAD_X = 6;
const LINE_H = 13;
const BASE_FONT = 11;

function boxFor(c: LabelCandidate, fontPx: number): Box {
  const scale = fontPx / BASE_FONT;
  const width = (c.text.length * CHAR_W + PAD_X) * scale;
  const height = LINE_H * scale;
  return { minX: c.x - width / 2, maxX: c.x + width / 2, minY: c.y, maxY: c.y + height };
}

function overlaps(a: Box, b: Box): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

/** The ids whose label should be drawn: highest priority first, skipping anything that would overlap an already-kept box. */
export function declutterLabels(candidates: readonly LabelCandidate[], fontPx = BASE_FONT): ReadonlySet<string> {
  const ordered = [...candidates].sort((a, b) => a.priority - b.priority);
  const kept: Box[] = [];
  const shown = new Set<string>();
  for (const c of ordered) {
    const box = boxFor(c, fontPx);
    if (kept.some((k) => overlaps(k, box))) continue;
    kept.push(box);
    shown.add(c.id);
  }
  return shown;
}
