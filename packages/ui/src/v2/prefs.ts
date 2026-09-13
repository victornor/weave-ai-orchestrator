/**
 * The device-remembered V2 rail state. Kept out of V1's `wsExpansion`/`barVisibility` so the two
 * versions never read each other's storage.
 */
const KEY = 'weave.v2.rail';

export function readRailCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === 'collapsed';
  } catch {
    return false;
  }
}

export function writeRailCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(KEY, collapsed ? 'collapsed' : 'expanded');
  } catch {
    /* private mode */
  }
}
