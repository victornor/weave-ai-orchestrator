import { X509Certificate, createPrivateKey } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateSelfSigned } from '../src/selfSignedCert.js';

describe('generateSelfSigned', () => {
  it('covers the configured domains and 127.0.0.1, with a matching key and a long validity', async () => {
    const { cert, key } = await generateSelfSigned(['weave.example.test', 'alt.example.test']);
    const x = new X509Certificate(cert);
    expect(x.subjectAltName).toContain('DNS:weave.example.test');
    expect(x.subjectAltName).toContain('DNS:alt.example.test');
    expect(x.subjectAltName).toContain('IP Address:127.0.0.1');
    expect(x.checkPrivateKey(createPrivateKey(key))).toBe(true);
    const years = (Date.parse(x.validTo) - Date.parse(x.validFrom)) / (365 * 86_400_000);
    expect(years).toBeGreaterThan(9.9);
  });

  it('falls back to localhost without domains', async () => {
    const { cert } = await generateSelfSigned([]);
    expect(new X509Certificate(cert).subjectAltName).toContain('DNS:localhost');
  });
});
