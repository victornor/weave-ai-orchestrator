/**
 * VS-362 repository guard: `openspec validate --all --strict` fails repo-wide while any capability
 * spec still carries the Purpose `openspec archive` writes for a new capability. This test keeps the
 * placeholder from returning unnoticed — it scans the checkout's real `openspec/specs` tree, and
 * proves the scanner actually reports a spec that still carries the placeholder against a fixture.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { findPlaceholderPurposeSpecs } from './purpose.js';

const REPO_SPECS = fileURLToPath(new URL('../../../../openspec/specs', import.meta.url));

let dir: string | null = null;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = null; });

describe('archive placeholder Purpose guard', () => {
  it('no capability spec in the repository still carries the archive placeholder', () => {
    expect(findPlaceholderPurposeSpecs(REPO_SPECS)).toEqual([]);
  });

  it('reports a fixture spec that still carries the placeholder', () => {
    dir = mkdtempSync(join(tmpdir(), 'ac-purpose-guard-'));
    const capability = join(dir, 'gadgets');
    mkdirSync(capability, { recursive: true });
    writeFileSync(
      join(capability, 'spec.md'),
      '# gadgets Specification\n\n## Purpose\nTBD - created by archiving change vs-100-old. Update Purpose after archive.\n\n## Requirements\n\n### Requirement: A gadget exists\nThe system SHALL have a gadget.\n\n#### Scenario: One gadget\n- **WHEN** asked\n- **THEN** a gadget is returned\n',
    );
    const offenders = findPlaceholderPurposeSpecs(dir);
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toContain(join('gadgets', 'spec.md'));
  });
});
