import { describe, expect, it } from 'vitest';
import { docFolderOf, docPathFor, docSlugOf, isDocPath, isHubStub, seedBody } from './files.js';

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
    expect(isHubStub('# Workspace\n\n<!-- Conductor-only. Budget 3000 tokens. -->\n\n## Portfolio\n\n(one line per project: id — purpose — default role)\n')).toBe(true);
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
