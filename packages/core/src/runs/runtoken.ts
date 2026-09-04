import { randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify, decodeJwt } from 'jose';
import type { Db } from '@openconductor/db';
import { OcError } from '@openconductor/shared';

/**
 * Run tokens (PLAN §9.1): HS256 JWTs signed with a per-workspace secret in the `meta` table,
 * prefixed `rt_` so the daemon can tell them from operator session tokens. The claim names here are
 * the contract shared with the server's MCP/run endpoint.
 */
export interface RunTokenClaims {
  workspaceId: string;
  runId: string;
  agentId: string;
  agentKind: 'conductor' | 'worker';
  projectId: string | null;
  ticketId: string | null;
  roleId: string | null;
}

export const RUN_TOKEN_PREFIX = 'rt_';
export const RUN_TOKEN_TTL_SECONDS = 2 * 3600;
const META_KEY = 'run_token_secret';

/** Read (or create) the workspace's HS256 secret. The daemon is the single writer, so a plain upsert is safe. */
export function runTokenSecret(db: Db): Uint8Array {
  const row = db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [META_KEY]);
  if (row?.value) return Buffer.from(row.value, 'base64');
  const secret = randomBytes(32);
  db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [META_KEY, secret.toString('base64')]);
  return secret;
}

export async function signRunToken(secret: Uint8Array, claims: RunTokenClaims, ttlSeconds = RUN_TOKEN_TTL_SECONDS): Promise<string> {
  const jwt = await new SignJWT({
    wid: claims.workspaceId, rid: claims.runId, aid: claims.agentId, kind: claims.agentKind,
    pid: claims.projectId, tid: claims.ticketId, rlid: claims.roleId,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.agentId)
    .setIssuer('openconductor')
    .setAudience('run')
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secret);
  return RUN_TOKEN_PREFIX + jwt;
}

/** The workspace id is read from the *unverified* payload only to pick the secret; the signature is still checked. */
export function peekWorkspaceId(token: string): string | null {
  try {
    const payload = decodeJwt(strip(token));
    return typeof payload.wid === 'string' ? payload.wid : null;
  } catch { return null; }
}

export async function verifyRunToken(secret: Uint8Array, token: string): Promise<RunTokenClaims> {
  try {
    const { payload } = await jwtVerify(strip(token), secret, { issuer: 'openconductor', audience: 'run' });
    const kind = payload.kind === 'conductor' ? 'conductor' : 'worker';
    if (typeof payload.wid !== 'string' || typeof payload.rid !== 'string' || typeof payload.aid !== 'string') {
      throw new OcError('unauthorized', 'run token missing claims');
    }
    return {
      workspaceId: payload.wid, runId: payload.rid, agentId: payload.aid, agentKind: kind,
      projectId: str(payload.pid), ticketId: str(payload.tid), roleId: str(payload.rlid),
    };
  } catch (e) {
    if (e instanceof OcError) throw e;
    throw new OcError('unauthorized', 'invalid or expired run token');
  }
}

export const isRunToken = (token: string): boolean => token.startsWith(RUN_TOKEN_PREFIX);
const strip = (t: string): string => (t.startsWith(RUN_TOKEN_PREFIX) ? t.slice(RUN_TOKEN_PREFIX.length) : t);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
