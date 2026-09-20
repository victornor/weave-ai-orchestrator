import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { FakeRuntime } from '@weave-ai/runtime-sdk';
import { NAMED_CARD_OPTION_KEYS, type RoleSpec } from '@weave-ai/shared';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createRolesService, readRoleSpec } from './index.js';
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

  it('hires a role: files on disk, pending_activation, a hire_approval decision that offers no runtime', async () => {
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
    // Approve or decline and nothing else: a role carries no runtime since VS-77, so there is no
    // "approve, but run on codex" to offer.
    expect(options).toEqual(Object.values(NAMED_CARD_OPTION_KEYS.hire_approval));
    expect(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM role_revisions WHERE role_id = ?', ['api-backend'])!.n).toBe(1);
  });

  it('writes role.yaml under the legacy createdBy spelling, and reads it back as weaver (VS-263 Decision 6)', async () => {
    await roles.hire(CONDUCTOR, spec({ createdBy: 'weaver' }));
    const raw = readFileSync(join(h.ctx.paths.roles, 'api-backend', 'role.yaml'), 'utf8');
    expect(raw).toContain('createdBy: conductor');
    expect(raw).not.toContain('createdBy: weaver');
    expect(readRoleSpec(h.ctx, 'api-backend')?.createdBy).toBe('weaver');
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

  it('activates without choosing anything, and the spec on disk names no runtime', async () => {
    await roles.hire(CONDUCTOR, spec());
    const role = await roles.activate(HUMAN, 'api-backend');
    expect(role.status).toBe('active');
    const yaml = YAML.parse(readFileSync(join(h.ctx.paths.roles, 'api-backend', 'role.yaml'), 'utf8')) as Record<string, unknown>;
    for (const key of ['runtime', 'model', 'effort']) expect(yaml).not.toHaveProperty(key);
  });

  it('records a revision on update and can roll it back', async () => {
    await roles.hire(CONDUCTOR, spec());
    const updated = await roles.update(CONDUCTOR, 'api-backend', { maxWorkers: 4, capabilities: ['node', 'postgres'] }, 'more parallelism');
    expect(updated.role.maxWorkers).toBe(4);
    expect(updated.role.specRevision).toBe(2);
    expect(updated.changedKeys.sort()).toEqual(['capabilities', 'maxWorkers']);
    const revs = roles.revisions('api-backend');
    expect(revs).toHaveLength(2);
    expect(revs[1]!.changedKeys.sort()).toEqual(['capabilities', 'maxWorkers']);

    const rolledBack = await roles.rollback(HUMAN, 'api-backend', 1);
    expect(rolledBack.maxWorkers).toBe(2);
    expect(roles.revisions('api-backend')).toHaveLength(3);
  });

  it('refuses a patch that tries to set a runtime, a model or an effort', async () => {
    await roles.hire(CONDUCTOR, spec());
    for (const key of ['runtime', 'model', 'effort']) {
      await expect(roles.update(HUMAN, 'api-backend', { [key]: 'codex' } as never, 'changed from the web app'))
        .rejects.toMatchObject({ code: 'validation' });
    }
    // Nothing was written on the way to being refused.
    expect(roles.revisions('api-backend')).toHaveLength(1);
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

  it('counts free slots against live workers in the project and pauses/resumes', async () => {
    h.ctx.config.defaults.hireApproval = 'none';
    const { role } = await roles.hire(CONDUCTOR, spec({ maxWorkers: 2 }));
    expect(roles.freeSlots(role.id)).toBe(4);
    h.addWorker(null, { roleId: role.id });
    expect(roles.freeSlots(role.id)).toBe(3);
    h.addWorker(null, { roleId: role.id, status: 'retired' });
    expect(roles.freeSlots(role.id)).toBe(3);

    expect(roles.pause(HUMAN, role.id, 'too expensive').status).toBe('paused');
    expect(roles.resume(HUMAN, role.id).status).toBe('active');
  });

  it('raises and lowers the stored worker limit as its own revision, without touching live workers', async () => {
    h.ctx.config.defaults.hireApproval = 'none';
    const { role } = await roles.hire(CONDUCTOR, spec({ maxWorkers: 2 }));
    const workers = [h.addWorker(null, { roleId: role.id }), h.addWorker(null, { roleId: role.id })];
    expect(roles.freeSlots(role.id)).toBe(2);

    await roles.update(HUMAN, role.id, { maxWorkers: 4 }, 'the queue is backing up');
    expect(roles.get(role.id).maxWorkers).toBe(4);
    expect(roles.freeSlots(role.id)).toBe(2);

    await roles.update(HUMAN, role.id, { maxWorkers: 1 }, 'too expensive');
    expect(roles.get(role.id).maxWorkers).toBe(1);
    expect(roles.freeSlots(role.id)).toBe(2);
    for (const id of workers) expect(h.db.get<{ status: string }>('SELECT status FROM agents WHERE id = ?', [id])?.status).toBe('active');

    const revisions = roles.revisions(role.id);
    expect(revisions.map((r) => r.reason)).toEqual(['hired', 'the queue is backing up', 'too expensive']);
    expect(revisions.at(-1)?.changedKeys).toEqual(['maxWorkers']);
    expect((await roles.rollback(HUMAN, role.id, 2)).maxWorkers).toBe(4);
  });

  it('reports the effective concurrency as the project limit, not the stored role max', async () => {
    h.ctx.config.defaults.hireApproval = 'none';
    const { role } = await roles.hire(CONDUCTOR, spec({ maxWorkers: 2 }));
    expect(roles.concurrency(role.id)).toMatchObject({ roleMax: 2, projectMax: 4, effective: 4, live: 0, free: 4 });

    h.addWorker(null, { roleId: role.id });
    expect(roles.concurrency(role.id)).toMatchObject({ effective: 4, live: 1, free: 3 });

    await roles.update(HUMAN, role.id, { maxWorkers: 8 }, 'raised past the project limit');
    expect(roles.concurrency(role.id)).toMatchObject({ roleMax: 8, projectMax: 4, effective: 4, live: 1, projectLive: 1, free: 3 });

    await roles.update(HUMAN, role.id, { maxWorkers: 1 }, 'lowered below the live count');
    h.addWorker(null, { roleId: role.id });
    expect(roles.concurrency(role.id)).toMatchObject({ roleMax: 1, effective: 4, live: 2, free: 2 });
  });

  it('asks the human before retiring a role that still has live workers', async () => {
    h.ctx.config.defaults.hireApproval = 'none';
    const { role } = await roles.hire(CONDUCTOR, spec());
    h.addWorker(null, { roleId: role.id });
    const withWorkers = await roles.retire(HUMAN, role.id, 'no longer needed');
    expect(withWorkers.decisionId).toBeTruthy();
    expect(roles.get(role.id).status).toBe('active');
    expect(created.at(-1)).toMatchObject({ kind: 'discard_approval', correlationKey: `retire:${role.id}` });
    // VS-111: the discard-approval card's Discard button sends the "go ahead" key — must be one of
    // these, not a hand-written literal that could drift from what the decision actually offers.
    const discardOptions = (created.at(-1)!.options as Array<{ key: string }>).map((o) => o.key);
    expect(discardOptions).toEqual(Object.values(NAMED_CARD_OPTION_KEYS.discard_approval));

    h.db.run('UPDATE agents SET status = ? WHERE role_id = ?', ['retired', role.id]);
    const clean = await roles.retire(HUMAN, role.id, 'no longer needed');
    expect(clean.decisionId).toBeNull();
    expect(roles.get(role.id).status).toBe('retired');
  });
  // VS-92: a secret an agent collected on a card, attached to the role whose workers need it.
  describe('setSecrets', () => {
    const FAKE = 'cf-not-a-real-token-0000000000';

    it('replaces the list when every name is registered', async () => {
      const { role } = await roles.hire(CONDUCTOR, spec(), { autoActivate: true });
      h.services.secrets!.put(HUMAN, { name: 'CF_READONLY_TOKEN' }, FAKE);
      h.services.secrets!.put(HUMAN, { name: 'API_KEY' }, FAKE);

      expect((await roles.setSecrets(CONDUCTOR, role.id, ['CF_READONLY_TOKEN', 'API_KEY'], 'cloudflare work')).secrets)
        .toEqual(['CF_READONLY_TOKEN', 'API_KEY']);
      // Replaces rather than appends.
      expect((await roles.setSecrets(CONDUCTOR, role.id, ['API_KEY'], 'no longer needs cloudflare')).secrets).toEqual(['API_KEY']);
    });

    it('refuses the whole list when one name is not registered, and changes nothing', async () => {
      const { role } = await roles.hire(CONDUCTOR, spec(), { autoActivate: true });
      h.services.secrets!.put(HUMAN, { name: 'API_KEY' }, FAKE);
      await roles.setSecrets(CONDUCTOR, role.id, ['API_KEY'], 'needs the key');

      await expect(roles.setSecrets(CONDUCTOR, role.id, ['API_KEY', 'NEVER_REGISTERED'], 'and one more'))
        .rejects.toThrow(/no secret registered under "NEVER_REGISTERED"/);
      expect(roles.get(role.id).secrets).toEqual(['API_KEY']);
    });

    it('records a revision the way any other spec change does', async () => {
      const { role } = await roles.hire(CONDUCTOR, spec(), { autoActivate: true });
      h.services.secrets!.put(HUMAN, { name: 'API_KEY' }, FAKE);
      await roles.setSecrets(CONDUCTOR, role.id, ['API_KEY'], 'needs the key');
      expect(roles.revisions(role.id).at(-1)).toMatchObject({ reason: 'needs the key', changedKeys: ['secrets'] });
    });
  });

  // VS-335: the tool-facing spec write — its refusals, the permission gate, charter sync and re-brief.
  describe('requestUpdate', () => {
    it('edits spec fields as one revision with the right changedKeys, and emits role.updated', async () => {
      await roles.hire(CONDUCTOR, spec());
      h.events.length = 0;
      const result = await roles.requestUpdate(CONDUCTOR, 'api-backend', { charterSummary: 'Owns billing now.', scope: 'Billing only.' }, 'the role changed');
      expect(result.applied).toBe(true);
      expect(result.decisionId).toBeNull();
      expect(result.changedKeys.sort()).toEqual(['charterSummary', 'scope']);
      expect(roles.get('api-backend').charterSummary).toBe('Owns billing now.');
      expect(roles.revisions('api-backend').at(-1)).toMatchObject({ reason: 'the role changed', changedKeys: ['charterSummary', 'scope'] });
      expect(h.events.some((e) => e.type === 'role.updated')).toBe(true);
    });

    it('refuses immutable, separately-owned, unknown and empty patches, writing nothing', async () => {
      await roles.hire(CONDUCTOR, spec());
      const revisions = roles.revisions('api-backend').length;
      const refused: Array<Record<string, unknown>> = [{ id: 'other' }, { project: 'other' }, { secrets: ['X'] }, { maxWorkers: 5 }, { nope: true }, {}];
      for (const patch of refused) {
        await expect(roles.requestUpdate(CONDUCTOR, 'api-backend', patch as never, 'nope')).rejects.toMatchObject({ code: 'validation' });
      }
      expect(roles.revisions('api-backend')).toHaveLength(revisions);
    });

    it('keeps a spec-rendered charter in sync and leaves a hand-written one alone', async () => {
      await roles.hire(CONDUCTOR, spec());
      const charterPath = join(h.ctx.paths.roles, 'api-backend', 'CHARTER.md');
      const rendered = await roles.requestUpdate(CONDUCTOR, 'api-backend', { charterSummary: 'A new summary.' }, 'refresh it');
      expect(rendered.charterRewritten).toBe(true);
      expect(readFileSync(charterPath, 'utf8')).toContain('A new summary.');

      await roles.updateCharter(CONDUCTOR, 'api-backend', '# Hand written\n', 'by hand');
      const kept = await roles.requestUpdate(CONDUCTOR, 'api-backend', { scope: 'New scope.' }, 'narrow it');
      expect(kept.charterRewritten).toBe(false);
      expect(readFileSync(charterPath, 'utf8')).toBe('# Hand written\n');
    });

    it('re-briefs a live worker when applyToRunning is set', async () => {
      await roles.hire(CONDUCTOR, spec(), { autoActivate: true });
      h.services.roles = roles;
      const workerId = h.addWorker(null, { roleId: 'api-backend' });
      const home = h.db.get<{ homePath: string }>('SELECT home_path AS homePath FROM agents WHERE id = ?', [workerId])!.homePath;

      const notAsked = await roles.requestUpdate(CONDUCTOR, 'api-backend', { scope: 'Scope A.' }, 'no re-brief');
      expect(notAsked.reBriefed).toBe(0);

      const asked = await roles.requestUpdate(CONDUCTOR, 'api-backend', { scope: 'Scope B.' }, 're-brief now', { applyToRunning: true });
      expect(asked.reBriefed).toBe(1);
      expect(readFileSync(join(home, 'AGENTS.md'), 'utf8')).toContain('Scope B.');
    });

    it('holds a permission change for the hire policy and applies it only when approved', async () => {
      await roles.hire(CONDUCTOR, spec(), { autoActivate: true });
      const result = await roles.requestUpdate(CONDUCTOR, 'api-backend', { scope: 'Same patch scope.', permission: { mode: 'restricted', allowed: [], denied: [], bashDeny: [] } }, 'tighten it');
      expect(result.applied).toBe(false);
      expect(result.decisionId).toBe('d1');
      const raised = created.at(-1)!;
      expect(raised).toMatchObject({ kind: 'hire_approval', correlationKey: 'role-permission:api-backend', target: { roleId: 'api-backend', permissionChange: true } });
      // Nothing applied yet — neither the permission nor the sibling scope field.
      expect(roles.get('api-backend').permission.mode).toBe('auto');
      expect(roles.get('api-backend').scopeText).toBe('Backend/API work in the api repo; not frontend, not infra.');

      // The decision-apply path writes the patch the card carried.
      const patch = (raised.target as { patch: Partial<RoleSpec> }).patch;
      await roles.update(CONDUCTOR, 'api-backend', patch, 'permission change approved');
      expect(roles.get('api-backend').permission.mode).toBe('restricted');
      expect(roles.get('api-backend').scopeText).toBe('Same patch scope.');
    });

    it('applies a permission change directly when hireApproval is none', async () => {
      h.ctx.config.defaults.hireApproval = 'none';
      await roles.hire(CONDUCTOR, spec(), { autoActivate: true });
      const result = await roles.requestUpdate(CONDUCTOR, 'api-backend', { permission: { mode: 'restricted', allowed: [], denied: [], bashDeny: [] } }, 'tighten it');
      expect(result.applied).toBe(true);
      expect(result.decisionId).toBeNull();
      expect(roles.get('api-backend').permission.mode).toBe('restricted');
    });
  });

  describe('worker memory limit (VS-579)', () => {
    it('persists a per-role limit to the row and role.yaml, and null means inherit', async () => {
      const { role } = await roles.hire(CONDUCTOR, spec({ memoryLimitMb: 3072 }));
      expect(role.memoryLimitMb).toBe(3072);
      expect(readRoleSpec(h.ctx, role.id)?.memoryLimitMb).toBe(3072);
      const yaml = YAML.parse(readFileSync(join(h.ctx.paths.roles, 'api-backend', 'role.yaml'), 'utf8')) as RoleSpec;
      expect(yaml.memoryLimitMb).toBe(3072);

      const raised = await roles.update(CONDUCTOR, role.id, { memoryLimitMb: 4096 }, 'raise the limit');
      expect(raised.role.memoryLimitMb).toBe(4096);

      const cleared = await roles.update(CONDUCTOR, role.id, { memoryLimitMb: null }, 'inherit again');
      expect(cleared.role.memoryLimitMb).toBeNull();
      expect(readRoleSpec(h.ctx, role.id)?.memoryLimitMb).toBeNull();
    });
  });
});
