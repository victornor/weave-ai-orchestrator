import { createDecipheriv } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A read-only opener for a workspace's `secrets.enc` / `secrets.key` (the daemon's `createSecretStore`,
 * AES-256-GCM with `{iv, tag, body}` per name). The REPL never writes a secret, and reading one does not
 * need the daemon, so this duplicates only the decrypt half; a test in `packages/server` opens a file
 * the real store wrote, so a change to that format fails there.
 */
export function openWorkspaceSecret(stateDir: string, name: string): string | null {
  const file = join(stateDir, 'secrets.enc');
  const keyFile = join(stateDir, 'secrets.key');
  if (!existsSync(file) || !existsSync(keyFile)) return null;
  try {
    const all = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { iv?: string; tag?: string; body?: string } | undefined>;
    const sealed = all[name];
    if (!sealed?.iv || !sealed.tag || !sealed.body) return null;
    const key = Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64');
    if (key.length !== 32) return null;
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
    d.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(sealed.body, 'base64')), d.final()]).toString('utf8');
  } catch { return null; }
}
