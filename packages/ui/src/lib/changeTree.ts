/**
 * The V2 change explorer's file tree (VS-452): a pure grouping of a pull request's changed-file
 * manifest into collapsible folders that carry their own +N/–N, so the tree component only renders.
 *
 * `buildChangeTree` is the whole model — the component adds no grouping, counting or ordering of its
 * own — which is what makes it testable without a DOM.
 */
import type { DiffFileSummary } from '../api/types';

export interface ChangeFolder {
  kind: 'folder';
  /** The last path segment, shown on the row. */
  name: string;
  /** The full path from the root, the folder's stable identity. */
  path: string;
  additions: number;
  deletions: number;
  children: ChangeNode[];
}

export interface ChangeFile {
  kind: 'file';
  /** The file's own name (its path's last segment). */
  name: string;
  path: string;
  file: DiffFileSummary;
}

export type ChangeNode = ChangeFolder | ChangeFile;

/** Kept in the tree builder so every level sorts the same way: folders before files, each by name. */
function byDirThenName(a: ChangeNode, b: ChangeNode): number {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
  return a.name.localeCompare(b.name);
}

interface Dir {
  folders: Map<string, Dir>;
  files: ChangeFile[];
}

function emptyDir(): Dir {
  return { folders: new Map(), files: [] };
}

function toNodes(dir: Dir, parentPath: string): { nodes: ChangeNode[]; additions: number; deletions: number } {
  const folders: ChangeFolder[] = [...dir.folders.entries()].map(([name, sub]) => {
    const path = parentPath ? `${parentPath}/${name}` : name;
    const { nodes, additions, deletions } = toNodes(sub, path);
    return { kind: 'folder', name, path, additions, deletions, children: nodes };
  });
  const files = [...dir.files].sort(byDirThenName);
  const nodes: ChangeNode[] = [...folders, ...files].sort(byDirThenName);
  const additions = folders.reduce((n, f) => n + f.additions, 0) + files.reduce((n, f) => n + f.file.additions, 0);
  const deletions = folders.reduce((n, f) => n + f.deletions, 0) + files.reduce((n, f) => n + f.file.deletions, 0);
  return { nodes, additions, deletions };
}

/** Every changed file, nested into folders, with each folder's additions/deletions summed from below. */
export function buildChangeTree(files: readonly DiffFileSummary[]): ChangeNode[] {
  const root = emptyDir();
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    const name = parts.pop() ?? file.path;
    let dir = root;
    for (const segment of parts) {
      let next = dir.folders.get(segment);
      if (!next) { next = emptyDir(); dir.folders.set(segment, next); }
      dir = next;
    }
    dir.files.push({ kind: 'file', name, path: file.path, file });
  }
  return toNodes(root, '').nodes;
}

/** The manifest, narrowed to paths (or previous paths, so a rename is findable by either) matching `query`. */
export function filterChangeFiles(files: readonly DiffFileSummary[], query: string): DiffFileSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...files];
  return files.filter((f) => f.path.toLowerCase().includes(q) || (f.previousPath?.toLowerCase().includes(q) ?? false));
}

/**
 * The files the tree currently shows, in render order — a collapsed folder hides its whole subtree.
 * This is the keyboard's list: up/down step through exactly what is on screen.
 */
export function visibleChangeFiles(nodes: readonly ChangeNode[], collapsed: ReadonlySet<string>): ChangeFile[] {
  const out: ChangeFile[] = [];
  const walk = (list: readonly ChangeNode[]): void => {
    for (const node of list) {
      if (node.kind === 'file') { out.push(node); continue; }
      if (collapsed.has(node.path)) continue;
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}