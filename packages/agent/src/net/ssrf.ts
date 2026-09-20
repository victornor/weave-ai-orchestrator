/**
 * Server-side request forgery policy for `web_fetch` (runtime-details section 5, S8).
 *
 * The defence is not a preflight check: the host is resolved **once**, every returned address is
 * classified, and the socket is connected to the address that passed, with the Host header and TLS
 * SNI preserved. A resolver that answers public on the first lookup and private on a later one
 * therefore cannot redirect the connection. Every redirect hop is re-resolved and re-checked.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export interface ResolvedAddress { address: string; family: 4 | 6 }
export type Resolver = (host: string) => Promise<ResolvedAddress[]>;

/** The reason a target is refused, named in the tool's error. */
export type BlockReason = 'loopback' | 'private' | 'link-local' | 'metadata' | 'cgnat' | 'unique-local' | 'multicast' | 'reserved' | 'unparseable';

export class SsrfError extends Error {
  constructor(readonly reason: BlockReason | 'redirect limit' | 'unsupported scheme' | 'unresolved', message: string) { super(message); this.name = 'SsrfError'; }
}

const v4 = (a: number, b: number, c: number, d: number): number[] => [a, b, c, d];

function ipv4ToBytes(input: string): number[] | null {
  const parts = input.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

/** Parse an IPv6 address (compressed, with an optional zone and an embedded IPv4) to 16 bytes. */
export function ipv6ToBytes(input: string): number[] | null {
  let s = input;
  const pct = s.indexOf('%');
  if (pct >= 0) s = s.slice(0, pct);
  let head = s;
  let embedded: number[] = [];
  if (s.includes('.')) {
    const i = s.lastIndexOf(':');
    if (i < 0) return null;
    const tail = ipv4ToBytes(s.slice(i + 1));
    if (!tail) return null;
    embedded = [(tail[0]! << 8) | tail[1]!, (tail[2]! << 8) | tail[3]!];
    head = s.slice(0, i);
  }
  const parse = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const g of part.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const dbl = head.indexOf('::');
  let left: number[]; let right: number[];
  if (dbl >= 0) {
    const l = parse(head.slice(0, dbl)); const r = parse(head.slice(dbl + 2));
    if (!l || !r) return null;
    left = l; right = r;
  } else {
    const l = parse(head);
    if (!l) return null;
    left = l; right = [];
  }
  const fill = 8 - left.length - right.length - embedded.length;
  if (dbl < 0 && fill !== 0) return null;
  if (fill < 0) return null;
  const groups = [...left, ...new Array(fill).fill(0), ...right, ...embedded];
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of groups) bytes.push((g >> 8) & 0xff, g & 0xff);
  return bytes;
}

function blockedV4(b: number[]): BlockReason | null {
  const [a, c] = [b[0]!, b[1]!];
  if (a === 169 && c === 254) {
    if (b[2] === 169 && b[3] === 254) return 'metadata';
    if (b[2] === 170 && b[3] === 2) return 'metadata';
    return 'link-local';
  }
  if (a === 100 && b[1]! >= 64 && b[1]! <= 127) {
    if (b[1] === 100 && b[2] === 100 && b[3] === 200) return 'metadata';
    return 'cgnat';
  }
  if (a === 127) return 'loopback';
  if (a === 10) return 'private';
  if (a === 172 && b[1]! >= 16 && b[1]! <= 31) return 'private';
  if (a === 192 && b[1] === 168) return 'private';
  if (a === 0) return 'reserved';
  if (a === 192 && b[1] === 0 && b[2] === 0) return 'reserved';
  if (a === 198 && (b[1] === 18 || b[1] === 19)) return 'reserved';
  if (a >= 224) return 'multicast';
  return null;
}

function blockedV6(b: number[]): BlockReason | null {
  // NAT64 (64:ff9b::/96) and 6to4 (2002::/16) embed an IPv4 address: judge them by it, so a
  // translation of a private/metadata host is refused while one of a public host is allowed.
  const nat64 = b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0);
  if (nat64) return blockedV4(b.slice(12));
  if (b[0] === 0x20 && b[1] === 0x02) return blockedV4(b.slice(2, 6));
  if (b.every((x) => x === 0)) return 'reserved';
  if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return 'loopback';
  if ((b[0]! & 0xfe) === 0xfc) return 'unique-local';
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return 'link-local';
  if (b[0] === 0xff) return 'multicast';
  return null;
}

/** Why this address is not public, or null when it is. Unparseable input is refused ("unparseable"), never allowed. */
export function blockedReason(address: string): BlockReason | null {
  const asV4 = ipv4ToBytes(address);
  if (asV4) return blockedV4(asV4);
  const asV6 = ipv6ToBytes(address);
  if (asV6) {
    // ::ffff:a.b.c.d and ::ffff:0:a.b.c.d are judged by the IPv4 they carry.
    const mapped = asV6.slice(0, 10).every((x) => x === 0) && asV6[10] === 0xff && asV6[11] === 0xff;
    if (mapped) return blockedV4(asV6.slice(12));
    return blockedV6(asV6);
  }
  return 'unparseable';
}

