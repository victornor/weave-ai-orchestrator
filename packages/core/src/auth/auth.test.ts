import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '@openconductor/db';
import { DaemonConfigSchema } from '@openconductor/shared';
import { createAuthService } from './index.js';
import type { AuthService } from '../api.js';

const require = createRequire(import.meta.url);
const { authenticator } = require('otplib') as typeof import('otplib');

describe('auth', () => {
  let dir: string;
  let db: Db;
  let auth: AuthService;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'oc-auth-'));
    db = openDb(join(dir, 'daemon.sqlite'));
    auth = createAuthService(db, DaemonConfigSchema.parse({ auth: { lockoutAttempts: 3, lockoutMinutes: 15 } }));
    await auth.setPassword('victor', 'correct horse battery');
  });
  afterEach(() => { try { db.close(); } catch { /* closed */ } rmSync(dir, { recursive: true, force: true }); });

  it('creates the operator and logs in with a hashed opaque token', async () => {
    expect(auth.hasOperator()).toBe(true);
    const res = await auth.login({ username: 'victor', password: 'correct horse battery', kind: 'cli', deviceName: 'laptop' });
    expect('token' in res).toBe(true);
    const { token, sessionId } = res as { token: string; sessionId: string };
    expect(token.length).toBeGreaterThan(30);
    expect(db.get<{ tokenHash: string }>('SELECT token_hash FROM auth_sessions WHERE id = ?', [sessionId])!.tokenHash).not.toContain(token);
    expect(auth.verify(token)).toMatchObject({ sessionId, kind: 'cli' });
    expect(auth.verify('nonsense')).toBeNull();
  });

  it('rejects the wrong password and locks the account after the configured failures', async () => {
    for (let i = 0; i < 3; i++) {
      await expect(auth.login({ username: 'victor', password: 'wrong', kind: 'web' })).rejects.toMatchObject({ code: 'auth_bad_credentials' });
    }
    await expect(auth.login({ username: 'victor', password: 'correct horse battery', kind: 'web' })).rejects.toMatchObject({ code: 'auth_locked' });
  });

  it('requires and verifies a TOTP code once enabled, and accepts a recovery code once', async () => {
    const setup = await auth.totpSetup();
    await auth.totpEnable(authenticator.generate(setup.secret));
    expect(auth.totpEnabled()).toBe(true);

    const pending = await auth.login({ username: 'victor', password: 'correct horse battery', kind: 'web' });
    expect(pending).toEqual({ totpRequired: true });

    await expect(auth.login({ username: 'victor', password: 'correct horse battery', kind: 'web', totp: '000000' }))
      .rejects.toMatchObject({ code: 'auth_totp_invalid' });

    const ok = await auth.login({ username: 'victor', password: 'correct horse battery', kind: 'web', totp: authenticator.generate(setup.secret) });
    expect('token' in ok).toBe(true);

    const code = setup.recoveryCodes[0]!;
    expect('token' in await auth.login({ username: 'victor', password: 'correct horse battery', kind: 'web', totp: code })).toBe(true);
    await expect(auth.login({ username: 'victor', password: 'correct horse battery', kind: 'web', totp: code }))
      .rejects.toMatchObject({ code: 'auth_totp_invalid' });
  });

  it('revokes sessions individually and in bulk', async () => {
    const a = await auth.login({ username: 'victor', password: 'correct horse battery', kind: 'cli', deviceName: 'a' }) as { token: string; sessionId: string };
    const b = await auth.login({ username: 'victor', password: 'correct horse battery', kind: 'cli', deviceName: 'b' }) as { token: string; sessionId: string };
    auth.logout(a.sessionId);
    expect(auth.verify(a.token)).toBeNull();
    expect(auth.verify(b.token)).not.toBeNull();
    expect(auth.sessions()).toHaveLength(2);
    expect(auth.revokeAll(b.sessionId)).toBe(0);   // only a was still open and it is already revoked
    expect(auth.verify(b.token)).not.toBeNull();
    expect(auth.revokeAll()).toBe(1);
    expect(auth.verify(b.token)).toBeNull();
  });

  it('changes the password, refusing the wrong current one, and revokes every session', async () => {
    const s = await auth.login({ username: 'victor', password: 'correct horse battery', kind: 'web' }) as { token: string };
    await expect(auth.changePassword('nope', 'new password 123')).rejects.toMatchObject({ code: 'auth_bad_credentials' });
    await auth.changePassword('correct horse battery', 'new password 123');
    expect(auth.verify(s.token)).toBeNull();
    expect('token' in await auth.login({ username: 'victor', password: 'new password 123', kind: 'web' })).toBe(true);
  });

  it('gives unnamed browser sessions a shorter expiry than named devices', async () => {
    const web = await auth.login({ username: 'victor', password: 'correct horse battery', kind: 'web' }) as { expiresAt: string };
    const cli = await auth.login({ username: 'victor', password: 'correct horse battery', kind: 'cli', deviceName: 'laptop' }) as { expiresAt: string };
    expect(new Date(web.expiresAt).getTime()).toBeLessThan(new Date(cli.expiresAt).getTime());
  });

  it('stores the TOTP secret encrypted, never in the clear', async () => {
    const setup = await auth.totpSetup();
    const row = db.get<{ totpSecretEnc: string }>('SELECT totp_secret_enc FROM operator')!;
    expect(row.totpSecretEnc).not.toContain(setup.secret);
    expect(row.totpSecretEnc.split('.')).toHaveLength(3);
  });
});
