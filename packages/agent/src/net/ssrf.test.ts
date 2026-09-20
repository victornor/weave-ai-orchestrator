import { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { blockedReason, fetchWithPolicy, isBlockedAddress, nodeTransfer, resolveHost, SsrfError, type Resolver, type Transfer } from './ssrf.js';

const PUB = '93.184.216.34';

const okTransfer = (body: string, headers: Record<string, string> = {}): { transfer: Transfer; seen: Array<{ url: string; address: string }> } => {
  const seen: Array<{ url: string; address: string }> = [];
  const transfer: Transfer = (req) => {
    seen.push({ url: req.url.toString(), address: req.address.address });
    return Promise.resolve({ status: 200, statusText: 'OK', headers: { 'content-type': 'text/plain', ...headers }, body: Buffer.from(body) });
  };
  return { transfer, seen };
};

describe('address classification', () => {
  it('blocks loopback, private, link-local, CGNAT and metadata in both families', () => {
    expect(blockedReason('127.0.0.1')).toBe('loopback');
    expect(blockedReason('127.9.9.9')).toBe('loopback');
    expect(blockedReason('10.0.0.1')).toBe('private');
    expect(blockedReason('172.16.0.1')).toBe('private');
    expect(blockedReason('172.31.255.255')).toBe('private');
    expect(blockedReason('192.168.1.1')).toBe('private');
    expect(blockedReason('169.254.1.1')).toBe('link-local');
    expect(blockedReason('169.254.169.254')).toBe('metadata');
    expect(blockedReason('100.64.0.1')).toBe('cgnat');
    expect(blockedReason('100.100.100.200')).toBe('metadata');
    expect(blockedReason('0.0.0.0')).toBe('reserved');
    expect(blockedReason('224.0.0.1')).toBe('multicast');
    expect(blockedReason('::1')).toBe('loopback');
    expect(blockedReason('fd00::1')).toBe('unique-local');
    expect(blockedReason('fe80::1')).toBe('link-local');
    expect(blockedReason('::ffff:127.0.0.1')).toBe('loopback');
    expect(blockedReason('::ffff:10.0.0.1')).toBe('private');
    expect(blockedReason('64:ff9b::7f00:1')).toBe('loopback');
    expect(blockedReason('64:ff9b::a00:1')).toBe('private');
    expect(blockedReason('2002:7f00:1::')).toBe('loopback');
    expect(blockedReason('not-an-ip')).toBe('unparseable');
  });

  it('allows public addresses', () => {
    for (const a of ['8.8.8.8', '1.1.1.1', PUB, '2606:4700:4700::1111', '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::']) expect(isBlockedAddress(a), a).toBe(false);
  });
});

describe('resolveHost', () => {
  it('refuses a host that resolves to a blocked address, naming the range', async () => {
    const resolve: Resolver = async () => [{ address: '127.0.0.1', family: 4 }];
    await expect(resolveHost('evil.test', resolve)).rejects.toMatchObject({ reason: 'loopback' });
  });

  it('refuses an empty answer', async () => {
    const resolve: Resolver = async () => [];
    await expect(resolveHost('void.test', resolve)).rejects.toBeInstanceOf(SsrfError);
  });
});

describe('fetchWithPolicy', () => {
  it('fetches a public target through the checked address', async () => {
    const resolve: Resolver = async () => [{ address: PUB, family: 4 }];
    const { transfer, seen } = okTransfer('hello');
    const res = await fetchWithPolicy('http://example.test/page', { resolve, transfer });
    expect(res).toMatchObject({ status: 200, mediaType: 'text/plain', finalUrl: 'http://example.test/page' });
    expect(res.body.toString()).toBe('hello');
    expect(seen).toEqual([{ url: 'http://example.test/page', address: PUB }]);
  });

  it('refuses a redirect hop to a private target', async () => {
    const resolve: Resolver = async (host) => (host === '127.0.0.1' ? [{ address: '127.0.0.1', family: 4 }] : [{ address: PUB, family: 4 }]);
    const transfer: Transfer = (req) => Promise.resolve({
      status: 302, statusText: 'Found',
      headers: req.url.hostname === 'example.test' ? { location: 'http://127.0.0.1/secret' } : {},
      body: Buffer.alloc(0),
    });
    await expect(fetchWithPolicy('http://example.test/', { resolve, transfer })).rejects.toMatchObject({ reason: 'loopback' });
  });

  it('resolves a host once: a rebinding resolver cannot move the connection to a private address', async () => {
    let calls = 0;
    const resolve: Resolver = async () => { calls++; return calls === 1 ? [{ address: PUB, family: 4 }] : [{ address: '127.0.0.1', family: 4 }]; };
    const { transfer, seen } = okTransfer('ok');
    const res = await fetchWithPolicy('http://rebind.test/', { resolve, transfer });
    expect(res.status).toBe(200);
    expect(calls).toBe(1);
    expect(seen[0]!.address).toBe(PUB);
  });

  it('refuses an unsupported scheme without resolving', async () => {
    let calls = 0;
    const resolve: Resolver = async () => { calls++; return [{ address: PUB, family: 4 }]; };
    const { transfer } = okTransfer('x');
    await expect(fetchWithPolicy('ftp://example.test/', { resolve, transfer })).rejects.toMatchObject({ reason: 'unsupported scheme' });
    expect(calls).toBe(0);
  });

  it('stops at the redirect limit', async () => {
    const resolve: Resolver = async () => [{ address: PUB, family: 4 }];
    const transfer: Transfer = (req) => Promise.resolve({ status: 302, statusText: 'Found', headers: { location: `http://example.test/${req.url.pathname.length}` }, body: Buffer.alloc(0) });
    await expect(fetchWithPolicy('http://example.test/', { resolve, transfer })).rejects.toMatchObject({ reason: 'redirect limit' });
  });
});

describe('nodeTransfer', () => {
  it('returns the bytes it read and flags truncation when the body exceeds the cap', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      for (let i = 0; i < 64; i++) res.write('x'.repeat(1024));
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      const res = await nodeTransfer({ url: new URL(`http://127.0.0.1:${port}/`), address: { address: '127.0.0.1', family: 4 }, signal: new AbortController().signal, maxBytes: 4096 });
      expect(res.body.length).toBe(4096);
      expect(res.truncated).toBe(true);
    } finally { server.close(); }
  });
});