export const isBlockedAddress = (address: string): boolean => blockedReason(address) !== null;

const defaultResolve: Resolver = async (host) => {
  const rows = await dnsLookup(host, { all: true, verbatim: true });
  return rows.map((r) => ({ address: r.address, family: r.family as 4 | 6 }));
};

/** Resolve once and refuse a host that answers with any non-public address, or with none. */
export async function resolveHost(host: string, resolve: Resolver = defaultResolve): Promise<ResolvedAddress[]> {
  let rows: ResolvedAddress[];
  try { rows = await resolve(host); } catch (e) { throw new SsrfError('unresolved', `could not resolve ${host}: ${(e as Error).message}`); }
  if (rows.length === 0) throw new SsrfError('unresolved', `${host} did not resolve`);
  for (const r of rows) {
    const reason = blockedReason(r.address);
    if (reason) throw new SsrfError(reason, `${reason} address (${r.address})`);
  }
  return rows;
}

export interface TransferRequest { url: URL; address: ResolvedAddress; signal: AbortSignal; maxBytes: number }
export interface TransferResponse { status: number; statusText: string; headers: Record<string, string | undefined>; body: Buffer; truncated?: boolean }
export type Transfer = (req: TransferRequest) => Promise<TransferResponse>;

const USER_AGENT = 'weave-agent/0.1 (+web_fetch)';

/** The real transfer: node http/https, with `lookup` pinned to the checked address so no second DNS query happens. */
export const nodeTransfer: Transfer = (req) => new Promise((resolve, reject) => {
  const tls = req.url.protocol === 'https:';
  const send = tls ? httpsRequest : httpRequest;
  const r = send({
    protocol: req.url.protocol,
    hostname: req.url.hostname,
    ...(req.url.port ? { port: req.url.port } : {}),
    path: `${req.url.pathname}${req.url.search}`,
    method: 'GET',
    headers: { host: req.url.host, accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8', 'user-agent': USER_AGENT },
    servername: req.url.hostname,
    lookup: (_hostname, _options, cb) => cb(null, req.address.address, req.address.family),
    signal: req.signal,
  }, (res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve({ status: res.statusCode ?? 0, statusText: res.statusMessage ?? '', headers: res.headers as Record<string, string | undefined>, body: Buffer.concat(chunks), truncated });
    };
    res.on('data', (c: Buffer) => {
      if (size >= req.maxBytes) { truncated = true; res.destroy(); return; }
      const take = c.subarray(0, req.maxBytes - size);
      chunks.push(take); size += take.length;
      // Hitting the cap is success, not a failure: stop reading and return what was read.
      if (size >= req.maxBytes) { truncated = true; res.destroy(); }
    });
    res.on('end', finish);
    res.on('error', (e) => { if (truncated || settled) finish(); else reject(e); });
    res.on('aborted', () => { if (truncated || settled) finish(); else reject(new Error('response aborted')); });
  });
  r.on('error', reject);
  r.end();
});

export interface FetchPolicyOptions {
  resolve?: Resolver;
  transfer?: Transfer;
  signal?: AbortSignal;
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
}
export interface PolicyResponse { status: number; statusText: string; mediaType: string; body: Buffer; finalUrl: string; truncated: boolean }

/** A redirect-following, policy-checked GET. Every hop is resolved and checked; the socket uses the checked address. */
export async function fetchWithPolicy(input: string, opts: FetchPolicyOptions = {}): Promise<PolicyResponse> {
  const resolve = opts.resolve ?? defaultResolve;
  const transfer = opts.transfer ?? nodeTransfer;
  const maxRedirects = opts.maxRedirects ?? 5;
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  let current = input;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = new URL(current);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SsrfError('unsupported scheme', `unsupported scheme "${url.protocol.replace(':', '')}"`);
    const rows = await resolveHost(url.hostname, resolve);
    const address = rows[0]!;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    const res = await transfer({ url, address, signal, maxBytes });
    const location = res.headers['location'];
    if ([301, 302, 303, 307, 308].includes(res.status) && location) {
      if (hop === maxRedirects) throw new SsrfError('redirect limit', `redirect limit of ${maxRedirects} exceeded`);
      current = new URL(location, url).toString();
      continue;
    }
    return { status: res.status, statusText: res.statusText, mediaType: (res.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase(), body: res.body, finalUrl: url.toString(), truncated: res.truncated === true };
  }
  throw new SsrfError('redirect limit', `redirect limit of ${maxRedirects} exceeded`);
}
