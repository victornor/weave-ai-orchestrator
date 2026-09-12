import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildZip, zipEntryNamesFor, type ZipEntry } from './zip.js';

/** Parses just enough of a ZIP's central directory to verify what `buildZip` claims to have written, independent of the writer's own idea of its output. */
function parseCentralDirectory(zip: Buffer): Array<{ name: string; crc: number; size: number; offset: number }> {
  const eocdSig = 0x06054b50;
  let eocdOffset = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === eocdSig) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) throw new Error('no end-of-central-directory record found');
  const total = zip.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = zip.readUInt32LE(eocdOffset + 16);
  const entries: Array<{ name: string; crc: number; size: number; offset: number }> = [];
  let p = centralDirOffset;
  for (let i = 0; i < total; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50);
    const crc = zip.readUInt32LE(p + 16);
    const size = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const offset = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    entries.push({ name, crc, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

describe('buildZip', () => {
  it('round-trips several entries, verified against a manual parse of the central directory', () => {
    const entries: ZipEntry[] = [
      { name: 'design-contract.md', bytes: Buffer.from('the design contract') },
      { name: 'briefs/one.md', bytes: Buffer.from('brief one') },
      { name: 'index.css', bytes: Buffer.from(':root { --x: 1; }') },
    ];
    const zip = buildZip(entries);
    const parsed = parseCentralDirectory(zip);
    expect(parsed.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    for (const [i, entry] of entries.entries()) {
      expect(parsed[i]!.size).toBe(entry.bytes.length);
      expect(parsed[i]!.offset).toBeGreaterThanOrEqual(0);
    }
  });

  it('produces an empty-but-valid archive for zero entries', () => {
    const zip = buildZip([]);
    expect(parseCentralDirectory(zip)).toEqual([]);
  });

  describe('against the real unzip binary', () => {
    let dir: string;
    let hasUnzip = true;
    try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); } catch { hasUnzip = false; }
    const maybeIt = hasUnzip ? it : it.skip;

    maybeIt('lists and extracts exactly what was written', () => {
      dir = mkdtempSync(join(tmpdir(), 'ac-zip-'));
      const zipPath = join(dir, 'handoff.zip');
      const entries: ZipEntry[] = [
        { name: 'a.txt', bytes: Buffer.from('file a') },
        { name: 'nested/b.txt', bytes: Buffer.from('file b, a little longer') },
      ];
      writeFileSync(zipPath, buildZip(entries));

      const listing = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8' });
      expect(listing).toContain('a.txt');
      expect(listing).toContain('nested/b.txt');

      const extracted = execFileSync('unzip', ['-p', zipPath, 'a.txt'], { encoding: 'utf8' });
      expect(extracted).toBe('file a');
      const extractedNested = execFileSync('unzip', ['-p', zipPath, 'nested/b.txt'], { encoding: 'utf8' });
      expect(extractedNested).toBe('file b, a little longer');

      rmSync(dir, { recursive: true, force: true });
    });
  });
});

describe('zipEntryNamesFor', () => {
  it('uses the base name when there is no collision', () => {
    const names = zipEntryNamesFor(['/a/one.md', '/b/two.md']);
    expect(names.get('/a/one.md')).toBe('one.md');
    expect(names.get('/b/two.md')).toBe('two.md');
  });

  it('prefixes the parent directory when two base names collide', () => {
    const names = zipEntryNamesFor(['/knowledge/a/notes.md', '/knowledge/b/notes.md']);
    expect(names.get('/knowledge/a/notes.md')).toBe('notes.md');
    expect(names.get('/knowledge/b/notes.md')).toBe('b/notes.md');
  });

  it('falls back to a numeric suffix when the parent-prefixed name still collides', () => {
    const names = zipEntryNamesFor(['/x/b/notes.md', '/y/b/notes.md', '/z/b/notes.md']);
    expect(names.get('/x/b/notes.md')).toBe('notes.md');
    expect(names.get('/y/b/notes.md')).toBe('b/notes.md');
    expect(names.get('/z/b/notes.md')).toBe('b/notes-2.md');
  });
});
