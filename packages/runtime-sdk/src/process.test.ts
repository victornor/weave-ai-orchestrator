import { describe, expect, it, vi } from 'vitest';
import { classifyError, spawnLines } from './process.js';

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
    expect(run.write('first\n')).toBe(true);
    await vi.waitFor(() => { expect(lines).toEqual(['echo:first']); }, { timeout: 2000, interval: 10 });
    expect(run.write('second\n')).toBe(true);
    await vi.waitFor(() => { expect(lines).toEqual(['echo:first', 'echo:second']); }, { timeout: 2000, interval: 10 });
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

describe('classifyError', () => {
  it('preserves a realistically long, structured message intact (VS-201)', () => {
    const models = Array.from({ length: 60 }, (_, i) => `gpt-5.${i}-sol-high`).join(', ');
    const stderr = `Cannot use this model: grok-4-6. Available models: ${models}`;
    expect(stderr.length).toBeLessThan(4000);
    const err = classifyError(1, stderr);
    expect(err?.message).toBe(stderr);
    expect(err?.message).toContain(`gpt-5.59-sol-high`);
  });

  it('marks a message longer than the generous limit instead of cutting it silently', () => {
    const stderr = `x`.repeat(5000);
    const err = classifyError(1, stderr);
    expect(err?.message.length).toBeLessThan(5000);
    expect(err?.message).toMatch(/…\[\+\d+ chars\]$/);
  });
});
