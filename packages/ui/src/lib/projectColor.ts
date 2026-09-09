/**
 * A project's colour is a pure function of its id: FNV-1a folded into a fixed
 * palette of CSS custom properties (VS-149). Same id, same colour, no storage.
 */

export const PALETTE = [
  'var(--project-1)',
  'var(--project-2)',
  'var(--project-3)',
  'var(--project-4)',
  'var(--project-5)',
] as const;

function hashOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function projectColorVar(id: string): string {
  return PALETTE[hashOf(id) % PALETTE.length]!;
}
