import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { daemonSecretStore, resolveScopedSecret, DAEMON_SECRETS_FILE } from './daemon.js';

const dirs: string[] = [];
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'ws-dsec-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('daemon secret store', () => {
  it('has no store without a config directory', () => expect(daemonSecretStore('')).toBeNull());

  it('holds a value encrypted on disk, in its own file pair', () => {
    const dir = scratch();
    const store = daemonSecretStore(dir)!;
    store.put('WEAVE_LLM_X_KEY', 'sk-very-secret');
    expect(store.get('WEAVE_LLM_X_KEY')).toBe('sk-very-secret');
    expect(readFileSync(join(dir, DAEMON_SECRETS_FILE), 'utf8')).not.toContain('sk-very-secret');
    expect(readdirSync(dir).sort()).toEqual(['daemon-secrets.enc', 'daemon-secrets.key']);
  });

  it('finds a daemon value when the workspace holds none', () => {
    const store = daemonSecretStore(scratch())!;
    store.put('K', 'daemon-value');
    expect(resolveScopedSecret(() => null, store, 'K')).toBe('daemon-value');
  });

  it('the workspace value wins over the daemon one', () => {
    const store = daemonSecretStore(scratch())!;
    store.put('K', 'daemon-value');
    expect(resolveScopedSecret((n) => (n === 'K' ? 'ws-value' : null), store, 'K')).toBe('ws-value');
  });

  it('resolves nothing when neither holds the name', () => {
    expect(resolveScopedSecret(() => null, daemonSecretStore(scratch()), 'NOPE')).toBeNull();
    expect(resolveScopedSecret(() => null, null, 'NOPE')).toBeNull();
  });
});
