import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { docFolderOf, docPathFor, docSlugOf, isDocPath, isDuplicateCandidate, isHubSectionPointer, isHubStub, isRedirectStub, mergeEntries, readMirrorFile, repoKnowledgePath, seedBody, similarity } from './files.js';

describe('isHubStub', () => {
  it('treats seed decisions.md as a stub', () => {
    expect(isHubStub(seedBody('decisions'))).toBe(true);
  });

  it('treats headings-only as a stub', () => {
    expect(isHubStub('# Shared conventions\n\n## House rules\n\n## Glossary\n')).toBe(true);
  });

  it('treats SHARED.md with a house-rule bullet as populated', () => {
    expect(isHubStub('# Shared conventions\n\n## House rules\n\n- Commit messages are imperative and scoped.\n')).toBe(false);
  });

  it('ignores fill-in hints and HTML comments', () => {
    expect(isHubStub('# Workspace\n\n<!-- Weaver-only. Budget 3000 tokens. -->\n\n## Portfolio\n\n(one line per project: id — purpose — default role)\n')).toBe(true);
  });
});

describe('VS-501 knowledge health classification', () => {
  it('rejects the real one-word Status boilerplate but keeps a real near-duplicate candidate', () => {
    expect(isDuplicateCandidate('**Status:**')).toBe(false);
    expect(isDuplicateCandidate('The gateway retries idempotent calls twice.')).toBe(true);
  });

  it('recognizes a repeated PROJECT.md document pointer but not a document entry', () => {
    expect(isHubSectionPointer('projects/agent-conductor/PROJECT.md', '[[daemon-test-suite]] — known core/server suite flakes')).toBe(true);
    expect(isHubSectionPointer('projects/agent-conductor/docs/run-engine.md', '[[daemon-test-suite]] — known core/server suite flakes')).toBe(false);
  });

  it('recognizes the real design-contract redirect and a simple one-line redirect', () => {
    expect(isRedirectStub('# Design contract — moved to [[design-design-contract]]\n\nThis slug was a duplicate. The design contract lives at [[design-design-contract]], written by VS-91.')).toBe(true);
    expect(isRedirectStub('# Legacy\n\nThe real document is [[canonical-doc]].')).toBe(true);
    expect(isRedirectStub('# Design contract\n\nThis document explains the design contract and links to [[design-design-contract]].')).toBe(false);
  });

  it('can disable containment scoring for the periodic sweep without changing the default', () => {
    expect(similarity('status', 'the status check passed')).toBe(0.95);
    expect(similarity('status', 'the status check passed', { containment: false })).toBeLessThan(0.8);
  });
});

describe('docPathFor with a folder (VS-265)', () => {
  it('places a project document flat when no folder is given, unchanged from before', () => {
    expect(docPathFor('project', 'retry-policy', 'acme')).toBe('projects/acme/docs/retry-policy.md');
  });

  it('nests a project document two folders deep', () => {
    expect(docPathFor('project', 'retry-policy', 'acme', 'runbooks/incidents')).toBe('projects/acme/docs/runbooks/incidents/retry-policy.md');
  });

  it('nests a shared document one folder deep', () => {
    expect(docPathFor('shared', 'onboarding', null, 'guides')).toBe('workspace/shared/guides/onboarding.md');
  });

  it('nests a workspace document one folder deep', () => {
    expect(docPathFor('workspace', 'billing', null, 'vendors')).toBe('workspace/docs/vendors/billing.md');
  });

  it.each([
    ['Runbooks', 'an uppercase segment'],
    ['runbooks/..', 'a .. segment'],
    ['/runbooks', 'a leading slash'],
    ['runbooks/', 'a trailing slash'],
    ['runbooks//incidents', 'a doubled slash'],
    ['r', 'a single-character segment'],
  ])('rejects %s (%s)', (folder) => {
    expect(() => docPathFor('project', 'retry-policy', 'acme', folder)).toThrow(/kebab-case/);
  });
});

