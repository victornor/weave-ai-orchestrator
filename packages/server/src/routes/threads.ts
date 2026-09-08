import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import {
  ATTACHMENT_MAX_PER_MESSAGE, OcError, attachmentMaxBytes, isAttachmentImageType, sniffImageType,
  type AttachmentMediaType,
} from '@agent-conductor/shared';
import type { AppEnv } from '../types.js';
import { body, query } from '../http.js';

export function threadRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => c.json(c.get('ws').services.threads.list({ channelKind: c.req.query('channel') })));

  app.post('/', async (c) => {
    const i = await body(c, z.object({ channel: z.string().default('web'), label: z.string().optional() }));
    const externalThreadId = `web:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    return c.json(c.get('ws').services.threads.bindOrGet(i.channel, externalThreadId, null, i.label), 201);
  });

  app.get('/:id/messages', (c) => {
    const q = query(c, z.object({ before: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).optional() }));
    return c.json(c.get('ws').services.threads.messages(c.req.param('id'), q));
  });

  app.post('/:id/messages', async (c) => {
    const ct = c.req.header('content-type') ?? '';
    if (ct.includes('multipart/form-data')) {
      return c.json(await sendWithAttachments(c), 201);
    }
    const { body: text, projectId, replyToMessageId } = await body(c, z.object({ body: z.string().min(1), projectId: z.string().nullish(), replyToMessageId: z.string().nullish() }));
    return c.json(await c.get('ws').services.threads.inbound(c.get('actor'), c.req.param('id'), text, { projectId, replyToMessageId }), 201);
  });

  app.get('/:threadId/attachments/:attachmentId', (c) => {
    const { threadId, attachmentId } = c.req.param();
    const { attachment, bytes } = c.get('ws').services.threads.attachment(threadId, attachmentId);
    return new Response(bytes, { headers: { 'Content-Type': attachment.mediaType, 'Content-Length': String(attachment.byteSize) } });
  });

  app.post('/:id/bind', async (c) => {
    const { ticketId } = await body(c, z.object({ ticketId: z.string().nullable() }));
    return c.json(c.get('ws').services.threads.bindTicket(c.get('actor'), c.req.param('id'), ticketId));
  });

  return app;
}

/**
 * `multipart/form-data`: a `body` text field plus up to `ATTACHMENT_MAX_PER_MESSAGE` `files` parts.
 * Every rejection happens before `threads.inbound` is called, so a rejected request stores nothing —
 * no message, no attachment row, no file (openspec spec.md — "Only an explicit, narrow set...").
 */
async function sendWithAttachments(c: Context<AppEnv, '/:id/messages'>) {
  // The whole request will be read into memory by `formData()` regardless, so this is the one point
  // where a request that could never satisfy the per-file caps is refused before that read happens.
  const declaredLength = Number(c.req.header('content-length') ?? '0');
  const worstCasePossible = ATTACHMENT_MAX_PER_MESSAGE * Math.max(...[5 * 1024 * 1024, 256 * 1024]) + 64 * 1024;
  if (declaredLength > worstCasePossible) {
    throw new OcError('validation', `request is ${declaredLength} bytes, which exceeds what ${ATTACHMENT_MAX_PER_MESSAGE} accepted attachments could ever need`);
  }

  const form = await c.req.raw.formData();
  const text = form.get('body');
  if (typeof text !== 'string' || text.length === 0) throw new OcError('validation', 'body is required');
  const projectId = asNullableString(form.get('projectId'));
  const replyToMessageId = asNullableString(form.get('replyToMessageId'));

  const fileParts = form.getAll('files').filter((f): f is File => typeof f !== 'string');
  if (fileParts.length > ATTACHMENT_MAX_PER_MESSAGE) {
    throw new OcError('validation', `at most ${ATTACHMENT_MAX_PER_MESSAGE} files are accepted on one message`);
  }

  const attachments = await Promise.all(fileParts.map(async (file) => {
    const declaredType = file.type;
    const cap = attachmentMaxBytes(declaredType);
    if (cap === null) throw new OcError('validation', `${file.name}: "${declaredType || 'unknown'}" is not an accepted attachment type`);
    if (file.size > cap) throw new OcError('validation', `${file.name}: exceeds the ${cap} byte cap for ${declaredType}`);
    const bytes = Buffer.from(await file.arrayBuffer());
    if (isAttachmentImageType(declaredType) && sniffImageType(bytes) !== declaredType) {
      throw new OcError('validation', `${file.name}: its contents do not match the declared type ${declaredType}`);
    }
    return { filename: file.name, mediaType: declaredType as AttachmentMediaType, bytes };
  }));

  return c.get('ws').services.threads.inbound(c.get('actor'), c.req.param('id'), text, { projectId, replyToMessageId, attachments });
}

function asNullableString(v: string | File | null): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
