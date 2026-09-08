/**
 * Workspace secrets (VS-92). The `secrets` table has existed since 0001_init and has never had a
 * writer: it holds a name, the environment variable it is exposed as, and a scope — never a value.
 * This service is that writer, and the encrypted file beside it (`store.ts`) is where the values go.
 *
 * `value()` is the whole reason the rest exists, and is deliberately reachable from nowhere but the
 * daemon's own `roleSecretsEnv`: no route, no `ac_*` tool and no event returns a value.
 */
import { newId, type Db } from '@agent-conductor/db';
import { OcError, type WorkspaceSecret } from '@agent-conductor/shared';
import type { Actor, SecretsService } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { recordActivity } from '../events.js';
import { createSecretStore, type SecretStore } from './store.js';

/** What a POSIX shell will carry, and what `roleSecretsEnv` puts in a child's environment. */
const ENV_VAR = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

interface SecretRow { id: string; name: string; envVarName: string; scope: string; scopeId: string | null }

export function createSecretsService(ctx: WorkspaceContext, store: SecretStore = createSecretStore(ctx.paths)): SecretsService {
  const db: Db = ctx.db;
  const ws = ctx.workspaceId;

  function row(name: string): SecretRow | undefined {
    return db.get<SecretRow>('SELECT id, name, env_var_name, scope, scope_id FROM secrets WHERE workspace_id = ? AND name = ?', [ws, name]);
  }

  return {
    put(actor: Actor, input, value: string): WorkspaceSecret {
      const name = input.name.trim();
      if (!name) throw new OcError('validation', 'a secret needs a name');
      const envVarName = (input.envVarName ?? name).trim();
      if (!ENV_VAR.test(envVarName)) {
        throw new OcError('validation', `"${envVarName}" cannot be an environment variable name; give the secret an envVarName that can`);
      }
      if (!value) throw new OcError('validation', `secret ${name} was given no value`);

      // The file first: a row claiming a value the store does not hold is the one state that would
      // let a role list a secret its workers silently never get.
      store.put(name, value);
      const existing = row(name);
      if (existing) db.update('secrets', existing.id, { envVarName, scope: input.scope ?? existing.scope, scopeId: input.scopeId ?? existing.scopeId });
      else db.insert('secrets', { id: newId(), workspaceId: ws, name, envVarName, scope: input.scope ?? 'workspace', scopeId: input.scopeId ?? null });

      // The name and where it came from, never the value.
      recordActivity(db, ws, actor, 'secret.put', 'secret', row(name)!.id, { name, envVarName, replaced: existing !== undefined });
      return { name, envVarName, scope: (input.scope ?? existing?.scope ?? 'workspace') as WorkspaceSecret['scope'], scopeId: input.scopeId ?? existing?.scopeId ?? null, hasValue: true };
    },

    list(): WorkspaceSecret[] {
      return db
        .all<SecretRow>('SELECT id, name, env_var_name, scope, scope_id FROM secrets WHERE workspace_id = ? ORDER BY name', [ws])
        .map((r) => ({ name: r.name, envVarName: r.envVarName, scope: r.scope as WorkspaceSecret['scope'], scopeId: r.scopeId, hasValue: store.has(r.name) }));
    },

    has(name: string): boolean {
      return row(name) !== undefined;
    },

    value(name: string): string | null {
      return store.get(name);
    },

    clear(actor: Actor, name: string): void {
      const existing = row(name);
      store.clear(name);
      if (!existing) return;
      db.run('DELETE FROM secrets WHERE id = ?', [existing.id]);
      recordActivity(db, ws, actor, 'secret.cleared', 'secret', existing.id, { name });
    },
  };
}

export { createSecretStore, type SecretStore } from './store.js';
