/** `http.tls.mode: self-signed`: one local certificate for the configured domains and 127.0.0.1. */
export async function generateSelfSigned(domains: string[]): Promise<{ cert: string; key: string }> {
  const selfsigned = (await import('selfsigned')) as { generate: (attrs: unknown, opts: unknown) => Promise<{ cert: string; private: string }> };
  const names = domains.length ? domains : ['localhost'];
  const notBeforeDate = new Date();
  const notAfterDate = new Date(notBeforeDate.getTime() + 3650 * 86_400_000);
  const pems = await selfsigned.generate([{ name: 'commonName', value: names[0]! }], {
    notBeforeDate, notAfterDate, keySize: 2048, algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: [...names.map((d) => ({ type: 2, value: d })), { type: 7, ip: '127.0.0.1' }] }],
  });
  return { cert: pems.cert, key: pems.private };
}
