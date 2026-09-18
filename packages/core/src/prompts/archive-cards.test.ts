import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function markdownUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return markdownUnder(full);
    return /\.(md|tmpl)$/.test(name) ? [full] : [];
  });
}

/** VS-570: the daemon lands archive backfills itself, so no shipped agent prompt may ask anyone to approve one. */
describe('agent prompts and archive backfills (VS-570)', () => {
  it('never tell anyone to approve a spec archive', () => {
    const files = [...markdownUnder(join(root, 'skills')), ...markdownUnder(join(root, 'templates')), ...markdownUnder(join(root, 'docs', 'prompts'))];
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/approve (the )?(spec )?archive|archive (backfill )?(merge )?(card|approval)/i);
    }
  });
});
