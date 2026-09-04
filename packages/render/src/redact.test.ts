import { describe, expect, it } from 'vitest';
import { REDACTED, redact, redactValue } from './redact.js';

describe('redact', () => {
  it('redacts run tokens', () => {
    expect(redact('use OC_RUN_TOKEN=rt_abc123def456ghi789')).toBe('use OC_RUN_TOKEN=rt_[redacted]');
  });
  it('redacts provider keys', () => {
    expect(redact('sk-ant-api03-AAAAbbbbCCCCddddEEEE')).toBe('sk-[redacted]');
    expect(redact('ghp_0123456789abcdefghij')).toBe('ghp_[redacted]');
    expect(redact('github_pat_11ABCDEFG0abcdefghijkl')).toBe('github_pat_[redacted]');
    expect(redact('AKIAIOSFODNN7EXAMPLE')).toBe('AKIA[redacted]');
  });
  it('redacts bearer headers and key=value pairs', () => {
    expect(redact('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payloadpart.signaturepart')).toContain(REDACTED);
    expect(redact('api_key=supersecretvalue')).toBe(`api_key=${REDACTED}`);
    expect(redact('"password": "hunter22222"')).toBe(`"password": "${REDACTED}"`);
  });
  it('redacts credentials in urls', () => {
    expect(redact('https://user:pass1234@example.com/x')).toBe('https://user:[redacted]@example.com/x');
  });
  it('is idempotent and leaves ordinary prose alone', () => {
    const clean = 'Rebased onto main and ran vitest: 38/41 passed.';
    expect(redact(clean)).toBe(clean);
    const once = redact('token=abcdefghijkl');
    expect(redact(once)).toBe(once);
  });
  it('never throws on empty input', () => {
    expect(redact(null)).toBe('');
    expect(redact(undefined)).toBe('');
  });
});

describe('redactValue', () => {
  it('drops secret-named keys and scrubs nested strings', () => {
    const out = redactValue({ authorization: 'Bearer abc', nested: { note: 'sk-ant-api03-AAAAbbbbCCCCddddEEEE' }, list: ['rt_abcdefghijkl'] });
    expect(out.authorization).toBe(REDACTED);
    expect(out.nested.note).toBe('sk-[redacted]');
    expect(out.list[0]).toBe('rt_[redacted]');
  });
});
