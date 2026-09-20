import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { classifyFinish, classifyHttp, classifyNetwork, classifyStreamError, isRetryable, parseErrorBody, stopError } from './errors.js';

interface Row { name: string; source: string; status: number; body?: string; bodyFile?: string; expect: { code: string; family: string; maxRetries?: number; message?: string } }
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'errors');
const rows = JSON.parse(readFileSync(join(fixturesDir, 'table.json'), 'utf8')) as Row[];
const bodyOf = (r: Row): string => (r.bodyFile ? readFileSync(join(fixturesDir, r.bodyFile), 'utf8') : r.body ?? '');

describe('error table', () => {
  it.each(rows.map((r) => [r.name, r] as const))('%s', (_n, r) => {
    const e = classifyHttp(r.status, bodyOf(r));
    expect(e).toMatchObject({ code: r.expect.code, family: r.expect.family, status: r.status });
    if (r.expect.maxRetries !== undefined) expect(e.maxRetries).toBe(r.expect.maxRetries);
    if (r.expect.message) expect(e.message).toBe(r.expect.message);
  });
  it('has a row for every documented family the HTTP path can produce', () => {
    expect(new Set(rows.map((r) => r.expect.family))).toEqual(new Set(['auth', 'tooling', 'provider_quota', 'transient_upstream', 'resource']));
  });
  it('carries retry-after through on quota and rate limits', () => {
    expect(classifyHttp(429, '{}', 1500)).toMatchObject({ code: 'rate_limited', retryAfterMs: 1500 });
    expect(classifyHttp(402, '{"error":{"message":"Insufficient Balance"}}', 9000)).toMatchObject({ family: 'provider_quota', retryAfterMs: 9000 });
  });
  it('names the flag to set when an endpoint rejects a parameter', () => {
    expect(classifyHttp(400, '{"error":{"message":"Unknown parameter: \'seed\'"}}').message).toContain('omitParams');
  });
  it('reduces an HTML challenge page to one line naming the status, the title and the User-Agent hint, and never retries it', () => {
    const body = readFileSync(join(fixturesDir, 'cloudflare-challenge.html'), 'utf8');
    const e = classifyHttp(503, body);
    expect(e).toMatchObject({ code: 'html_error', family: 'tooling', status: 503, maxRetries: 0 });
    expect(e.message).toBe('HTTP 503: the endpoint returned an HTML page titled "Just a moment..." (likely a bot challenge or a gateway error); try setting a User-Agent header on the provider');
    expect(e.message.split('\n')).toHaveLength(1);
    expect(e.message).not.toContain('<');
    expect(isRetryable(e)).toBe(false);
  });
  it('cuts a long plain-text body to 200 characters on one line', () => {
    const body = readFileSync(join(fixturesDir, 'long-plain-error.txt'), 'utf8');
    expect(body.length).toBeGreaterThan(300);
    const e = classifyHttp(500, body);
    expect(e.family).toBe('transient_upstream');
    expect(e.message.length).toBeLessThanOrEqual(201);
    expect(e.message.endsWith('…')).toBe(true);
    expect(e.message.split('\n')).toHaveLength(1);
  });
});

describe('parseErrorBody', () => {
  it('reads the four shapes', () => {
    expect(parseErrorBody('{"error":{"message":"m","code":"c","type":"t"}}')).toEqual({ message: 'm', code: 'c', type: 't' });
    expect(parseErrorBody('{"error":"plain"}')).toEqual({ message: 'plain' });
    expect(parseErrorBody('{"code":"1211","message":"bare"}')).toEqual({ message: 'bare', code: '1211' });
    expect(parseErrorBody('not json at all')).toEqual({ message: 'not json at all' });
  });
  it('reads the upstream code out of OpenRouter metadata.raw', () => {
    const p = parseErrorBody('{"error":{"message":"Provider returned error","code":400,"metadata":{"raw":"{\\"error\\":{\\"code\\":\\"1211\\",\\"message\\":\\"Unknown Model\\"}}","provider_error_code":"1211"}}}');
    expect(p).toEqual({ message: 'Unknown Model', code: '1211' });
  });
});

describe('errors that arrive inside a 200 stream', () => {
  it('classifies by wording and by a passed-along status code', () => {
    expect(classifyStreamError({ message: 'Insufficient Balance' })).toMatchObject({ code: 'quota_exhausted', family: 'provider_quota' });
    expect(classifyStreamError({ message: 'upstream exploded', type: 'server_error' })).toMatchObject({ family: 'transient_upstream' });
    expect(classifyStreamError({ message: 'Rate limit hit', code: '429' })).toMatchObject({ code: 'rate_limited', family: 'transient_upstream' });
    expect(classifyStreamError({ message: 'bad key', code: '401' })).toMatchObject({ family: 'auth' });
    expect(classifyStreamError({ message: 'All available provider routes failed after 3 attempts' })).toMatchObject({ code: 'gateway_routes_failed', maxRetries: 1 });
    expect(classifyStreamError({ message: 'context length exceeded' })).toMatchObject({ family: 'resource' });
    expect(classifyStreamError({ message: 'mystery' })).toMatchObject({ code: 'provider_error', family: 'unknown' });
  });
});

describe('refusals and network failures', () => {
  it('maps content_filter and message.refusal to model_refusal', () => {
    expect(classifyFinish('content_filter', undefined)).toMatchObject({ code: 'refusal', family: 'model_refusal' });
    expect(classifyFinish('stop', 'I cannot help with that')).toMatchObject({ code: 'refusal', family: 'model_refusal', message: 'I cannot help with that' });
    expect(classifyFinish('stop', undefined)).toBeNull();
    expect(classifyFinish('length', undefined)).toBeNull();
  });
  it('gives an unreachable endpoint three tries as tooling, and a reset connection the transient ladder', () => {
    const refused = classifyNetwork(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:1' } }));
    expect(refused).toMatchObject({ code: 'endpoint_unreachable', family: 'tooling', maxRetries: 3 });
    expect(isRetryable(refused)).toBe(true);
    const reset = classifyNetwork(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET', message: 'read ECONNRESET' } }));
    expect(reset).toMatchObject({ code: 'network', family: 'transient_upstream' });
    expect(classifyNetwork({ code: 'ETIMEDOUT', message: 'x' })).toMatchObject({ code: 'timeout' });
  });
});

describe('the loop\'s own stops', () => {
  it('are never `resource`, which the run engine re-queues', () => {
    for (const e of [stopError.maxSteps(5), stopError.budget(10, 5), stopError.truncated(), stopError.invalidCalls(3), stopError.doom('bash')]) {
      expect(e.family).toBe('tooling');
      expect(isRetryable(e)).toBe(false);
    }
  });
  it('a quota, auth or capped-at-zero failure is not retryable', () => {
    expect(isRetryable(classifyHttp(402, '{}'))).toBe(false);
    expect(isRetryable(classifyHttp(401, '{}'))).toBe(false);
    expect(isRetryable({ code: 'x', family: 'transient_upstream', message: '', maxRetries: 0 })).toBe(false);
    expect(isRetryable(classifyHttp(503, '{}'))).toBe(true);
  });
});
