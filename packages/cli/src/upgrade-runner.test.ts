import { describe, expect, it } from 'vitest';
import { Db, nowIso } from '@weave-ai/db';
import { HEALTH_DEADLINE_MS, driveRestart, recordVerdict, type HealthProbe, type RunnerIo, type RunnerVerdict } from './upgrade-runner.js';

const TARGET = { release: '/rel/20260202-120000-bbbbbbbbbb', sha: 'b'.repeat(40) };

interface FakeHost extends RunnerIo { restarts: number; rollbacks: string[]; clock: number }

/** A host that never exists: every effect is recorded, and the clock only moves when we sleep. */
function io(over: Partial<RunnerIo> & { answers?: Array<HealthProbe | null> } = {}): FakeHost {
  const answers = over.answers ?? [];
  const state: FakeHost = {
    restarts: 0,
    rollbacks: [],
    clock: 1_000_000,
    restart: async (): Promise<void> => { state.restarts += 1; },
    probe: async (): Promise<HealthProbe | null> => (answers.length ? answers.shift()! : null),
    rollbackTo: (release: string): void => { state.rollbacks.push(release); },
    previousRelease: (): string | null => '/rel/20260101-120000-aaaaaaaaaa',
    now: (): number => state.clock,
    sleep: async (ms: number): Promise<void> => { state.clock += ms; },
    alreadyCompleted: async (): Promise<boolean> => false,
    ...over,
  };
  return state;
}

const healthy = (over: Partial<HealthProbe> = {}): HealthProbe =>
  ({ ok: true, version: '1.1.0', releasePath: TARGET.release, releaseSha: TARGET.sha, ...over });

describe('driveRestart', () => {
  it('restarts once and completes when the target answers healthy', async () => {
    const host = io({ answers: [null, null, healthy()] });
    const verdict = await driveRestart(TARGET, host);
    expect(verdict).toEqual({ outcome: 'completed', version: '1.1.0' });
    expect(host.restarts).toBe(1);
    expect(host.rollbacks).toEqual([]);
  });

  it('accepts the target identified by its commit when the path differs', async () => {
    const host = io({ answers: [healthy({ releasePath: '/rel/somewhere-else' })] });
    await expect(driveRestart(TARGET, host)).resolves.toMatchObject({ outcome: 'completed' });
  });

  it('keeps waiting through a daemon that answers on the old release', async () => {
    const host = io({ answers: [healthy({ releasePath: '/rel/20260101-120000-aaaaaaaaaa', releaseSha: 'a'.repeat(40) }), healthy()] });
    await expect(driveRestart(TARGET, host)).resolves.toMatchObject({ outcome: 'completed' });
    expect(host.rollbacks).toEqual([]);
  });

  it('rolls back to previous and restarts again when the target never answers', async () => {
    const host = io({ answers: [] });
    const verdict = await driveRestart(TARGET, host);
    expect(verdict).toMatchObject({ outcome: 'rolled_back', to: '/rel/20260101-120000-aaaaaaaaaa' });
    expect(host.rollbacks).toEqual(['/rel/20260101-120000-aaaaaaaaaa']);
    expect(host.restarts).toBe(2);
    expect((verdict as { message: string }).message).toContain(TARGET.release);
  });

  it('does not roll back to a release that never answered ok', async () => {
    const host = io({ answers: [{ ok: false, version: null, releasePath: TARGET.release, releaseSha: TARGET.sha }] });
    await expect(driveRestart(TARGET, host)).resolves.toMatchObject({ outcome: 'rolled_back' });
  });

  it('reports that nothing can be done when there is no previous release', async () => {
    const host = io({ previousRelease: () => null });
    const verdict = await driveRestart(TARGET, host);
    expect(verdict).toMatchObject({ outcome: 'gone' });
    expect(host.rollbacks).toEqual([]);
    expect(host.restarts).toBe(1);
  });

  it('gives up only after the health deadline', async () => {
    const host = io();
    const started = host.clock;
    await driveRestart(TARGET, host);
    expect(host.clock - started).toBeGreaterThanOrEqual(HEALTH_DEADLINE_MS);
  });

  it('does not roll back once boot-time reconciliation has already recorded the upgrade completed (VS-115)', async () => {
    // The probe never answers ok, as if a transient hiccup were hiding an otherwise healthy daemon —
    // but reconciliation, a faster and more reliable in-process fact, got there first.
    let checks = 0;
    const host = io({ probe: async () => null, alreadyCompleted: async () => { checks += 1; return checks >= 2; } });
    const verdict = await driveRestart(TARGET, host);
    expect(verdict).toEqual({ outcome: 'completed', version: null });
    expect(host.rollbacks).toEqual([]);
    expect(host.restarts).toBe(1);
  });
});

describe('recordVerdict', () => {
  const seed = (): { db: Db; id: string } => {
    const db = new Db(':memory:');
    db.migrate();
    db.insert('upgrades', {
      id: 'u1', state: 'restarting', source: '/src', ref: 'main', requestedBy: 'op1',
      requestedAt: nowIso(), startedAt: nowIso(), toRelease: TARGET.release, toSha: TARGET.sha,
      logJson: [], backupsJson: [],
    });
    return { db, id: 'u1' };
  };

  it('completes the record with the version the daemon came back on', () => {
    const { db, id } = seed();
    recordVerdict(db, id, { outcome: 'completed', version: '1.1.0' });
    expect(db.get('SELECT * FROM upgrades WHERE id = ?', [id])).toMatchObject({ state: 'completed', cameBackVersion: '1.1.0', reason: null });
    db.close();
  });

  it('fails the record with restart_failed after a rollback', () => {
    const { db, id } = seed();
    const verdict: RunnerVerdict = { outcome: 'rolled_back', to: '/rel/old', message: 'no healthy daemon' };
    recordVerdict(db, id, verdict);
    expect(db.get('SELECT * FROM upgrades WHERE id = ?', [id])).toMatchObject({ state: 'failed', reason: 'restart_failed', message: 'no healthy daemon' });
    db.close();
  });

  it('fails the record with restart_unverified when there was nothing to roll back to', () => {
    const { db, id } = seed();
    recordVerdict(db, id, { outcome: 'gone', message: 'no previous release' });
    expect(db.get('SELECT * FROM upgrades WHERE id = ?', [id])).toMatchObject({ state: 'failed', reason: 'restart_unverified' });
    db.close();
  });

  it('leaves an already-terminal record unchanged (VS-115): reconciliation, or an earlier call, won already', () => {
    const { db, id } = seed();
    db.update('upgrades', id, { state: 'completed', finishedAt: nowIso(), cameBackVersion: '1.1.0' });
    recordVerdict(db, id, { outcome: 'rolled_back', to: '/rel/old', message: 'no healthy daemon' });
    expect(db.get('SELECT * FROM upgrades WHERE id = ?', [id])).toMatchObject({ state: 'completed', cameBackVersion: '1.1.0', reason: null });
    db.close();
  });
});
