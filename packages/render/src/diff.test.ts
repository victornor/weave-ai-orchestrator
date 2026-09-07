import { describe, expect, it } from 'vitest';
import { DIFF_FILE_TOO_LARGE_LINES, parseUnifiedDiff } from './diff.js';

describe('parseUnifiedDiff', () => {
  it('parses an added file', () => {
    const text = [
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      'index 0000000..e69de29',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1,2 @@',
      '+export const x = 1;',
      '+export const y = 2;',
      '',
    ].join('\n');
    const [file] = parseUnifiedDiff(text);
    expect(file).toMatchObject({
      path: 'src/new.ts', previousPath: null, status: 'added', binary: false,
      noNewlineAtEnd: false, additions: 2, deletions: 0, tooLarge: false,
    });
    expect(file!.hunks).toEqual([{
      oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, header: '@@ -0,0 +1,2 @@',
      lines: [
        { kind: 'add', oldLine: null, newLine: 1, text: 'export const x = 1;' },
        { kind: 'add', oldLine: null, newLine: 2, text: 'export const y = 2;' },
      ],
    }]);
  });

  it('parses a deleted file', () => {
    const text = [
      'diff --git a/src/old.ts b/src/old.ts',
      'deleted file mode 100644',
      'index e69de29..0000000',
      '--- a/src/old.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-export const x = 1;',
      '-export const y = 2;',
      '',
    ].join('\n');
    const [file] = parseUnifiedDiff(text);
    expect(file).toMatchObject({ path: 'src/old.ts', status: 'deleted', additions: 0, deletions: 2 });
    expect(file!.hunks[0]!.lines).toEqual([
      { kind: 'remove', oldLine: 1, newLine: null, text: 'export const x = 1;' },
      { kind: 'remove', oldLine: 2, newLine: null, text: 'export const y = 2;' },
    ]);
  });

  it('parses a renamed file with a content change', () => {
    const text = [
      'diff --git a/src/a.ts b/src/b.ts',
      'similarity index 90%',
      'rename from src/a.ts',
      'rename to src/b.ts',
      'index 1234567..89abcde 100644',
      '--- a/src/a.ts',
      '+++ b/src/b.ts',
      '@@ -1,3 +1,3 @@',
      ' export const shared = true;',
      '-export const old = 1;',
      '+export const renamed = 1;',
      ' export const tail = true;',
      '',
    ].join('\n');
    const [file] = parseUnifiedDiff(text);
    expect(file).toMatchObject({
      path: 'src/b.ts', previousPath: 'src/a.ts', status: 'renamed', additions: 1, deletions: 1,
    });
  });

  it('parses a binary file with no hunks', () => {
    const text = [
      'diff --git a/assets/logo.png b/assets/logo.png',
      'index 1234567..89abcde 100644',
      'Binary files a/assets/logo.png and b/assets/logo.png differ',
      '',
    ].join('\n');
    const [file] = parseUnifiedDiff(text);
    expect(file).toMatchObject({
      path: 'assets/logo.png', status: 'modified', binary: true, additions: 0, deletions: 0, tooLarge: false,
    });
    expect(file!.hunks).toEqual([]);
  });

  it('parses a file with several hunks', () => {
    const text = [
      'diff --git a/src/multi.ts b/src/multi.ts',
      'index 1234567..89abcde 100644',
      '--- a/src/multi.ts',
      '+++ b/src/multi.ts',
      '@@ -1,3 +1,3 @@',
      ' line1',
      '-line2',
      '+line2 changed',
      ' line3',
      '@@ -10,3 +10,4 @@',
      ' line10',
      ' line11',
      '+line12 added',
      ' line13',
      '',
    ].join('\n');
    const [file] = parseUnifiedDiff(text);
    expect(file!.hunks).toHaveLength(2);
    expect(file).toMatchObject({ path: 'src/multi.ts', status: 'modified', additions: 2, deletions: 1 });
    expect(file!.hunks[1]).toMatchObject({ oldStart: 10, oldLines: 3, newStart: 10, newLines: 4 });
  });

  it('parses a file with no trailing newline', () => {
    const text = [
      'diff --git a/src/notail.ts b/src/notail.ts',
      'index 1234567..89abcde 100644',
      '--- a/src/notail.ts',
      '+++ b/src/notail.ts',
      '@@ -1,1 +1,1 @@',
      '-old content',
      '\\ No newline at end of file',
      '+new content',
      '\\ No newline at end of file',
      '',
    ].join('\n');
    const [file] = parseUnifiedDiff(text);
    expect(file).toMatchObject({ noNewlineAtEnd: true, additions: 1, deletions: 1 });
  });

  it('marks a file too large to render above the threshold, with hunks omitted', () => {
    const added = Array.from({ length: DIFF_FILE_TOO_LARGE_LINES + 1 }, (_, i) => `+line ${i}`);
    const text = [
      'diff --git a/src/huge.ts b/src/huge.ts',
      'index 1234567..89abcde 100644',
      '--- a/src/huge.ts',
      '+++ b/src/huge.ts',
      `@@ -0,0 +1,${added.length} @@`,
      ...added,
      '',
    ].join('\n');
    const [file] = parseUnifiedDiff(text);
    expect(file).toMatchObject({ tooLarge: true, additions: DIFF_FILE_TOO_LARGE_LINES + 1 });
    expect(file!.hunks).toEqual([]);
  });

  it('stays just under the threshold with hunks kept', () => {
    const added = Array.from({ length: DIFF_FILE_TOO_LARGE_LINES }, (_, i) => `+line ${i}`);
    const text = [
      'diff --git a/src/big.ts b/src/big.ts',
      'index 1234567..89abcde 100644',
      '--- a/src/big.ts',
      '+++ b/src/big.ts',
      `@@ -0,0 +1,${added.length} @@`,
      ...added,
      '',
    ].join('\n');
    const [file] = parseUnifiedDiff(text);
    expect(file!.tooLarge).toBe(false);
    expect(file!.hunks).toHaveLength(1);
  });

  it('parses multiple files from one diff', () => {
    const text = [
      'diff --git a/one.ts b/one.ts',
      'index 1111111..2222222 100644',
      '--- a/one.ts',
      '+++ b/one.ts',
      '@@ -1,1 +1,1 @@',
      '-a',
      '+b',
      'diff --git a/two.ts b/two.ts',
      'index 3333333..4444444 100644',
      '--- a/two.ts',
      '+++ b/two.ts',
      '@@ -1,1 +1,1 @@',
      '-c',
      '+d',
      '',
    ].join('\n');
    const files = parseUnifiedDiff(text);
    expect(files.map((f) => f.path)).toEqual(['one.ts', 'two.ts']);
  });

  it('returns nothing for an empty diff', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});
