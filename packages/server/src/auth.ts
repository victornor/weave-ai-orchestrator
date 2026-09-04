import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { OcError } from '@agent-conductor/shared';
import { getLogger } from '@agent-conductor/core';
import type { AppDeps, AppEnv, Principal } from './types.js';
import { actorFor } from './types.js';
import { isRunToken, peekWorkspaceId, runTokenSecret, verifyRunToken } from './runtoken.js';

const log = getLogger('auth');
export const SESSION_COOKIE = 'ac_session';

/** Routes reachable with no principal at all (bootstrap, login, discovery, health). */
const OPEN_PATHS: Array<{ method: string; path: RegExp }> = [
  { method: 'GET', path: /^\/api\/health$/ },
  { method: 'POST', path: /^\/api\/auth\/setup$/ },
  { method: 'POST', path: /^\/api\/auth\/login$/ },
  { method: 'GET', path: /^\/api\/openapi\.json$/ },
  { method: 'GET', path: /^\/llms\/api\.txt$/ },
];

/** Paths a run token may reach: the MCP endpoint and the agent REST mirror of the MCP tools. */
const RUN_TOKEN_PATHS: RegExp[] = [/^\/mcp(\/|$)/, /^\/api\/w\/[^/]+\/agent(\/|$)/];

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isOpenPath(method: string, path: string): boolean {
  return OPEN_PATHS.some((r) => r.method === method && r.path.test(path));
}

/** True when the TCP peer is on the loopback interface (or we are the loopback listener). */
export function isLoopbackRequest(c: Context<AppEnv>, deps: AppDeps): boolean {
  if (deps.listener === 'loopback') return true;
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  const addr = env?.incoming?.socket?.remoteAddress;
  if (!addr) return false;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1' || addr.startsWith('127.');
}

function bearer(c: Context<AppEnv>): string | null {
  const h = c.req.header('authorization') ?? c.req.header('Authorization');
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1]!.trim() : null;
}

/** SameSite cookies plus an Origin check on mutations (PLAN §19). */
function checkCsrf(c: Context<AppEnv>, deps: AppDeps): void {
  if (!MUTATING.has(c.req.method)) return;
  const origin = c.req.header('origin');
  if (!origin) return; // non-browser client sending a cookie; nothing to forge from
  const allowed = new Set([deps.publicUrl.replace(/\/$/, '')]);
  const host = c.req.header('host');
  if (host) { allowed.add(`http://${host}`); allowed.add(`https://${host}`); }
  if (!allowed.has(origin.replace(/\/$/, ''))) {
    throw new OcError('forbidden', 'origin not allowed', { origin });
  }
}

/**
 * Resolves the principal for every request:
 * bearer session token · `ac_session` cookie (+CSRF) · run token (loopback listener, agent paths only)
 * · `auth.loopbackTrusted` bypass for loopback peers.
 */
export function authMiddleware(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const path = c.req.path;
    if (isOpenPath(c.req.method, path)) return next();

    const token = bearer(c);
    if (token && isRunToken(token)) {
      if (deps.listener !== 'loopback') throw new OcError('unauthorized', 'run tokens are only accepted on the loopback listener');
      if (!RUN_TOKEN_PATHS.some((r) => r.test(path))) throw new OcError('forbidden', 'run tokens may only reach /mcp and /api/w/:ws/agent/*');
      const wsId = peekWorkspaceId(token);
      const ws = wsId ? deps.workspaces.get(wsId) : undefined;
      if (!ws) throw new OcError('unauthorized', 'run token names an unknown workspace');
      const claims = await verifyRunToken(runTokenSecret(ws.ctx.db), token);
      return setPrincipal(c, next, { kind: 'run', claims });
    }

    if (token) {
      const session = deps.auth.verify(token);
      if (!session) throw new OcError('auth_session_expired', 'session token is invalid or expired');
      return setPrincipal(c, next, { kind: 'operator', operatorId: session.operatorId, sessionId: session.sessionId, sessionKind: session.kind, viaCookie: false });
    }

    const cookie = getCookie(c, SESSION_COOKIE);
    if (cookie) {
      const session = deps.auth.verify(cookie);
      if (!session) throw new OcError('auth_session_expired', 'session cookie is invalid or expired');
      checkCsrf(c, deps);
      return setPrincipal(c, next, { kind: 'operator', operatorId: session.operatorId, sessionId: session.sessionId, sessionKind: session.kind, viaCookie: true });
    }

    if (deps.daemon.auth.loopbackTrusted && isLoopbackRequest(c, deps)) {
      return setPrincipal(c, next, { kind: 'loopback' });
    }

    log.debug({ path, listener: deps.listener }, 'unauthenticated request');
    throw new OcError('unauthorized', 'authentication required');
  };
}

function setPrincipal(c: Context<AppEnv>, next: () => Promise<void>, p: Principal): Promise<void> {
  c.set('principal', p);
  c.set('actor', actorFor(p));
  return next();
}

/** Guard for routes only a human operator may call (everything except the agent surface). */
export function requireOperator(c: Context<AppEnv>): void {
  const p = c.get('principal');
  if (p.kind === 'run') throw new OcError('forbidden', 'run tokens may not call this endpoint');
}
