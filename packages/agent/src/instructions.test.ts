import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INSTRUCTION_MAX_BYTES, InstructionLoader } from './instructions.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'wa-instr-')); mkdirSync(join(root, 'a', 'b'), { recursive: true }); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('InstructionLoader', () => {
  it('appends the nearest AGENTS.md files once, root first', () => {
    writeFileSync(join(root, 'AGENTS.md'), 'ROOT RULES');
    writeFileSync(join(root, 'a', 'AGENTS.md'), 'A RULES');
    const l = new InstructionLoader(root);
    const first = l.forPath(join(root, 'a', 'b', 'x.ts'));
    expect(first).toBe(`\n\n[instructions from ${join(root, 'AGENTS.md')}]\nROOT RULES\n\n[instructions from ${join(root, 'a', 'AGENTS.md')}]\nA RULES`);
    expect(l.forPath(join(root, 'a', 'b', 'y.ts'))).toBe('');
    expect(l.forPath(join(root, 'a', 'z.ts'))).toBe('');
  });
  it('never loads a pinned file, and ignores paths outside the root', () => {
    writeFileSync(join(root, 'AGENTS.md'), 'ROOT');
    const l = new InstructionLoader(root);
    l.pin(join(root, 'AGENTS.md'));
    expect(l.forPath(join(root, 'x.ts'))).toBe('');
    expect(new InstructionLoader(root).forPath('/etc/passwd')).toBe('');
  });
  it('caps a file at 32 KiB', () => {
    writeFileSync(join(root, 'a', 'AGENTS.md'), 'x'.repeat(INSTRUCTION_MAX_BYTES + 500));
    const out = new InstructionLoader(root).forPath(join(root, 'a', 'f.ts'));
    expect(out).toContain(`[truncated at ${INSTRUCTION_MAX_BYTES} bytes]`);
    expect(out.length).toBeLessThan(INSTRUCTION_MAX_BYTES + 200);
  });
  it('reloads a file whose text fell out of the visible history', () => {
    writeFileSync(join(root, 'a', 'AGENTS.md'), 'A RULES');
    const l = new InstructionLoader(root);
    expect(l.forPath(join(root, 'a', 'f.ts'))).toContain('A RULES');
    l.syncFrom([]);
    expect(l.forPath(join(root, 'a', 'f.ts'))).toContain('A RULES');
    l.syncFrom([{ role: 'toolResult', toolCallId: '1', name: 'read', isError: false, text: `1\thi\n\n[instructions from ${join(root, 'a', 'AGENTS.md')}]\nA RULES` }]);
    expect(l.forPath(join(root, 'a', 'g.ts'))).toBe('');
  });
});
