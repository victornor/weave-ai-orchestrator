/** `conductor login` / `logout` / `context` / `devices` — remote access (PLAN §4.4). */
import type { Command } from 'commander';
import { ApiClient, ApiError } from '../api.js';
import { currentContext, loadContexts, putContext, removeContext, suggestContextName, useContext } from '../contexts.js';
import { emit, fields, style, table, write } from '../output.js';
import { promptHidden, promptLine } from '../prompt.js';
import { applyCertPin, fetchCertPin } from '../tls.js';
import { globals, items, run, session } from './util.js';

interface LoginResponse { token?: string; sessionId?: string; expiresAt?: string; totpRequired?: boolean }

function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

export function register(program: Command): void {
  program
    .command('login')
    .argument('<url>', 'daemon url, e.g. https://conductor.example.com')
    .description('sign in to a daemon and store a named context')
    .option('-n, --name <name>', 'context name (defaults to the host)')
    .option('-u, --username <username>', 'operator username', 'operator')
    .option('--pin', 'pin the TLS certificate (self-signed daemons)')
    .option('--insecure', 'allow plaintext http to a non-loopback host')
    .option('--device <name>', 'device name shown in Settings -> Devices')
    .option('--password <password>', 'operator password (or set AC_PASSWORD); prompts when omitted')
    .option('--workspace-default <id>', 'default workspace for this context')
    .action(async (url: string, opts: Record<string, string | boolean>, command: Command) => run(async () => {
      const target = String(url).replace(/\/+$/, '');
      if (target.startsWith('http:') && !isLoopback(target) && opts['insecure'] !== true) {
        throw new ApiError('validation', `refusing to send a password in plaintext to ${target}; use https or pass --insecure`, 400);
      }

      let certPin: string | undefined;
      if (opts['pin'] === true) {
        const pin = await fetchCertPin(target);
        certPin = pin.pin;
        await applyCertPin(target, pin.pin);
        write(`${style.dim('certificate')}  ${pin.subject || '(no subject)'} valid to ${pin.validTo}`);
        write(`${style.dim('pin')}          ${pin.pin}`);
      }

      const client = new ApiClient({ baseUrl: target });
      const username = String(opts['username'] ?? 'operator');
      const password = (typeof opts['password'] === 'string' && opts['password']) || process.env['AC_PASSWORD'] || await promptHidden(`Password for ${username}@${new URL(target).host}`);
      const deviceName = String(opts['device'] ?? `${process.env['USER'] ?? 'cli'}@${process.env['HOSTNAME'] ?? 'host'}`);

      const attempt = async (totp?: string): Promise<LoginResponse> =>
        client.post<LoginResponse>('/api/auth/login', { username, password, kind: 'cli', deviceName, ...(totp ? { totp } : {}) });

      let response: LoginResponse;
      try {
        response = await attempt();
      } catch (error) {
        if (error instanceof ApiError && error.code === 'auth_totp_required') {
          response = await attempt(await promptLine('Six-digit code'));
        } else throw error;
      }
      if (response?.totpRequired === true) {
        response = await attempt(await promptLine('Six-digit code'));
      }
      if (!response?.token) throw new ApiError('unauthorized', 'the daemon did not return a session token', 401);

      const name = String(opts['name'] ?? suggestContextName(target));
      const authed = new ApiClient({ baseUrl: target, token: response.token });
      let workspace = opts['workspace-default'] ? String(opts['workspace-default']) : undefined;
      if (!workspace) {
        const health = await authed.get<{ workspaces?: Array<{ id?: string }> }>('/api/health').catch(() => ({ workspaces: [] }));
        const only = (health.workspaces ?? []).length === 1 ? health.workspaces![0]?.id : undefined;
        if (only) workspace = only;
      }
      putContext(name, { url: target, token: response.token, ...(workspace ? { workspace } : {}), ...(certPin ? { certPin } : {}) });

      emit({ context: name, url: target, workspace: workspace ?? null, expiresAt: response.expiresAt ?? null }, () => {
        write(`${style.ok('signed in')} as ${username} -> context ${style.bold(name)}`);
        fields([['url', target], ['workspace', workspace ?? '(none)'], ['expires', response.expiresAt ?? 'unknown']]);
      });
    }));

  program
    .command('logout')
    .description('end this CLI session on the daemon')
    .option('--all', 'revoke every other session too')
    .option('--forget', 'also delete the stored context')
    .action(async (opts: Record<string, boolean>, command: Command) => run(async () => {
      const { client, contextName } = await session(command, { workspace: 'none' });
      await client.post('/api/auth/logout', {}).catch((error) => {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
      });
      if (opts['all'] === true) await client.del('/api/auth/sessions').catch(() => undefined);
      if (contextName) {
        if (opts['forget'] === true) removeContext(contextName);
        else {
          const file = loadContexts();
          const entry = file.contexts[contextName];
          if (entry) putContext(contextName, { ...entry, token: '' }, false);
        }
      }
      emit({ ok: true, context: contextName, revokedAll: opts['all'] === true }, () => {
        write(`${style.ok('signed out')}${contextName ? ` (context ${contextName})` : ''}`);
      });
    }));

  const context = program.command('context').description('stored daemon contexts');

  context
    .command('list', { isDefault: true })
    .description('list contexts from ~/.config/agent-conductor/contexts.yaml')
    .action(async (_opts: unknown, command: Command) => run(async () => {
      const file = loadContexts();
      const rows = Object.entries(file.contexts).map(([name, entry]) => ({
        current: name === file.current,
        name,
        url: entry.url,
        workspace: entry.workspace ?? '',
        auth: entry.token ? 'token' : 'none',
        pinned: entry.certPin ? 'yes' : '',
      }));
      emit({ current: file.current ?? null, contexts: rows }, () => {
        table(rows, [
          { header: '', get: (r) => (r.current ? '*' : ' ') },
          { header: 'NAME', get: (r) => r.name },
          { header: 'URL', get: (r) => r.url },
          { header: 'WORKSPACE', get: (r) => r.workspace },
          { header: 'AUTH', get: (r) => r.auth },
          { header: 'PINNED', get: (r) => r.pinned },
        ], { empty: 'no contexts yet — run `conductor login <url>`' });
      });
    }));

  context
    .command('use')
    .argument('<name>')
    .description('make a context the default for this machine')
    .action(async (name: string) => run(async () => {
      const file = useContext(name);
      emit({ current: file.current }, () => write(`${style.ok('using')} ${name}`));
    }));

  context
    .command('remove')
    .argument('<name>')
    .description('delete a stored context')
    .action(async (name: string) => run(async () => {
      const removed = removeContext(name);
      emit({ removed }, () => write(removed ? `${style.ok('removed')} ${name}` : `no such context: ${name}`));
    }));

  context
    .command('show')
    .description('show the context in effect (after flags and environment)')
    .action(async (_opts: unknown, command: Command) => run(async () => {
      const g = globals(command);
      const ctx = currentContext(g.context ?? null);
      const { client, url } = await session(command, { workspace: 'optional' });
      emit({ name: ctx.name, url, workspace: client.workspace, agent: client.isAgent }, () => {
        fields([['context', ctx.name ?? '(none)'], ['url', url], ['workspace', client.workspace ?? '(none)'], ['auth', client.isAgent ? 'run token' : client.authToken ? 'bearer token' : 'none']]);
      });
    }));

  const devices = program.command('devices').description('sessions and devices signed in to the daemon');

  devices
    .command('list', { isDefault: true })
    .description('list active sessions')
    .action(async (_opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command, { workspace: 'none' });
      const payload = await client.get('/api/auth/sessions');
      const rows = items<Record<string, unknown>>(payload, 'sessions');
      emit(payload, () => {
        table(rows, [
          { header: 'ID', get: (r) => String(r['id'] ?? '') },
          { header: 'KIND', get: (r) => String(r['kind'] ?? '') },
          { header: 'DEVICE', get: (r) => String(r['deviceName'] ?? '') },
          { header: 'IP', get: (r) => String(r['ip'] ?? '') },
          { header: 'LAST SEEN', get: (r) => String(r['lastSeenAt'] ?? '') },
          { header: 'EXPIRES', get: (r) => String(r['expiresAt'] ?? '') },
        ], { empty: 'no active sessions' });
      });
    }));

  devices
    .command('revoke')
    .argument('[id]', 'session id; omit with --all')
    .option('--all', 'revoke every session except this one')
    .description('revoke a session')
    .action(async (id: string | undefined, opts: Record<string, boolean>, command: Command) => run(async () => {
      const { client } = await session(command, { workspace: 'none' });
      if (opts['all'] === true) {
        const result = await client.del('/api/auth/sessions');
        emit(result ?? { ok: true }, () => write(`${style.ok('revoked')} every other session`));
        return;
      }
      if (!id) throw new ApiError('validation', 'pass a session id or --all', 400);
      const result = await client.del(`/api/auth/sessions/${encodeURIComponent(id)}`);
      emit(result ?? { ok: true }, () => write(`${style.ok('revoked')} ${id}`));
    }));
}
