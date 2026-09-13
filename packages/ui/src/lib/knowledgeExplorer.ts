/**
 * Pure tree-building for the knowledge base explorer (VS-265): turns the flat document catalogue
 * and hub file list `useKnowledgeDocs`/`useKnowledgeIndex` already fetch into a folder tree, with
 * hub files as a distinguished node rather than a folder. No network or DOM code here — the
 * component wraps this with fetching, expand/collapse state and click handlers.
 */
import type { KnowledgeDocSummary } from '../api/types';

export interface ExplorerHub { scope: string; projectId: string | null; projectSlug: string | null }

export interface ExplorerNode {
  id: string;
  kind: 'root' | 'folder' | 'hub' | 'doc';
  label: string;
  children: ExplorerNode[];
  doc?: KnowledgeDocSummary;
  hub?: { scope: string; project?: string };
}

/** A selected document as carried by the explorer's `?doc=` parameter. */
export interface ExplorerDocRef {
  scope: string;
  slug: string;
  project?: string;
}

const DOC_SCOPES = new Set(['project', 'shared', 'workspace']);

/** `<scope>:<slug>` — the project id travels in `?project=`, not in the parameter. */
export function serializeDocParam(ref: { scope: string; slug: string }): string {
  return `${ref.scope}:${ref.slug}`;
}

/** Parse `?doc=`. Returns null for anything that is not a known scope plus a non-empty slug. */
export function parseDocParam(param: string | undefined, projectId?: string): ExplorerDocRef | null {
  if (!param) return null;
  const i = param.indexOf(':');
  if (i <= 0) return null;
  const scope = param.slice(0, i);
  const slug = param.slice(i + 1);
  if (!DOC_SCOPES.has(scope) || !slug || slug.includes(':')) return null;
  return { scope, slug, ...(scope === 'project' && projectId ? { project: projectId } : {}) };
}

/** The tree pane's share of the split, clamped so a drag can never collapse either pane. */
export const TREE_WIDTH_DEFAULT = 20;
export const TREE_WIDTH_MIN = 15;
export const TREE_WIDTH_MAX = 40;

export function clampTreeWidth(pct: number): number {
  if (!Number.isFinite(pct)) return TREE_WIDTH_DEFAULT;
  return Math.min(TREE_WIDTH_MAX, Math.max(TREE_WIDTH_MIN, pct));
}

export function hubFileName(scope: string): string {
  switch (scope) {
    case 'project': return 'PROJECT.md';
    case 'shared': return 'SHARED.md';
    case 'decisions': return 'decisions.md';
    default: return 'WORKSPACE.md';
  }
}

function rootKeyOf(scope: string, projectSlug: string | null): string {
  return scope === 'project' ? `project:${projectSlug ?? ''}` : `scope:${scope}`;
}

function rootLabelOf(scope: string, projectSlug: string | null, labelOfProject?: (projectSlug: string | null) => string | null): string {
  if (scope !== 'project') return scope;
  return labelOfProject?.(projectSlug) ?? projectSlug ?? 'project';
}

const RANK: Record<ExplorerNode['kind'], number> = { root: 0, hub: 0, folder: 1, doc: 2 };

function sortChildren(node: ExplorerNode): void {
  node.children.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.label.localeCompare(b.label));
  for (const c of node.children) sortChildren(c);
}

/**
 * One root per (scope, project) pair present in `hubs` or `docs` — a project's own tree, plus
 * `shared`/`workspace`/`decisions`. Each root holds its hub as a distinguished first child, then
 * the document folder tree derived from `KnowledgeDocSummary.folder`.
 */
export function buildExplorerTree(docs: readonly KnowledgeDocSummary[], hubs: readonly ExplorerHub[], labelOfProject?: (projectSlug: string | null) => string | null): ExplorerNode[] {
  const roots = new Map<string, ExplorerNode>();
  const ensureRoot = (scope: string, projectSlug: string | null): ExplorerNode => {
    const id = rootKeyOf(scope, projectSlug);
    let root = roots.get(id);
    if (!root) {
      root = { id, kind: 'root', label: rootLabelOf(scope, projectSlug, labelOfProject), children: [] };
      roots.set(id, root);
    }
    return root;
  };

  for (const h of hubs) {
    const root = ensureRoot(h.scope, h.projectSlug);
    root.children.push({
      id: `${root.id}#hub`, kind: 'hub', label: hubFileName(h.scope), children: [],
      hub: { scope: h.scope, ...(h.projectId ? { project: h.projectId } : {}) },
    });
  }

  for (const d of docs) {
    const root = ensureRoot(d.scope, d.projectSlug);
    let cursor = root;
    if (d.folder) {
      for (const segment of d.folder.split('/')) {
        const id = `${cursor.id}/${segment}`;
        let folder = cursor.children.find((c) => c.kind === 'folder' && c.id === id);
        if (!folder) {
          folder = { id, kind: 'folder', label: segment, children: [] };
          cursor.children.push(folder);
        }
        cursor = folder;
      }
    }
    cursor.children.push({ id: `doc:${d.path}`, kind: 'doc', label: d.title || d.slug, children: [], doc: d });
  }

  const list = [...roots.values()];
  for (const r of list) sortChildren(r);
  list.sort((a, b) => a.label.localeCompare(b.label));
  return list;
}
