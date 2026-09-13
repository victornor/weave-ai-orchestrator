import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  containsPlaceholderPurpose,
  extractWhyParagraph,
  fillArchivedCapabilityPurposes,
  findPlaceholderPurposeSpecs,
  placeholderChangeName,
} from './purpose.js';

let dir: string | null = null;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = null; });

function setup(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), 'ac-purpose-'));
  for (const [path, body] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

const PLACEHOLDER = 'TBD - created by archiving change vs-100-my-change. Update Purpose after archive.';

function specBody(purpose: string): string {
  return `# my-cap Specification\n\n## Purpose\n${purpose}\n\n## Requirements\n\n### Requirement: Something\nThe system SHALL do something.\n\n#### Scenario: It does\n- **WHEN** asked\n- **THEN** it does\n`;
}

describe('placeholder detection', () => {
  it('recognises the sentence openspec archive writes', () => {
    expect(containsPlaceholderPurpose(specBody(PLACEHOLDER))).toBe(true);
    expect(placeholderChangeName(PLACEHOLDER)).toBe('vs-100-my-change');
  });

  it('does not treat an authored Purpose, or a bare TBD, as the placeholder', () => {
    expect(containsPlaceholderPurpose(specBody('Defines how my-cap works.'))).toBe(false);
    expect(placeholderChangeName('Defines how my-cap works.')).toBeNull();
    // A leading TBD without archive's sentence is a different (openspec-side) problem.
    expect(containsPlaceholderPurpose(specBody('TBD'))).toBe(false);
  });

  it('finds only the specs carrying the placeholder under a specs tree', () => {
    const root = setup({
      'openspec/specs/one/spec.md': specBody(PLACEHOLDER),
      'openspec/specs/two/spec.md': specBody('Writes real things for real reasons.'),
      'openspec/specs/nested/three/spec.md': specBody(PLACEHOLDER),
    });
    const found = findPlaceholderPurposeSpecs(join(root, 'openspec', 'specs')).map((f) => f.slice(root.length + 1));
    expect(found.sort()).toEqual(['openspec/specs/nested/three/spec.md', 'openspec/specs/one/spec.md']);
  });
});

describe('extractWhyParagraph', () => {
  it('returns the first non-empty paragraph of the Why section', () => {
    const proposal = '## Why\n\nFirst line of the why.\nStill the first paragraph.\n\nSecond paragraph.\n\n## What Changes\n- x\n';
    expect(extractWhyParagraph(proposal)).toBe('First line of the why.\nStill the first paragraph.');
  });

  it('returns null when the section is absent or has no prose', () => {
    expect(extractWhyParagraph('## What Changes\n- x\n')).toBeNull();
    expect(extractWhyParagraph('## Why\n\n## What Changes\n- x\n')).toBeNull();
  });
});

describe('fillArchivedCapabilityPurposes', () => {
  const WHY = 'My-cap exists so callers can rely on the thing it guards.';

  function repoWithChange(files: Record<string, string> = {}): string {
    return setup({
      'openspec/specs/my-cap/spec.md': specBody(PLACEHOLDER),
      'openspec/changes/archive/2026-01-01-vs-100-my-change/proposal.md': `## Why\n\n${WHY}\n\n## What Changes\n- add it\n`,
      ...files,
    });
  }

  it('fills a newly created capability from the archived proposal Why', () => {
    const root = repoWithChange();
    const result = fillArchivedCapabilityPurposes(root, 'vs-100-my-change');
    expect(result.filled).toEqual(['openspec/specs/my-cap/spec.md']);
    const filled = readFileSync(join(root, 'openspec', 'specs', 'my-cap', 'spec.md'), 'utf8');
    expect(filled).toContain(WHY);
    expect(filled).not.toContain('Update Purpose after archive');
    // The rest of the spec is untouched.
    expect(filled).toContain('### Requirement: Something');
  });

  it('throws when a placeholder exists but the proposal has no usable Why', () => {
    const root = setup({
      'openspec/specs/my-cap/spec.md': specBody(PLACEHOLDER),
      'openspec/changes/archive/2026-01-01-vs-100-my-change/proposal.md': '## What Changes\n- add it\n',
    });
    expect(() => fillArchivedCapabilityPurposes(root, 'vs-100-my-change'))
      .toThrow(/openspec\/specs\/my-cap\/spec.md/);
    // Nothing was written.
    expect(containsPlaceholderPurpose(readFileSync(join(root, 'openspec', 'specs', 'my-cap', 'spec.md'), 'utf8'))).toBe(true);
  });

  it('leaves another change\'s placeholder alone', () => {
    const other = 'TBD - created by archiving change vs-200-other-change. Update Purpose after archive.';
    const root = repoWithChange({ 'openspec/specs/other/spec.md': specBody(other) });
    const result = fillArchivedCapabilityPurposes(root, 'vs-100-my-change');
    expect(result.filled).toEqual(['openspec/specs/my-cap/spec.md']);
    expect(readFileSync(join(root, 'openspec', 'specs', 'other', 'spec.md'), 'utf8')).toContain(other);
  });

  it('is a no-op for a change that created no capability', () => {
    const root = setup({
      'openspec/specs/my-cap/spec.md': specBody('A real, authored purpose for this capability.'),
      'openspec/changes/archive/2026-01-01-vs-100-my-change/proposal.md': `## Why\n\n${WHY}\n`,
    });
    expect(fillArchivedCapabilityPurposes(root, 'vs-100-my-change')).toEqual({ filled: [] });
  });
});
