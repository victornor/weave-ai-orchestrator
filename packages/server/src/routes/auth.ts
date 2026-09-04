import { Hono } from 'hono';
import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { AUTH_SESSION_KINDS, OcError } from '@agent-conductor/shared';
import type { AppDeps, AppEnv } from '../types.js';
import { body } from '../http.js';
import { SESSION_COOKIE } from '../auth.js';

const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  totp: z.string().optional(),
  deviceName: z.string().optional(),
  kind: z.enum(AUTH_SESSION_KINDS).default('web'),
});
const SetupSchema = z.object({ username: z.string().min(1), password: z.string().min(8) });
const PasswordSchema = z.object({ current: z.string().min(1), next: z.string().min(8) });

export function authRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post('/setup', async (c) => {
    if (deps.auth.hasOperator()) throw new OcError('conflict', 'an operator already exists');
    const input = await body(c, SetupSchema);
    await deps.auth.setPassword(input.username, input.password);
    deps.onOperatorConfigured?.();
    return c.json({ ok: true });
  });

  app.post('/login', async (c) => {
    const input = await body(c, LoginSchema);
    const result = await deps.auth.login({
      ...input,
      ip: clientIp(c, deps),
      userAgent: c.req.header('user-agent'),
    });
    if ('totpRequired' in result) throw new OcError('auth_totp_required', 'a TOTP code is required');
    if (input.kind === 'web') {
      setCookie(c, SESSION_COOKIE, result.token, {
        httpOnly: true, sameSite: 'Lax', path: '/', secure: deps.publicUrl.startsWith('https://'),
        expires: new Date(result.expiresAt),
      });
    }
    return c.json(result);
  });

  app.post('/logout', (c) => {
    const p = c.get('principal');
    if (p.kind === 'operator') deps.auth.logout(p.sessionId);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/me', (c) => {
    const p = c.get('principal');
    const session = p.kind === 'operator' ? deps.auth.sessions().find((s) => s.id === p.sessionId) ?? null : null;
    return c.json({
      operator: { configured: deps.auth.hasOperator(), id: p.kind === 'operator' ? p.operatorId : null },
      session,
      totpEnabled: deps.auth.totpEnabled(),
    });
  });

  app.get('/sessions', (c) => c.json(deps.auth.sessions()));
  app.delete('/sessions/:id', (c) => { deps.auth.revoke(c.req.param('id')); return c.json({ ok: true }); });
  app.delete('/sessions', (c) => {
    const p = c.get('principal');
    const revoked = deps.auth.revokeAll(p.kind === 'operator' ? p.sessionId : undefined);
    return c.json({ revoked });
  });

  app.post('/totp/setup', async (c) => c.json(await deps.auth.totpSetup()));
  app.post('/totp/enable', async (c) => { const { code } = await body(c, z.object({ code: z.string().min(6) })); await deps.auth.totpEnable(code); return c.json({ ok: true }); });
  // NOTE: AuthService exposes no password verifier, so the password in the body cannot be checked
  // here. Core should add `verifyPassword(password)` (or take it in `totpDisable`) and this route
  // should then reject before disabling.
  app.post('/totp/disable', async (c) => {
    await body(c, z.object({ password: z.string().min(1) }));
    await deps.auth.totpDisable();
    return c.json({ ok: true });
  });
  app.post('/password', async (c) => { const i = await body(c, PasswordSchema); await deps.auth.changePassword(i.current, i.next); return c.json({ ok: true }); });

  return app;
}

/** The peer address: the proxy header when `http.trustProxy` is on, else the TCP peer itself. */
function clientIp(c: Context<AppEnv>, deps: AppDeps): string | undefined {
  const forwarded = c.req.header('x-forwarded-for');
  if (deps.daemon.http.trustProxy && forwarded) return forwarded.split(',')[0]?.trim();
  try {
    const addr = getConnInfo(c).remote.address;
    return addr?.replace(/^::ffff:/, '');
  } catch {
    return undefined;
  }
}
