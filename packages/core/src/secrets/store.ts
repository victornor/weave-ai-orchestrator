/**
 * The encrypted file behind `SecretsService` (VS-92).
 *
 * `PLAN.md §21` is unambiguous: a secret's value is never in the database. The daemon-level
 * `auth_enc_key` pattern is no help either — it keeps the key in the same file as the ciphertext,
 * so one copy of `db.sqlite` carries both. So the values live in the workspace's own state
 * directory: `secrets.enc` holds `name → {iv, tag, body}` under AES-256-GCM, and `secrets.key`
 * holds the 32 random bytes that open it. Both are `0600`, set with an explicit `chmod` after the
 * write because the process umask cannot be trusted.
 *
 * The encryption does not defeat anyone who already has the daemon's account, and is not meant to.
 * It means a copied state directory, a stray backup or a mis-scoped rsync yields a file that is
 * useless without the key beside it — and that the value never sits in plaintext next to
 * `db.sqlite`, which is the file everything in this system is used to copying.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const MODE = 0o600;

interface Sealed { iv: string; tag: string; body: string }

/** Write `0600` and mean it: create with the mode, then chmod, because an existing file keeps its own. */
function writePrivate(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, body, { encoding: 'utf8', mode: MODE });
  chmodSync(tmp, MODE);
  renameSync(tmp, path);
  chmodSync(path, MODE);
}

/** The workspace's 32-byte store key, created on first use. */
function key(keyPath: string): Buffer {
  if (existsSync(keyPath)) {
    const raw = Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64');
    if (raw.length === 32) return raw;
  }
  const fresh = randomBytes(32);
  writePrivate(keyPath, fresh.toString('base64'));
  return fresh;
}

function seal(k: Buffer, plain: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), body: body.toString('base64') };
}

function open(k: Buffer, s: Sealed): string | null {
  try {
    const d = createDecipheriv('aes-256-gcm', k, Buffer.from(s.iv, 'base64'));
    d.setAuthTag(Buffer.from(s.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(s.body, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** A store that cannot be read is an empty one: a workspace with a corrupt file still starts, and the next write repairs it. */
function load(path: string): Record<string, Sealed> {
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, Sealed>) : {};
  } catch {
    return {};
  }
}

export interface SecretStore {
  put(name: string, value: string): void;
  get(name: string): string | null;
  has(name: string): boolean;
  names(): string[];
  clear(name: string): void;
}

export function createSecretStore(paths: { secretsFile: string; secretsKey: string }): SecretStore {
  return {
    put(name, value) {
      const all = load(paths.secretsFile);
      all[name] = seal(key(paths.secretsKey), value);
      writePrivate(paths.secretsFile, JSON.stringify(all));
    },
    get(name) {
      const sealed = load(paths.secretsFile)[name];
      if (!sealed || !existsSync(paths.secretsKey)) return null;
      return open(key(paths.secretsKey), sealed);
    },
    has(name) {
      return load(paths.secretsFile)[name] !== undefined;
    },
    names() {
      return Object.keys(load(paths.secretsFile));
    },
    clear(name) {
      const all = load(paths.secretsFile);
      if (!(name in all)) return;
      delete all[name];
      writePrivate(paths.secretsFile, JSON.stringify(all));
    },
  };
}
