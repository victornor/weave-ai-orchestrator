import { describe, expect, it } from 'vitest';
import { sh } from './exec.js';

describe('sh onLine', () => {
  it('reports each line as it arrives and still resolves with the buffered result', async () => {
    const seen: Array<[string, string]> = [];
    const r = await sh('sh', ['-c', 'printf "one\\ntwo\\n"; printf "bad\\n" >&2; printf "three"'], {
      cwd: process.cwd(), timeoutMs: 10_000, onLine: (stream, line) => seen.push([stream, line]),
    });
    expect(r.ok).toBe(true);
    expect(r.stdout).toBe('one\ntwo\nthree');
    expect(r.stderr).toBe('bad');
    expect(seen.filter(([s]) => s === 'stdout').map(([, l]) => l)).toEqual(['one', 'two', 'three']);
    expect(seen.filter(([s]) => s === 'stderr').map(([, l]) => l)).toEqual(['bad']);
  });

  it('treats a carriage return as a line break, so git progress counters are lines', async () => {
    const lines: string[] = [];
    await sh('sh', ['-c', 'printf "10%%\\r50%%\\r100%%\\n"'], {
      cwd: process.cwd(), timeoutMs: 10_000, onLine: (_s, line) => lines.push(line),
    });
    expect(lines).toEqual(['10%', '50%', '100%']);
  });

  it('leaves a command without onLine exactly as it was', async () => {
    const r = await sh('sh', ['-c', 'echo plain'], { cwd: process.cwd(), timeoutMs: 10_000 });
    expect(r).toMatchObject({ ok: true, exitCode: 0, stdout: 'plain', stderr: '' });
  });
});
