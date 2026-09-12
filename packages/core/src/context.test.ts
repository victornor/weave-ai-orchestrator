import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { workspacePaths } from './context.js';

describe('workspacePaths', () => {
  it('resolves attachments alongside the other non-served workspace state', () => {
    // VS-258: '/ws/acme' doesn't exist on disk, so this is a fresh install and lands on the new name.
    const p = workspacePaths('/ws/acme');
    expect(p.attachments).toBe('/ws/acme/.weave/attachments');
    expect(p.attachments.startsWith(p.state)).toBe(true);
  });

  describe('old/new/fresh/ambiguous resolution (VS-258)', () => {
    const tmps: string[] = [];
    afterEach(() => { while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true }); });
    function tmp(prefix: string): string {
      const dir = mkdtempSync(join(tmpdir(), prefix));
      tmps.push(dir);
      return dir;
    }

    it('finds an existing workspace under the old name — acceptance criterion 6: keyed on db.sqlite, not treated as uninitialised', () => {
      const root = tmp('ac-wp-old-');
      mkdirSync(join(root, '.agent-conductor'));
      writeFileSync(join(root, '.agent-conductor', 'db.sqlite'), '');
      const p = workspacePaths(root);
      expect(p.state).toBe(join(root, '.agent-conductor'));
      expect(p.db).toBe(join(root, '.agent-conductor', 'db.sqlite'));
      expect(p.weaver).toBe(join(root, 'conductor'));
    });

    it('finds an existing workspace under the new name', () => {
      const root = tmp('ac-wp-new-');
      mkdirSync(join(root, '.weave'));
      writeFileSync(join(root, '.weave', 'db.sqlite'), '');
      const p = workspacePaths(root);
      expect(p.state).toBe(join(root, '.weave'));
      expect(p.db).toBe(join(root, '.weave', 'db.sqlite'));
      expect(p.weaver).toBe(join(root, 'weaver'));
    });

    it('gives a fresh workspace (neither name present) the new name', () => {
      const root = tmp('ac-wp-fresh-');
      const p = workspacePaths(root);
      expect(p.state).toBe(join(root, '.weave'));
      expect(p.weaver).toBe(join(root, 'weaver'));
    });

    it('refuses an ambiguous workspace (db.sqlite under both names) rather than silently picking one', () => {
      const root = tmp('ac-wp-ambiguous-');
      mkdirSync(join(root, '.agent-conductor'));
      mkdirSync(join(root, '.weave'));
      writeFileSync(join(root, '.agent-conductor', 'db.sqlite'), '');
      writeFileSync(join(root, '.weave', 'db.sqlite'), '');
      expect(() => workspacePaths(root)).toThrow(expect.objectContaining({ code: 'ambiguous_install_path' }));
    });
  });
});