describe('isDocPath / docSlugOf / docFolderOf with nested folders (VS-265)', () => {
  it('recognizes a flat document exactly as before', () => {
    expect(isDocPath('projects/acme/docs/retry-policy.md')).toBe(true);
    expect(docSlugOf('projects/acme/docs/retry-policy.md')).toBe('retry-policy');
    expect(docFolderOf('projects/acme/docs/retry-policy.md')).toBeNull();
  });

  it('recognizes a project document nested two folders deep', () => {
    const rel = 'projects/acme/docs/runbooks/incidents/retry-policy.md';
    expect(isDocPath(rel)).toBe(true);
    expect(docSlugOf(rel)).toBe('retry-policy');
    expect(docFolderOf(rel)).toBe('runbooks/incidents');
  });

  it('recognizes a shared document nested one folder deep', () => {
    const rel = 'workspace/shared/guides/onboarding.md';
    expect(isDocPath(rel)).toBe(true);
    expect(docSlugOf(rel)).toBe('onboarding');
    expect(docFolderOf(rel)).toBe('guides');
  });

  it('does not classify a hub file as a document', () => {
    expect(isDocPath('projects/acme/PROJECT.md')).toBe(false);
    expect(docSlugOf('projects/acme/PROJECT.md')).toBeNull();
    expect(docFolderOf('projects/acme/PROJECT.md')).toBeNull();
  });
});

describe('repoKnowledgePath (VS-358)', () => {
  it('strips the project prefix from a project-scoped path', () => {
    expect(repoKnowledgePath('projects/acme/PROJECT.md', 'acme')).toBe('PROJECT.md');
    expect(repoKnowledgePath('projects/acme/docs/run-engine.md', 'acme')).toBe('docs/run-engine.md');
  });

  it('refuses a workspace-scope path', () => {
    expect(() => repoKnowledgePath('workspace/WORKSPACE.md', 'acme')).toThrow(/not under projects\/acme\//);
  });

  it('refuses the shared file', () => {
    expect(() => repoKnowledgePath('workspace/SHARED.md', 'acme')).toThrow();
  });

  it('refuses the decisions log', () => {
    expect(() => repoKnowledgePath('workspace/decisions.md', 'acme')).toThrow();
  });

  it('refuses a different project\'s path', () => {
    expect(() => repoKnowledgePath('projects/other/PROJECT.md', 'acme')).toThrow();
  });
});

describe('readMirrorFile (VS-358)', () => {
  const tmps: string[] = [];
  afterEach(() => { while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true }); });
  const worktree = (): string => { const d = mkdtempSync(join(tmpdir(), 'ac-mirror-')); tmps.push(d); return d; };

  it('returns the seed when the mirror file does not exist yet', () => {
    expect(readMirrorFile(worktree(), 'PROJECT.md', '# Project\n')).toBe('# Project\n');
  });

  it('returns the file\'s current content when it exists', () => {
    const dir = worktree();
    mkdirSync(join(dir, '.weave', 'knowledge'), { recursive: true });
    writeFileSync(join(dir, '.weave', 'knowledge', 'PROJECT.md'), '# Project\n\n## Learnings\n- already here\n', 'utf8');
    expect(readMirrorFile(dir, 'PROJECT.md', '# Project\n')).toBe('# Project\n\n## Learnings\n- already here\n');
  });
});

describe('mergeEntries (VS-358)', () => {
  const doc = (...entries: string[]): string => ['# API', '', '## Landmines', ...entries.map((e) => `- ${e}`)].join('\n') + '\n';

  it('folds in an entry landed added, not already in the workspace', () => {
    const base = doc('2026-01-01 · original');
    const landed = doc('2026-01-01 · original', '2026-01-02 · landed this');
    const workspace = doc('2026-01-01 · original');
    const merged = mergeEntries(base, landed, workspace);
    expect(merged).toContain('landed this');
  });

  it('drops an entry landed removed, even though the workspace still has it', () => {
    const base = doc('2026-01-01 · original', '2026-01-02 · to be archived');
    const landed = doc('2026-01-01 · original');
    const workspace = doc('2026-01-01 · original', '2026-01-02 · to be archived');
    const merged = mergeEntries(base, landed, workspace);
    expect(merged).not.toContain('to be archived');
    expect(merged).toContain('original');
  });

  it('keeps an entry present only in the workspace (a still-unmerged write)', () => {
    const base = doc('2026-01-01 · original');
    const landed = doc('2026-01-01 · original'); // this landing never touched the hub's content
    const workspace = doc('2026-01-01 · original', '2026-01-03 · unmerged ticket note');
    const merged = mergeEntries(base, landed, workspace);
    expect(merged).toContain('unmerged ticket note');
  });

  it('combines an add, a remove and a kept unmerged entry in one call', () => {
    const base = doc('2026-01-01 · original', '2026-01-02 · to be archived');
    const landed = doc('2026-01-01 · original', '2026-01-04 · landed addition');
    const workspace = doc('2026-01-01 · original', '2026-01-02 · to be archived', '2026-01-03 · unmerged ticket note');
    const merged = mergeEntries(base, landed, workspace);
    expect(merged).toContain('original');
    expect(merged).toContain('landed addition');
    expect(merged).toContain('unmerged ticket note');
    expect(merged).not.toContain('to be archived');
  });
});
