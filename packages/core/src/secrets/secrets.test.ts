import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeHarness } from '../testing/context.js';

const actor = { kind: 'human' as const, id: 'op1' };
/** Not a credential of any kind, and long enough that the run redactor would take it seriously. */
const FAKE = 'cf-not-a-real-token-0000000000';

describe('secrets', () => {
  it('round-trips a value and reports it as held', () => {
    const h = makeHarness();
    const secrets = h.services.secrets!;
    expect(secrets.put(actor, { name: 'CF_READONLY_TOKEN' }, FAKE)).toMatchObject({
      name: 'CF_READONLY_TOKEN', envVarName: 'CF_READONLY_TOKEN', scope: 'workspace', hasValue: true,
    });
    expect(secrets.value('CF_READONLY_TOKEN')).toBe(FAKE);
    expect(secrets.has('CF_READONLY_TOKEN')).toBe(true);
    expect(secrets.list()).toEqual([{ name: 'CF_READONLY_TOKEN', envVarName: 'CF_READONLY_TOKEN', scope: 'workspace', scopeId: null, hasValue: true }]);
    h.cleanup();
  });

  it('exposes a name under a different environment variable when asked', () => {
    const h = makeHarness();
    h.services.secrets!.put(actor, { name: 'cloudflare-read', envVarName: 'CF_TOKEN' }, FAKE);
    expect(h.services.secrets!.list()[0]).toMatchObject({ name: 'cloudflare-read', envVarName: 'CF_TOKEN' });
    expect(h.services.secrets!.value('cloudflare-read')).toBe(FAKE);
    h.cleanup();
  });

  it('replaces the value on a second registration, keeping one row', () => {
    const h = makeHarness();
    h.services.secrets!.put(actor, { name: 'API_KEY' }, FAKE);
    h.services.secrets!.put(actor, { name: 'API_KEY' }, `${FAKE}-rotated`);
    expect(h.services.secrets!.value('API_KEY')).toBe(`${FAKE}-rotated`);
    expect(h.services.secrets!.list()).toHaveLength(1);
    expect(h.db.all('SELECT id FROM secrets')).toHaveLength(1);
    h.cleanup();
  });

  // PLAN §21 and the whole point of the file store: the value is not in the database, so a copy of
  // `db.sqlite` — a backup, an export, an upgrade snapshot — carries no credential.
  it('keeps the value out of every table of the database', () => {
    const h = makeHarness();
    h.services.secrets!.put(actor, { name: 'CF_READONLY_TOKEN' }, FAKE);
    const tables = h.db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
    for (const table of tables) {
      const dump = JSON.stringify(h.db.all(`SELECT * FROM "${table}"`));
      expect(dump, `${table} carries the secret value`).not.toContain(FAKE);
    }
    // Nor is it in plaintext in the file that does hold it.
    expect(readFileSync(h.ctx.paths.secretsFile, 'utf8')).not.toContain(FAKE);
    h.cleanup();
  });

  it('writes the store and its key readable only by the daemon account', () => {
    const h = makeHarness();
    h.services.secrets!.put(actor, { name: 'API_KEY' }, FAKE);
    expect(statSync(h.ctx.paths.secretsFile).mode & 0o777).toBe(0o600);
    expect(statSync(h.ctx.paths.secretsKey).mode & 0o777).toBe(0o600);
    h.cleanup();
  });

  it('refuses a name that cannot be an environment variable and is given no envVarName', () => {
    const h = makeHarness();
    expect(() => h.services.secrets!.put(actor, { name: 'cloudflare read' }, FAKE)).toThrow(/environment variable name/);
    expect(() => h.services.secrets!.put(actor, { name: '' }, FAKE)).toThrow(/needs a name/);
    expect(() => h.services.secrets!.put(actor, { name: 'OK_NAME' }, '')).toThrow(/no value/);
    expect(h.services.secrets!.list()).toEqual([]);
    h.cleanup();
  });

  it('reports an unregistered name as absent rather than throwing', () => {
    const h = makeHarness();
    expect(h.services.secrets!.has('NOPE')).toBe(false);
    expect(h.services.secrets!.value('NOPE')).toBeNull();
    h.cleanup();
  });

  it('records the registration without the value', () => {
    const h = makeHarness();
    h.services.secrets!.put(actor, { name: 'CF_READONLY_TOKEN' }, FAKE);
    const rows = h.db.all<{ action: string; details: Record<string, unknown> }>("SELECT action, details_json FROM activity WHERE action = 'secret.put'");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.details).toMatchObject({ name: 'CF_READONLY_TOKEN', envVarName: 'CF_READONLY_TOKEN', replaced: false });
    expect(JSON.stringify(rows[0])).not.toContain(FAKE);
    h.cleanup();
  });

  // A workspace whose store file was corrupted still starts; the next write repairs it rather than
  // taking the daemon down on a file nobody can read anyway.
  it('treats an unreadable store as empty and repairs it on the next write', () => {
    const h = makeHarness();
    h.services.secrets!.put(actor, { name: 'API_KEY' }, FAKE);
    writeFileSync(h.ctx.paths.secretsFile, 'not json at all', 'utf8');
    expect(h.services.secrets!.value('API_KEY')).toBeNull();
    h.services.secrets!.put(actor, { name: 'API_KEY' }, FAKE);
    expect(h.services.secrets!.value('API_KEY')).toBe(FAKE);
    h.cleanup();
  });

  it('creates no files until something is registered', () => {
    const h = makeHarness();
    expect(existsSync(h.ctx.paths.secretsFile)).toBe(false);
    expect(existsSync(h.ctx.paths.secretsKey)).toBe(false);
    expect(h.services.secrets!.list()).toEqual([]);
    h.cleanup();
  });

  it('clears a registered value: gone from the store, the row, and has()', () => {
    const h = makeHarness();
    h.services.secrets!.put(actor, { name: 'API_KEY' }, FAKE);
    h.services.secrets!.clear(actor, 'API_KEY');
    expect(h.services.secrets!.has('API_KEY')).toBe(false);
    expect(h.services.secrets!.value('API_KEY')).toBeNull();
    expect(h.db.all('SELECT id FROM secrets')).toHaveLength(0);
    h.cleanup();
  });

  it('clearing an unregistered name does not throw and leaves other secrets untouched', () => {
    const h = makeHarness();
    h.services.secrets!.put(actor, { name: 'API_KEY' }, FAKE);
    expect(() => h.services.secrets!.clear(actor, 'NOPE')).not.toThrow();
    expect(h.services.secrets!.value('API_KEY')).toBe(FAKE);
    h.cleanup();
  });

  it('records the clear without the value', () => {
    const h = makeHarness();
    h.services.secrets!.put(actor, { name: 'API_KEY' }, FAKE);
    h.services.secrets!.clear(actor, 'API_KEY');
    const rows = h.db.all<{ action: string; details: Record<string, unknown> }>("SELECT action, details_json FROM activity WHERE action = 'secret.cleared'");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.details).toMatchObject({ name: 'API_KEY' });
    expect(JSON.stringify(rows[0])).not.toContain(FAKE);
    h.cleanup();
  });
});
