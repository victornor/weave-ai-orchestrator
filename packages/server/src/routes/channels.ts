/**
 * Setting, clearing and reading the status of the Telegram bot token (VS-125). Deliberately not on
 * `PATCH /config` — that path only ever writes `workspace.yaml`, and the token must never land
 * there or in the database. This route calls the secret store directly and never returns a value.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { OcError, TELEGRAM_BOT_TOKEN_ENV_VAR_NAME, TELEGRAM_BOT_TOKEN_SECRET_NAME } from '@agent-conductor/shared';
import { TelegramClient } from '@agent-conductor/channel-telegram';
import type { AppEnv } from '../types.js';
import { body } from '../http.js';
import { resolveTelegramToken } from '../channels.js';

export function channelRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/telegram/token', (c) => {
    const ws = c.get('ws');
    const resolved = resolveTelegramToken(ws.ctx, ws.services.secrets);
    return c.json({
      configured: resolved.token !== null,
      source: resolved.source,
      botUsername: ws.channels?.telegramBotUsername() ?? null,
    });
  });

  app.post('/telegram/token', async (c) => {
    const ws = c.get('ws');
    const { token } = await body(c, z.object({ token: z.string().min(1) }));
    const apiBaseUrl = (ws.ctx.config.channels['telegram'] as { apiBaseUrl?: string } | undefined)?.apiBaseUrl;
    const client = new TelegramClient({ botToken: token, ...(apiBaseUrl ? { apiBaseUrl } : {}) });
    let me: { id: number; username?: string };
    try {
      me = await client.getMe();
    } catch (e) {
      // Telegram's own message only — never the token, which never appears in this error's construction.
      const message = e instanceof Error ? e.message : 'Telegram rejected the token';
      throw new OcError('validation', message);
    }
    ws.services.secrets.put(c.get('actor'), { name: TELEGRAM_BOT_TOKEN_SECRET_NAME, envVarName: TELEGRAM_BOT_TOKEN_ENV_VAR_NAME, scope: 'workspace' }, token);
    ws.channels?.setTelegramBotUsername(me.username ?? null);
    await ws.channels?.restartChannel('telegram');
    return c.json({ ok: true, botUsername: me.username ?? null });
  });

  app.delete('/telegram/token', async (c) => {
    const ws = c.get('ws');
    ws.services.secrets.clear(c.get('actor'), TELEGRAM_BOT_TOKEN_SECRET_NAME);
    ws.channels?.setTelegramBotUsername(null);
    await ws.channels?.restartChannel('telegram');
    return c.json({ ok: true });
  });

  // ---------- pending identities (VS-135) ----------

  app.get('/telegram/pending', (c) => {
    const ws = c.get('ws');
    return c.json({ pending: ws.channels?.pendingTelegramUsers() ?? [] });
  });

  app.post('/telegram/pending/:externalUserId/approve', async (c) => {
    const ws = c.get('ws');
    if (!ws.channels) throw new OcError('validation', 'the Telegram channel is not running for this workspace');
    const result = await ws.channels.approveTelegramUser(c.req.param('externalUserId'));
    return c.json(result);
  });

  app.post('/telegram/allow-all/disable', async (c) => {
    const ws = c.get('ws');
    if (!ws.channels) throw new OcError('validation', 'the Telegram channel is not running for this workspace');
    await ws.channels.disableTelegramAllowAll();
    return c.json({ ok: true });
  });

  return app;
}
