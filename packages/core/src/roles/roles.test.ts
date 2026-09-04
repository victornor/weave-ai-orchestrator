import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { FakeRuntime } from '@openconductor/runtime-sdk';
import type { RoleSpec } from '@openconductor/shared';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createRolesService } from './index.js';
import type { Actor, RolesService } from '../api.js';

const CONDUCTOR: Actor = { kind: 'agent', id: 'conductor', runId: 'run-1' };
const HUMAN: Actor = { kind: 'human', id: 'victor' };

const spec = (over: Partial<RoleSpec> = {}): RoleSpec => ({
  id: 'api-backend', name: 'Backend Engineer', project: 'api',
  charterSummary: 'Owns the api service: handlers, persistence, migrations, tests.',
  scope: 'Backend/API work in the api repo; not frontend, not infra.',
  responsibilities: ['Design and implement HTTP handlers', 'Keep migrations reversible'],
  capabilities: ['node', 'sqlite'], exclusions: ['frontend'], rules: ['Always run the test suite'],
  runtime: 'claude', model: null, sessionPolicy: 'per_ticket', maxWorkers: 2,
  permission: { mode: 'auto', allowed: [], denied: [] }, secrets: [], createdBy: 'conductor',
  ...over,
} as RoleSpec);

describe('roles', () => {
  let h: TestHarness;
  let roles: RolesService;
  let created: Array<Record<string, unknown>>;

  beforeEach(() => {
    h = makeHarness();
    created = [];
    h.services.decisions = { create: vi.fn((_a, input: Record<string, unknown>) => { created.push(input); return { id: `d${created.length}` }; }) } as never;
    h.ctx.registries.runtimes.set('claude', new FakeRuntime());
    h.ctx.registries.runtimes.set('codex', new FakeRuntime());
    roles = createRolesService(h.ctx, h.deps);
    // the harness seeds one role already; remove it so ids are predictable
    h.db.run('DELETE FROM roles WHERE id = ?', [h.roleId]);
  });
  afterEach(() => h.cleanup());

  it('hires a role: files on disk, pending_activation, hire_approval decision with runtime options', async () => {
    const { role, decisionId } = await roles.hire(CONDUCTOR, spec());
    expect(role.status).toBe('pending_activation');
    expect(role.specRevision).toBe(1);
    expect(decisionId).toBe('d1');

    const dir = join(h.ctx.paths.roles, 'api-backend');
    expect(existsSync(join(dir, 'role.yaml'))).toBe(true);
    expect(existsSync(join(dir, 'CHARTER.md'))).toBe(true);
    const yaml = YAML.parse(readFileSync(join(dir, 'role.yaml'), 'utf8')) as RoleSpec;
    expect(yaml.charterSummary).toContain('Owns the api service');
    const charter = readFileSync(join(dir, 'CHARTER.md'), 'utf8');
    expect(charter).toContain('Backend Engineer');
    expect(charter).toContain('Design and implement HTTP handlers');

    expect(created[0]).toMatchObject({ kind: 'hire_approval', owner: 'human', correlationKey: 'hire:api-backend' });
    const options = (created[0]!.options as Array<{ key: string }>).map((o) => o.key);
    expect(options).toContain('approve');
    expect(options).toContain('reject');
    expect(options).toContain('runtime:codex');
    expect(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM role_revisions WHERE role_id = ?', ['api-backend'])!.n).toBe(1);
  });

  it('activates immediately when hireApproval is none', async () => {
    h.ctx.config.defaults.hireApproval = 'none';
    const { role, decisionId } = await roles.hire(CONDUCTOR, spec());
    expect(role.status).toBe('active');
    expect(decisionId).toBeNull();
    expect(created).toHaveLength(0);
  });

  it('rejects an invalid spec and a duplicate id', async () => {
    await expect(roles.hire(CONDUCTOR, spec({ charterSummary: '' }))).rejects.toMatchObject({ code: 'validation' });
    await expect(roles.hire(CONDUCTOR, spec({ project: 'nope' }))).rejects.toMatchObject({ code: 'not_found' });
    await roles.hire(CONDUCTOR, spec());
    await expect(roles.hire(CONDUCTOR, spec())).rejects.toMatchObject({ code: 'conflict' });
  });

  it('activates on a switched runtime and writes it back to role.yaml', async () => {
    await roles.hire(CONDUCTOR, spec());
    const role = await roles.activate(HUMAN, 'api-backend', { runtime: 'codex' });
    expect(role.status).toBe('active');
    expect(role.runtimeId).toBe('codex');
    const yaml = YAML.parse(readFileSync(join(h.ctx.paths.roles, 'api-backend', 'role.yaml'), 'utf8')) as RoleSpec;
    expect(yaml.runtime).toBe('codex');
  });

  it('records a revision on update and can roll it back', async () => {
    await roles.hire(CONDUCTOR, spec());
    const updated = await roles.update(CONDUCTOR, 'api-backend', { maxWorkers: 4, capabilities: ['node', 'postgres'] }, 'more parallelism');
    expect(updated.maxWorkers).toBe(4);
    expect(updated.specRevision).toBe(2);
    const revs = roles.revisions('api-backend');
    expect(revs).toHaveLength(2);
    expect(revs[1]!.changedKeys.sort()).toEqual(['capabilities', 'maxWorkers']);

    const rolledBack = await roles.rollback(HUMAN, 'api-backend', 1);
    expect(rolledBack.maxWorkers).toBe(2);
    expect(roles.revisions('api-backend')).toHaveLength(3);
  });

  it('updates the charter as its own revision and renders one on demand', async () => {
    await roles.hire(CONDUCTOR, spec());
    await roles.updateCharter(CONDUCTOR, 'api-backend', '# Charter\n\nBe careful with migrations.', 'repeated migration mistakes', { applyToRunning: true });
    expect(roles.charter('api-backend')).toContain('Be careful with migrations');
    expect(roles.get('api-backend').specRevision).toBe(2);

    // a deleted charter file is re-rendered from the spec instead of failing
    const { rmSync } = await import('node:fs');
    rmSync(join(h.ctx.paths.roles, 'api-backend', 'CHARTER.md'));
    expect(roles.charter('api-backend')).toContain('Backend Engineer');
  });

  it('counts free slots against live workers and pauses/resumes', async () => {
    h.ctx.config.defaults.hireApproval = 'none';
    const { role } = await roles.hire(CONDUCTOR, spec({ maxWorkers: 2 }));
    expect(roles.freeSlots(role.id)).toBe(2);
    h.addWorker(null, { roleId: role.id });
    expect(roles.freeSlots(role.id)).toBe(1);
    h.addWorker(null, { roleId: role.id, status: 'retired' });
    expect(roles.freeSlots(role.id)).toBe(1);

    expect(roles.pause(HUMAN, role.id, 'too expensive').status).toBe('paused');
    expect(roles.resume(HUMAN, role.id).status).toBe('active');
  });

  it('asks the human before retiring a role that still has live workers', async () => {
    h.ctx.config.defaults.hireApproval = 'none';
    const { role } = await roles.hire(CONDUCTOR, spec());
    h.addWorker(null, { roleId: role.id });
    const withWorkers = await roles.retire(HUMAN, role.id, 'no longer needed');
    expect(withWorkers.decisionId).toBeTruthy();
    expect(roles.get(role.id).status).toBe('active');
    expect(created.at(-1)).toMatchObject({ kind: 'discard_approval', correlationKey: `retire:${role.id}` });

    h.db.run('UPDATE agents SET status = ? WHERE role_id = ?', ['retired', role.id]);
    const clean = await roles.retire(HUMAN, role.id, 'no longer needed');
    expect(clean.decisionId).toBeNull();
    expect(roles.get(role.id).status).toBe('retired');
  });
});
