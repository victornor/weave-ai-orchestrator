/**
 * VS-579: prove containment for real, on a scratch transient scope, without ever naming or
 * signalling the live `weave-ai.service` unit.
 *
 * Opt-in and off in the ordinary suite: `WEAVE_WORKER_CONTAINMENT_E2E=1 pnpm vitest run packages/core/test/worker-containment.e2e.test.ts`.
 * The default suite sets `AC_TEST_GUARD` so nothing reaches the host's service manager; this test
 * only lifts that guard when a human has explicitly asked for the real thing, and it always uses
 * uniquely named units (`ac-run-e2e-<pid>-<rand>`) so it cannot collide with the live daemon.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { containmentPrefix, readScopeMemoryPeak, releaseScope, scopeUnitName, stopScope, systemdScopeAvailable, TEST_GUARD_ENV } from '@weave-ai/runtime-sdk';

const ENABLED = process.env['WEAVE_WORKER_CONTAINMENT_E2E'] === '1';
const MB = 1024 * 1024;

/** A process that allocates past its cgroup limit and must be killed, without being a worker turn. */
const HOG = 'const a=[]; for (let i=0;i<64;i++) { a.push(Buffer.alloc(64*1024*1024, 1)); }';

function wrapped(runId: string, memoryMb: number, cmd: string, args: string[]): string[] {
  const prefix = containmentPrefix({ runId, memoryMb });
  return [...prefix.args, cmd, ...args];
}

/** Wait for the child to close, resolving with its code and signal. */
function waitClose(child: ReturnType<typeof spawn>): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!ENABLED)('worker memory containment on a scratch scope (VS-579)', () => {
  it('kills a memory hog in its own scope while a sibling scope keeps running', async () => {
    const guard = process.env[TEST_GUARD_ENV];
    delete process.env[TEST_GUARD_ENV];
    try {
      if (!systemdScopeAvailable()) {
        expect(systemdScopeAvailable()).toBe(false);
        return; // no user manager on this host — nothing to prove, and nothing to touch
      }

      const runId = `e2e-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
      const demoId = `${runId}-demo`;
      const hogUnit = scopeUnitName(runId);
      const demoUnit = scopeUnitName(demoId);

      // The sibling stands in for the daemon: same containment settings, no runaway allocation.
      const demo = spawn('systemd-run', wrapped(demoId, 256, process.execPath, ['-e', `setTimeout(()=>{}, 60000)`]), { stdio: 'ignore' });
      // The hog allocates far past 256 MB; OOMPolicy=kill means the whole scope is killed.
      const hog = spawn('systemd-run', wrapped(runId, 256, process.execPath, ['-e', HOG]), { stdio: ['ignore', 'pipe', 'pipe'] });
      let hogErr = '';
      hog.stderr?.on('data', (c: Buffer) => { hogErr += c.toString('utf8'); });

      const hogResult = await waitClose(hog);
      // The kernel/oomd killed it rather than it exiting cleanly.
      const killed = hogResult.signal === 'SIGKILL' || hogResult.code === 137 || hogResult.code === 9;
      expect(killed, `hog should be memory-killed, got code=${hogResult.code} signal=${hogResult.signal} stderr=${hogErr.slice(0, 300)}`).toBe(true);

      // The peak the daemon would read to attribute the kill.
      const peak = await readScopeMemoryPeak(hogUnit);
      expect(peak).not.toBeNull();
      expect(peak!).toBeGreaterThan(200 * MB);
      releaseScope(hogUnit);

      // The sibling survived: containment took one scope, not the host.
      expect(demo.exitCode).toBeNull();
      await sleep(200);
      expect(demo.exitCode).toBeNull();

      stopScope(demoUnit);
      await waitClose(demo);
      expect(existsSync(join('/sys/fs/cgroup'))).toBe(true);
    } finally {
      if (guard !== undefined) process.env[TEST_GUARD_ENV] = guard;
    }
  }, 90_000);
});
