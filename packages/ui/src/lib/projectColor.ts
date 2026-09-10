/**
 * A project's colour is a pure function of its id plus the workspace's other
 * project ids: FNV-1a folded into a fixed palette, then uniqueness-aware
 * (VS-149, VS-173). Same (id, sibling set), same colour, no storage.
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

export function projectColorVar(id: string, siblingIds: readonly string[] = []): string {
  const ids = [...new Set([id, ...siblingIds])].sort();
  const k = PALETTE.length;
  const used = Array.from({ length: k }, () => 0);
  for (const sid of ids) {
    const preferred = hashOf(sid) % k;
    let slot = preferred;
    if ((used[preferred] ?? 0) !== 0) {
      const free = used.findIndex((c) => c === 0);
      if (free >= 0) {
        slot = free;
      } else {
        let min = used[0] ?? 0;
        for (let i = 1; i < k; i++) {
          const n = used[i] ?? 0;
          if (n < min) min = n;
        }
        slot = (used[preferred] ?? 0) === min ? preferred : used.indexOf(min);
      }
    }
    if (sid === id) return PALETTE[slot]!;
    used[slot] = (used[slot] ?? 0) + 1;
  }
  return PALETTE[hashOf(id) % k]!;
}
