import { describe, expect, it } from 'vitest';
import { buildChangeTree, filterChangeFiles, visibleChangeFiles, type ChangeFolder, type ChangeFile } from './changeTree';
import type { DiffFileSummary } from '../api/types';

function file(path: string, over: Partial<DiffFileSummary> = {}): DiffFileSummary {
  return { path, previousPath: null, status: 'modified', additions: 1, deletions: 1, binary: false, tooLarge: false, ...over };
}

function folder(node: ChangeFile | ChangeFolder): ChangeFolder {
  if (node.kind !== 'folder') throw new Error(`${node.path} is a file`);
  return node;
}

describe('buildChangeTree', () => {
  it('nests a path two folders deep and puts the file at its leaf', () => {
    const tree = buildChangeTree([file('packages/ui/src/v2/Change.tsx')]);
    const packages = folder(tree[0]!);
    expect(packages.name).toBe('packages');
    const ui = folder(packages.children[0]!);
    expect(ui.name).toBe('ui');
    const src = folder(ui.children[0]!);
    const v2 = folder(src.children[0]!);
    expect(v2.children.map((n) => n.name)).toEqual(['Change.tsx']);
  });

  it('sums a folder\'s additions and deletions from every file below it', () => {
    const tree = buildChangeTree([
      file('src/a.ts', { additions: 3, deletions: 1 }),
      file('src/nested/b.ts', { additions: 5, deletions: 2 }),
      file('docs/c.md', { additions: 1, deletions: 9 }),
    ]);
    const src = folder(tree.find((n) => n.name === 'src')!);
    expect(src.additions).toBe(8);
    expect(src.deletions).toBe(3);
    const nested = folder(src.children.find((n) => n.name === 'nested')!);
    expect(nested.additions).toBe(5);
    const docs = folder(tree.find((n) => n.name === 'docs')!);
    expect(docs.deletions).toBe(9);
  });

  it('orders folders before files and each alphabetically', () => {
    const tree = buildChangeTree([file('src/zebra.ts'), file('src/alpha.ts'), file('README.md'), file('docs/x.md')]);
    expect(tree.map((n) => n.name)).toEqual(['docs', 'src', 'README.md']);
    const src = folder(tree.find((n) => n.name === 'src')!);
    expect(src.children.map((n) => n.name)).toEqual(['alpha.ts', 'zebra.ts']);
  });

  it('groups two files sharing a folder into one folder node', () => {
    const tree = buildChangeTree([file('src/a.ts'), file('src/b.ts')]);
    expect(tree.filter((n) => n.kind === 'folder')).toHaveLength(1);
    expect(folder(tree[0]!).children).toHaveLength(2);
  });

  it('keeps a renamed file identifiable by both paths', () => {
    const tree = buildChangeTree([file('src/new.ts', { previousPath: 'src/old.ts', status: 'renamed' })]);
    const src = folder(tree[0]!);
    const leaf = src.children[0] as ChangeFile;
    expect(leaf.file.previousPath).toBe('src/old.ts');
    expect(leaf.file.status).toBe('renamed');
  });
});

describe('filterChangeFiles', () => {
  it('matches a path substring, case-insensitively', () => {
    const files = [file('src/Alpha.ts'), file('docs/beta.md')];
    expect(filterChangeFiles(files, 'alpha').map((f) => f.path)).toEqual(['src/Alpha.ts']);
  });

  it('matches a rename by its old path too', () => {
    const files = [file('src/new.ts', { previousPath: 'src/legacy.ts' })];
    expect(filterChangeFiles(files, 'legacy')).toHaveLength(1);
  });

  it('returns every file for an empty query', () => {
    const files = [file('a.ts'), file('b.ts')];
    expect(filterChangeFiles(files, '   ')).toHaveLength(2);
  });
});

describe('visibleChangeFiles', () => {
  const tree = buildChangeTree([file('src/a.ts'), file('src/nested/b.ts')]);

  it('lists every file when nothing is collapsed', () => {
    expect(visibleChangeFiles(tree, new Set()).map((f) => f.path)).toEqual(['src/nested/b.ts', 'src/a.ts']);
  });

  it('hides a collapsed folder\'s whole subtree', () => {
    expect(visibleChangeFiles(tree, new Set(['src'])).map((f) => f.path)).toEqual([]);
  });

  it('hides only the collapsed folder\'s descendants, not its siblings', () => {
    const withSibling = buildChangeTree([file('src/a.ts'), file('docs/c.md')]);
    expect(visibleChangeFiles(withSibling, new Set(['src'])).map((f) => f.path)).toEqual(['docs/c.md']);
  });
});