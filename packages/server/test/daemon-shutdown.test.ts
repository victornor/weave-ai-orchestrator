/**
 * VS-262: `shutdown()`'s bounded two-stage drain-then-cancel sequence, and — the plan-review finding —
 * that it runs concurrently across workspaces rather than multiplying its bound by workspace count.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeRuntime } from '@weave-ai/runtime-sdk';
import type { TurnHandle, TurnInput, TurnSink } from '@weave-ai/runtime-sdk';
import type { Run } from '@weave-ai/shared';
import { workspaceLoader, initLogger } from '@weave-ai/core';
import { nowIso, openDb } from '@weave-ai/db';
import { startDaemon, type DaemonHandle } from '../src/daemon.js';
import { observeBoot } from '../src/restart-notice.js';

initLogger(process.env.AC_LOG_LEVEL ?? 'silent');

/** A turn that never finishes on its own; records every `cancel()` call and flips `started` once the
 * engine has wired a cancel handle for it (VS-254's `onHandle` path — requires `streamingInput`). */
class CancelableRuntime extends FakeRuntime {
  cancelled: Array<'interrupt' | 'kill'> = [];
  started = false;
  private release?: () => void;

  constructor() {
    super();
    this.streamingInput = true;
    this.queue.push(() => new Promise((resolve) => { this.release = () => resolve({}); }));
  }

  override async runTurn(input: TurnInput, sink: TurnSink, onHandle?: (h: TurnHandle) => void) {
    return super.runTurn(input, sink, (h) => {
      this.started = true;
      onHandle?.({ ...h, cancel: async (mode) => { this.cancelled.push(mode); this.release?.(); } });
    });
  }
}

async function until(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition was never reached');
    await new Promise((r) => setTimeout(r, 10));
  }
}

