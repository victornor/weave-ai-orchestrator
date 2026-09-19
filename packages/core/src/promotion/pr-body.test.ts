import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPromotionBody, readPullRequestTemplate, type PromotionBodyInput } from './pr-body.js';

/** VS-584: the promotion PR body fills the repository's template honestly, or generates one. */
describe('promotion pull-request body', () => {
  let dir: string;

  const input = (over: Partial<PromotionBodyInput> = {}): PromotionBodyInput => ({
    landing: 'edge', defaultBranch: 'main', landingHead: 'a'.repeat(40), defaultHead: 'b'.repeat(40),
    changedFiles: 59, additions: 1200, deletions: 300,
    tickets: [{ identifier: 'FS-12', title: 'Add a thing' }, { identifier: 'FS-13', title: 'Fix another' }],
    commits: [{ sha: 'c'.repeat(40), subject: 'feat: a thing' }],
    notes: ['pushing to main deploys production'],
    ...over,
  });

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ac-pr-body-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads GitHub’s preferred template locations, and null when there is none', () => {
    expect(readPullRequestTemplate(dir)).toBeNull();
    mkdirSync(join(dir, '.github'), { recursive: true });
    writeFileSync(join(dir, '.github', 'PULL_REQUEST_TEMPLATE.md'), '## Description\n\n<!-- what -->\n');
    expect(readPullRequestTemplate(dir)).toContain('## Description');
  });

  it('falls back to the first template in .github/PULL_REQUEST_TEMPLATE/', () => {
    mkdirSync(join(dir, '.github', 'PULL_REQUEST_TEMPLATE'), { recursive: true });
    writeFileSync(join(dir, '.github', 'PULL_REQUEST_TEMPLATE', 'b.md'), '## B\n');
    writeFileSync(join(dir, '.github', 'PULL_REQUEST_TEMPLATE', 'a.md'), '## A\n');
    expect(readPullRequestTemplate(dir)).toContain('## A');
  });

  it('fills a description section with facts, keeps unknown sections, and never leaves one blank', () => {
    const template = ['## Description', '', '<!-- describe -->', '', '## Edge / shared-DB safety', '', '- [ ] no schema change', '', '## Notes', '', ''].join('\n');
    const body = buildPromotionBody(input(), template);
    expect(body).toContain('## Description');
    expect(body).toContain('**Promotion:** edge → main');
    expect(body).toContain('FS-12 Add a thing');
    // The safety checklist is the repository's own words, kept untouched — no invented claim.
    expect(body).toContain('- [ ] no schema change');
    // The empty section is marked rather than left blank.
    expect(body).toContain('_Requires human confirmation');
  });

  it('always states the tickets, the changed files and the go-live notes', () => {
    const body = buildPromotionBody(input(), null);
    expect(body).toContain('## What this promotion carries');
    expect(body).toContain('FS-13 Fix another');
    expect(body).toContain('59 files, +1200/−300');
    expect(body).toContain('pushing to main deploys production');
    expect(body).toContain('Commits on edge (detail)');
  });
});
