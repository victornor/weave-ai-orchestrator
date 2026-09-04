import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z, type ZodTypeAny } from 'zod';
import { OcError, type ErrorCode } from '@agent-conductor/shared';
import { getLogger } from '@agent-conductor/core';
import type { AppEnv } from './types.js';

const log = getLogger('http');

export interface ErrorBody { error: { code: ErrorCode; message: string; details?: Record<string, unknown>; retryable: boolean } }

export function errorBody(e: OcError): ErrorBody {
  return { error: { code: e.code, message: e.message, details: e.details, retryable: e.retryable } };
}

/** Map anything thrown by a route onto the documented error envelope. */
export function toOcError(err: unknown): OcError {
  if (err instanceof OcError) return err;
  if (err instanceof z.ZodError) {
    return new OcError('validation', 'request validation failed', { issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })) });
  }
  if (err instanceof HTTPException) {
    const code: ErrorCode = err.status === 404 ? 'not_found' : err.status === 401 ? 'unauthorized' : err.status === 403 ? 'forbidden' : 'internal';
    return new OcError(code, err.message || 'request failed');
  }
  const message = err instanceof Error ? err.message : String(err);
  return new OcError('internal', message);
}

export function onError(err: unknown, c: Context<AppEnv>): Response {
  const conductor = toOcError(err);
  const status = OcError.status(conductor.code);
  if (status >= 500) log.error({ err: conductor, path: c.req.path, code: conductor.code }, 'request failed');
  else log.debug({ path: c.req.path, code: conductor.code, message: conductor.message }, 'request rejected');
  return c.json(errorBody(conductor), status as 400);
}

/** Parse + validate a JSON body. Empty bodies validate against the schema too (so `.default({})` works). */
export async function body<T extends ZodTypeAny>(c: Context<AppEnv>, schema: T): Promise<z.infer<T>> {
  let raw: unknown = {};
  const text = await c.req.text();
  if (text.trim().length > 0) {
    try { raw = JSON.parse(text); } catch { throw new OcError('validation', 'body is not valid JSON'); }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw toOcError(parsed.error);
  return parsed.data;
}

/** Parse + validate the query string. */
export function query<T extends ZodTypeAny>(c: Context<AppEnv>, schema: T): z.infer<T> {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) throw toOcError(parsed.error);
  return parsed.data;
}

export const intParam = z.coerce.number().int();
export const boolParam = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');
/** Comma separated list → array, for `?status=a,b`. */
export const csv = z.string().transform((s) => s.split(',').map((p) => p.trim()).filter(Boolean));
export const notFound = (what: string, id: string): OcError => new OcError('not_found', `${what} ${id} not found`);