let daemon: DaemonHandle | null = null;
let dirs: string[] = [];
afterEach(async () => {
  await daemon?.stop('test');
  daemon = null;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

/** Registers a workspace with a stuck turn already dispatched and running. Returns its runtime. */
async function workspaceWithStuckTurn(
  handle: DaemonHandle, id: string, wsDir: string, runtimeId: string,
): Promise<CancelableRuntime> {
  const runtime = new CancelableRuntime();
  handle.registries.runtimes.set(runtimeId, runtime);
  const ws = handle.workspaces.get(id)!;
  ws.ctx.config.models = { weaver: { runtime: runtimeId, model: null }, workers: { runtime: runtimeId, model: null }, workerOptions: [] };
  const conductorId = ws.services.workers.conductor().id;
  // A throwaway config dir is isolated by default (VS-143): the dispatcher only picks up a
  // human-requested wake, so this has to be marked as one explicitly or it never dispatches.
  ws.services.wake.enqueue(conductorId, { source: 'human_message', reason: 'go', requestedBy: { kind: 'human', id: 'test' } });
  await ws.services.dispatcher.tick();
  await until(() => runtime.started);
  return runtime;
}

describe('graceful shutdown (VS-262)', () => {
  it('cancels a turn still running past the drain grace period and records it interrupted', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ac-cfg-'));
    const wsDir = mkdtempSync(join(tmpdir(), 'ac-ws-'));
    dirs = [configDir, wsDir];
    await workspaceLoader.initWorkspace(wsDir, { id: 'stuck', name: 'Stuck', ticketPrefix: 'STK' });
    workspaceLoader.writeRegistry({ workspaces: [{ id: 'stuck', path: wsDir }] }, configDir);
    workspaceLoader.writeDaemonConfig({ ...workspaceLoader.readDaemonConfig(configDir), http: { listen: '127.0.0.1:0', trustProxy: false, tls: { mode: 'none', domains: [] } } }, configDir);

    daemon = await startDaemon({ configDir, shutdownGraceMs: { drain: 100, cancel: 2000 } });
    const runtime = await workspaceWithStuckTurn(daemon, 'stuck', wsDir, 'fake');
    const dbPath = daemon.workspaces.get('stuck')!.ctx.paths.db;

    const started = Date.now();
    await daemon.stop('test');
    expect(Date.now() - started).toBeLessThan(3000);
    daemon = null;

    expect(runtime.cancelled).toEqual(['interrupt']);
    // The workspace db is closed as part of shutdown — reopen it to see what was actually recorded.
    const db = openDb(dbPath);
    try {
      const run = db.get<Run>("SELECT * FROM runs WHERE agent_id = (SELECT id FROM agents WHERE kind = 'weaver')");
      expect(run?.status).toBe('interrupted');
      // VS-339: a shutdown cut is distinguished from a human interrupt, its wake is left queued to
      // resume, and its worker is left active rather than parked.
      expect(run?.errorCode).toBe('interrupted_by_shutdown');
      const wake = db.get<{ status: string; runId: string | null }>(
        "SELECT status, run_id FROM wakeups WHERE source = 'human_message'");
      expect(wake?.status).toBe('queued');
      expect(wake?.runId).toBeNull();
      expect(db.get<{ status: string }>("SELECT status FROM agents WHERE kind = 'weaver'")?.status).toBe('active');
      expect(db.all("SELECT id FROM decisions WHERE status = 'open'")).toHaveLength(0);
    } finally {
      db.close();
    }
    // The deliberate shutdown is recorded in the daemon database for the next boot (VS-339).
    const daemonDb = openDb(join(configDir, 'daemon.sqlite'));
    try {
      expect(daemonDb.get<{ value: string }>("SELECT value FROM meta WHERE key = 'daemon.lifecycle.shutdown_at'")?.value).toBeTruthy();
      expect(daemonDb.get<{ value: string }>("SELECT value FROM meta WHERE key = 'daemon.lifecycle.shutdown_reason'")?.value).toBe('test');
    } finally {
      daemonDb.close();
    }
  }, 15_000);

  it('records a failed start so the next boot can report it (VS-339)', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ac-cfg-'));
    const wsDir = mkdtempSync(join(tmpdir(), 'ac-ws-'));
    dirs = [configDir, wsDir];
    await workspaceLoader.initWorkspace(wsDir, { id: 'bindfail', name: 'Bind', ticketPrefix: 'BND' });
    workspaceLoader.writeRegistry({ workspaces: [{ id: 'bindfail', path: wsDir }] }, configDir);

    // Hold a port, then ask the daemon to bind it — the 2026-09-13 EADDRNOTAVAIL shape.
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    const port = (blocker.address() as AddressInfo).port;
    workspaceLoader.writeDaemonConfig({
      ...workspaceLoader.readDaemonConfig(configDir),
      http: { listen: `127.0.0.1:${port}`, trustProxy: false, tls: { mode: 'none', domains: [] } },
    }, configDir);

    try {
      await expect(startDaemon({ configDir })).rejects.toThrow();
    } finally {
      blocker.close();
    }

    const daemonDb = openDb(join(configDir, 'daemon.sqlite'));
    try {
      const observed = observeBoot(daemonDb, { now: nowIso(), release: null, pid: null });
      expect(observed.failedStarts.count).toBe(1);
      expect(observed.failedStarts.lastReason).toMatch(/EADDRINUSE|address already in use/i);
    } finally {
      daemonDb.close();
    }
  }, 15_000);

  it('bounds three workspaces concurrently, not three times over (the plan-review regression)', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ac-cfg-'));
    const wsDirs = ['a', 'b', 'c'].map(() => mkdtempSync(join(tmpdir(), 'ac-ws-')));
    dirs = [configDir, ...wsDirs];
    const ids = ['multi-a', 'multi-b', 'multi-c'];
    for (const [i, id] of ids.entries()) {
      await workspaceLoader.initWorkspace(wsDirs[i]!, { id, name: id, ticketPrefix: id.slice(-1).toUpperCase().repeat(3) });
    }
    workspaceLoader.writeRegistry({ workspaces: ids.map((id, i) => ({ id, path: wsDirs[i]! })) }, configDir);
    workspaceLoader.writeDaemonConfig({ ...workspaceLoader.readDaemonConfig(configDir), http: { listen: '127.0.0.1:0', trustProxy: false, tls: { mode: 'none', domains: [] } } }, configDir);

    // The drain grace period is what dominates here (the fake's `cancel()` resolves its stuck turn
    // instantly, so the second stage costs ~0) — sized so a serial loop's 3x multiplier (~2100ms) is
    // unambiguously distinguishable from concurrent draining's ~700ms total.
    daemon = await startDaemon({ configDir, shutdownGraceMs: { drain: 700, cancel: 1000 } });
    const runtimes = await Promise.all(ids.map((id, i) => workspaceWithStuckTurn(daemon!, id, wsDirs[i]!, `fake-${id}`)));

    const started = Date.now();
    await daemon.stop('test');
    const elapsed = Date.now() - started;
    // Concurrent draining takes roughly one workspace's own bound regardless of how many are
    // registered; a serial loop over three workspaces would take roughly 3x that (~2100ms).
    expect(elapsed).toBeLessThan(1500);
    for (const runtime of runtimes) expect(runtime.cancelled).toEqual(['interrupt']);
    daemon = null;
  }, 20_000);
});
