/**
 * VS-633: the daemon's own secret store — provider keys and MCP `${NAME}` values entered once in
 * the daemon settings, visible to every workspace. The same encrypted AES-256-GCM `0600` shape as a
 * workspace's and as `push-vapid.enc`, in its own file pair beside them: the VAPID pair holds a
 * signing key no admin route should be able to reach, so it is not reused.
 *
 * A name resolves from the workspace store first, then this one, so a workspace can override a
 * daemon value by holding a secret of the same name. No route returns a value.
 */
import { join } from 'node:path';
import { createSecretStore, type SecretStore } from './store.js';

export const DAEMON_SECRETS_FILE = 'daemon-secrets.enc';
export const DAEMON_SECRETS_KEY = 'daemon-secrets.key';

/** The daemon store for a config directory. An empty directory (a bare test context) means none. */
export function daemonSecretStore(configDir: string): SecretStore | null {
  if (!configDir) return null;
  return createSecretStore({ secretsFile: join(configDir, DAEMON_SECRETS_FILE), secretsKey: join(configDir, DAEMON_SECRETS_KEY) });
}

/** A value from the workspace store, else the daemon store, else null. */
export function resolveScopedSecret(workspace: (name: string) => string | null, daemon: SecretStore | null, name: string): string | null {
  return workspace(name) ?? daemon?.get(name) ?? null;
}
