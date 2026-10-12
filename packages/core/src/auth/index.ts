import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { hash as argonHash, verify as argonVerify, type Algorithm } from '@node-rs/argon2';
import { newId, nowIso, openDb, type Db } from '@weave-ai/db';
import { OcError, type AuthSessionKind, type DaemonConfig } from '@weave-ai/shared';
import type { AuthService } from '../api.js';

const require = createRequire(import.meta.url);
const { authenticator } = require('otplib') as typeof import('otplib');

// Algorithm.Argon2id === 2; the enum is a const enum, which isolatedModules forbids importing as a value.
const ARGON: Parameters<typeof argonHash>[1] = { algorithm: 2 as Algorithm, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const DAEMON_DB_FILE = 'daemon.sqlite';

/** The daemon-level database (operator, auth_sessions, login_attempts). Same schema file as a workspace db; only the auth tables are used. */
export function openDaemonDb(configDir: string): Db {
  return openDb(join(configDir, DAEMON_DB_FILE));
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
const newToken = (): string => randomBytes(32).toString('base64url');

function encKey(db: Db): Buffer {
  let row = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'auth_enc_key'");
  if (!row) {
    db.run('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)', ['auth_enc_key', randomBytes(32).toString('base64')]);
    row = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'auth_enc_key'")!;
  }
  return Buffer.from(row.value, 'base64');
}

function encrypt(db: Db, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey(db), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${body.toString('base64')}`;
}

function decrypt(db: Db, blob: string): string | null {
  const [ivB64, tagB64, bodyB64] = blob.split('.');
  if (!ivB64 || !tagB64 || !bodyB64) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', encKey(db), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(bodyB64, 'base64')), decipher.final()]).toString('utf8');
  } catch { return null; }
}

function constantEquals(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

interface OperatorRow { id: string; username: string; passwordHash: string; totpSecretEnc: string | null; recoveryCodes: string[] | null; createdAt: string; updatedAt: string }
interface SessionRow { id: string; operatorId: string; tokenHash: string; kind: AuthSessionKind; deviceName: string | null; createdAt: string; lastSeenAt: string; expiresAt: string; revokedAt: string | null; ip: string | null; userAgent: string | null }

/** PLAN §4.4 / §19: one operator per daemon, many devices, argon2id + opaque hashed tokens, optional TOTP, lockout. */
export function createAuthService(db: Db, cfg: DaemonConfig): AuthService {
  const auth = cfg.auth ?? { lockoutAttempts: 5, lockoutMinutes: 15, sessionDaysNamed: 30, sessionHoursUnnamed: 12, loopbackTrusted: false };

  const operator = (): OperatorRow | null => db.get<OperatorRow>('SELECT * FROM operator ORDER BY created_at LIMIT 1') ?? null;

  const recordAttempt = (username: string, ip: string | null, ok: boolean): void => {
    db.run('INSERT INTO login_attempts (username, ip, ok, created_at) VALUES (?,?,?,?)', [username, ip, ok ? 1 : 0, nowIso()]);
  };

  const locked = (username: string): boolean => {
    const since = new Date(Date.now() - (auth.lockoutMinutes ?? 15) * 60_000).toISOString();
    const lastOk = db.get<{ createdAt: string }>('SELECT created_at FROM login_attempts WHERE username = ? AND ok = 1 ORDER BY created_at DESC LIMIT 1', [username]);
    const failures = db.get<{ n: number }>(
      'SELECT COUNT(*) n FROM login_attempts WHERE username = ? AND ok = 0 AND created_at > ? AND created_at > ?',
      [username, since, lastOk?.createdAt ?? ''],
    )?.n ?? 0;
    return failures >= (auth.lockoutAttempts ?? 5);
  };

  const expiryFor = (kind: AuthSessionKind, deviceName?: string): string => {
    const named = kind !== 'web' || !!deviceName;
    const ms = named ? (auth.sessionDaysNamed ?? 30) * 86_400_000 : (auth.sessionHoursUnnamed ?? 12) * 3_600_000;
    return new Date(Date.now() + ms).toISOString();
  };

  const service: AuthService = {
    hasOperator(): boolean { return !!operator(); },

    async setPassword(username: string, password: string): Promise<void> {
      if (password.length < 8) throw new OcError('validation', 'password must be at least 8 characters');
      const existing = operator();
      const passwordHash = await argonHash(password, ARGON);
      const now = nowIso();
      if (existing) db.update('operator', existing.id, { username, passwordHash, updatedAt: now });
      else db.insert('operator', { id: newId(), username, passwordHash, totpSecretEnc: null, recoveryCodesJson: [], createdAt: now, updatedAt: now });
    },

    async login(input): Promise<{ token: string; sessionId: string; expiresAt: string } | { totpRequired: true }> {
      const op = operator();
      if (!op) throw new OcError('auth_bad_credentials', 'no operator account has been created');
      if (locked(op.username)) throw new OcError('auth_locked', `too many failed attempts; try again in ${auth.lockoutMinutes ?? 15} minutes`);
      const ok = input.username === op.username && await argonVerify(op.passwordHash, input.password, ARGON).catch(() => false);
      if (!ok) { recordAttempt(input.username, input.ip ?? null, false); throw new OcError('auth_bad_credentials', 'wrong username or password'); }

      if (op.totpSecretEnc) {
        if (!input.totp) return { totpRequired: true };
        const secret = decrypt(db, op.totpSecretEnc);
        const codeOk = !!secret && authenticator.check(input.totp.replace(/\s+/g, ''), secret);
        const recoveryOk = !codeOk && useRecoveryCode(op, input.totp);
        if (!codeOk && !recoveryOk) { recordAttempt(input.username, input.ip ?? null, false); throw new OcError('auth_totp_invalid', 'invalid authentication code'); }
      }

      recordAttempt(input.username, input.ip ?? null, true);
      const token = newToken();
      const id = newId();
      const now = nowIso();
      const expiresAt = expiryFor(input.kind, input.deviceName);
      db.insert('auth_sessions', {
        id, operatorId: op.id, tokenHash: sha256(token), kind: input.kind, deviceName: input.deviceName ?? null,
        createdAt: now, lastSeenAt: now, expiresAt, ip: input.ip ?? null, userAgent: input.userAgent ?? null,
      });
      return { token, sessionId: id, expiresAt };
    },

    verify(token: string): { sessionId: string; operatorId: string; kind: AuthSessionKind; expiresAt: string } | null {
      if (!token) return null;
      const row = db.get<SessionRow>('SELECT * FROM auth_sessions WHERE token_hash = ?', [sha256(token)]);
      if (!row || row.revokedAt) return null;
      if (new Date(row.expiresAt).getTime() < Date.now()) return null;
      const now = nowIso();
      const expiresAt = expiryFor(row.kind, row.deviceName ?? undefined);
      db.update('auth_sessions', row.id, { lastSeenAt: now, expiresAt });
      return { sessionId: row.id, operatorId: row.operatorId, kind: row.kind, expiresAt };
    },

    logout(sessionId: string): void { service.revoke(sessionId); },

    sessions() {
      return db.all<{ id: string; kind: string; deviceName: string | null; createdAt: string; lastSeenAt: string; expiresAt: string; ip: string | null; revokedAt: string | null }>(
        'SELECT id, kind, device_name, created_at, last_seen_at, expires_at, ip, revoked_at FROM auth_sessions ORDER BY created_at DESC',
      );
    },

    revoke(sessionId: string): void { db.update('auth_sessions', sessionId, { revokedAt: nowIso() }); },

    revokeAll(exceptSessionId?: string): number {
      return db.run('UPDATE auth_sessions SET revoked_at = ? WHERE revoked_at IS NULL AND id != ?', [nowIso(), exceptSessionId ?? '']).changes;
    },

    async totpSetup(): Promise<{ secret: string; otpauthUrl: string; recoveryCodes: string[] }> {
      const op = operator();
      if (!op) throw new OcError('not_found', 'no operator account');
      const secret = authenticator.generateSecret();
      const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(5).toString('hex'));
      db.update('operator', op.id, {
        totpSecretEnc: encrypt(db, secret),
        recoveryCodesJson: recoveryCodes.map((c) => sha256(c)),
        updatedAt: nowIso(),
      });
      // Not enabled until totpEnable() confirms a code from the authenticator app.
      db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['auth_totp_pending', '1']);
      return { secret, otpauthUrl: authenticator.keyuri(op.username, 'Weave AI', secret), recoveryCodes };
    },

    async totpEnable(code: string): Promise<void> {
      const op = operator();
      if (!op?.totpSecretEnc) throw new OcError('validation', 'call totpSetup() first');
      const secret = decrypt(db, op.totpSecretEnc);
      if (!secret || !authenticator.check(code.replace(/\s+/g, ''), secret)) throw new OcError('auth_totp_invalid', 'that code did not match');
      db.run("DELETE FROM meta WHERE key = 'auth_totp_pending'");
    },

    async totpDisable(): Promise<void> {
      const op = operator();
      if (!op) return;
      db.update('operator', op.id, { totpSecretEnc: null, recoveryCodesJson: [], updatedAt: nowIso() });
      db.run("DELETE FROM meta WHERE key = 'auth_totp_pending'");
    },

    totpEnabled(): boolean {
      const op = operator();
      const pending = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'auth_totp_pending'");
      return !!op?.totpSecretEnc && !pending;
    },

    async verifyPassword(password: string): Promise<boolean> {
      const op = operator();
      if (!op) return false;
      return argonVerify(op.passwordHash, password, ARGON).catch(() => false);
    },

    async changePassword(current: string, next: string): Promise<void> {
      const op = operator();
      if (!op) throw new OcError('not_found', 'no operator account');
      const ok = await argonVerify(op.passwordHash, current, ARGON).catch(() => false);
      if (!ok) throw new OcError('auth_bad_credentials', 'the current password is wrong');
      if (next.length < 8) throw new OcError('validation', 'password must be at least 8 characters');
      db.update('operator', op.id, { passwordHash: await argonHash(next, ARGON), updatedAt: nowIso() });
      service.revokeAll();
    },
  };

  function useRecoveryCode(op: OperatorRow, code: string): boolean {
    const codes = Array.isArray(op.recoveryCodes) ? op.recoveryCodes : [];
    const hashed = sha256(code.replace(/\s+/g, '').toLowerCase());
    const match = codes.find((c) => constantEquals(c, hashed));
    if (!match) return false;
    db.update('operator', op.id, { recoveryCodesJson: codes.filter((c) => c !== match), updatedAt: nowIso() });
    return true;
  }

  return service;
}
