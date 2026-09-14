/**
 * VS-376: `scripts/scratch-daemon.sh` must never stop a pid it does not own. A recorded pid whose
 * command line does not name the scratch config dir is refused — the guard that makes a recorded pid
 * safe where `pkill -f packages/server/dist/bin.js` (which also matches the live daemon) was not.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../scripts/scratch-daemon.sh');

const dirs: string[] = [];
const children: ChildProcess[] = [];

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ac-scratch-'));
  dirs.push(dir);
  return dir;
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/**
 * Run the helper asynchronously: the test owns the spawned daemon and must keep reaping it while the
 * script waits for it to exit, or the script sees a zombie and burns its whole kill timeout.
 */
function runScript(args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((done) => {
    execFile('bash', [SCRIPT, ...args], { encoding: 'utf8' }, (error, stdout, stderr) => {
      const status = error ? ((error as { code?: number }).code ?? 1) : 0;
      done({ status, stdout, stderr });
    });
  });
}

async function until(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}

afterEach(() => {
  for (const child of children.splice(0)) {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('scripts/scratch-daemon.sh (VS-376)', () => {
  it('refuses to stop a pid whose command line does not name the scratch config dir', async () => {
    const dir = scratchDir();
    const child = spawn('sleep', ['30'], { stdio: 'ignore' });
    children.push(child);
    writeFileSync(join(dir, 'pid'), String(child.pid));

    const r = await runScript(['stop', '--dir', dir]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('refusing to stop');
    expect(isAlive(child.pid!)).toBe(true);
  });

  it('stops a pid whose command line names the scratch config dir', async () => {
    const dir = scratchDir();
    const configDir = join(dir, 'config');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', configDir], { stdio: 'ignore' });
    children.push(child);
    writeFileSync(join(dir, 'pid'), String(child.pid));

    const r = await runScript(['stop', '--dir', dir]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('stopped');
    await until(() => !isAlive(child.pid!));
    expect(isAlive(child.pid!)).toBe(false);
  });
});
