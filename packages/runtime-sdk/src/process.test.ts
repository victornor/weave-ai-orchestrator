import { describe, expect, it } from 'vitest';
import { spawnLines } from './process.js';

const ECHO_SCRIPT = "process.stdin.setEncoding('utf8'); process.stdin.on('data', c => process.stdout.write(c.split('\\n').filter(Boolean).map(l => 'echo:' + l + '\\n').join(''))); process.stdin.on('end', () => process.exit(0));";

describe('spawnLines stdin modes', () => {
  it("'close' mode (default) ends stdin immediately, as before", async () => {
    const lines: string[] = [];
    const run = spawnLines({
      cmd: process.execPath, args: ['-e', ECHO_SCRIPT], cwd: process.cwd(), env: process.env as Record<string, string>,
      stdin: 'hello\n', timeoutMs: 5000, onLine: (s, l) => { if (s === 'stdout') lines.push(l); },
    });
    const outcome = await run.done;
    expect(outcome.exitCode).toBe(0);
    expect(lines).toEqual(['echo:hello']);
  });

  it("'open' mode keeps stdin writable across two separate writes", async () => {
    const lines: string[] = [];
    const run = spawnLines({
      cmd: process.execPath, args: ['-e', ECHO_SCRIPT], cwd: process.cwd(), env: process.env as Record<string, string>,
      stdinMode: 'open', timeoutMs: 5000, onLine: (s, l) => { if (s === 'stdout') lines.push(l); },
    });
    run.write('first\n');
    await new Promise((r) => setTimeout(r, 50));
    run.write('second\n');
    await new Promise((r) => setTimeout(r, 50));
    expect(lines).toEqual(['echo:first', 'echo:second']);
    run.endStdin();
    const outcome = await run.done;
    expect(outcome.exitCode).toBe(0);
  });

  it('a write after the child exits returns false rather than throwing', async () => {
    const run = spawnLines({
      cmd: process.execPath, args: ['-e', 'process.exit(0)'], cwd: process.cwd(), env: process.env as Record<string, string>,
      stdinMode: 'open', timeoutMs: 5000, onLine: () => {},
    });
    await run.done;
    expect(() => run.write('too late\n')).not.toThrow();
    expect(run.write('too late\n')).toBe(false);
  });
});
