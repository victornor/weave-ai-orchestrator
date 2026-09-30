/**
 * `http.tls.mode: tailscale` (VS-765): a publicly trusted certificate for the daemon's own tailnet
 * name, fetched from the local tailscaled over its LocalAPI unix socket and renewed in place.
 *
 * The LocalAPI is used rather than the `tailscale` binary so a service manager's PATH does not
 * matter. Verified against tailscaled 1.102.4: `GET /localapi/v0/status` is the same JSON as
 * `tailscale status --json`; `GET /localapi/v0/cert/<name>?type=pair` answers with one PEM whose
 * first block is the private key, followed by the certificate chain; an unknown name answers 500
 * with the plain-text body `invalid domain "<name>"; must be one of [...]`.
 */
import { request } from 'node:http';
import { X509Certificate } from 'node:crypto';
import { getLogger } from '@weave-ai/core';

const log = getLogger('daemon');

export const DEFAULT_TAILSCALE_SOCKET = '/var/run/tailscale/tailscaled.sock';
/** How long start waits for tailscaled to come up (a reboot can start the daemon first). */
export const TAILSCALE_START_WAIT_MS = 150_000;
export const TAILSCALE_START_RETRY_MS = 5_000;
/** How often the certificate's remaining validity is checked. */
export const RENEW_CHECK_MS = 12 * 60 * 60 * 1000;
/** Renew when this much validity or less is left (Tailscale certificates last 90 days). */
export const RENEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Under this much validity a failed renewal is retried hourly instead of at the next check. */
const RENEW_URGENT_MS = 24 * 60 * 60 * 1000;
const RENEW_URGENT_RETRY_MS = 60 * 60 * 1000;

export interface TailscaleStatus {
  backendState: string;
  /** `Self.DNSName` without its trailing dot, or null when the node has none yet. */
  dnsName: string | null;
  certDomains: string[];
}

export interface TailscaleCertPair { cert: string; key: string }

export interface TailscaleClient {
  status(): Promise<TailscaleStatus>;
  cert(domain: string): Promise<TailscaleCertPair>;
}

export type TailscaleErrorCode = 'unreachable' | 'not_running' | 'https_disabled' | 'forbidden' | 'failed';

/** `unreachable` and `not_running` can clear by themselves; the others cannot be fixed by waiting. */
export class TailscaleError extends Error {
  constructor(readonly code: TailscaleErrorCode, message: string) {
    super(message);
    this.name = 'TailscaleError';
  }
  get transient(): boolean { return this.code === 'unreachable' || this.code === 'not_running'; }
}

interface LocalApiReply { status: number; body: string }

function localApiGet(socketPath: string, path: string, timeoutMs = 15_000): Promise<LocalApiReply> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path: `/localapi/v0${path}`, method: 'GET', headers: { Host: 'local-tailscaled.sock' }, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end();
  });
}

function unreachable(socketPath: string, e: unknown): TailscaleError {
  const detail = e instanceof Error ? e.message : String(e);
  return new TailscaleError('unreachable', `Tailscale is not running (cannot reach ${socketPath}: ${detail}). Start tailscaled, or set http.tls.mode to "files".`);
}

/** The real client: LocalAPI over tailscaled's unix socket. */
export function localApiClient(socketPath: string = process.env['AC_TAILSCALE_SOCKET'] ?? DEFAULT_TAILSCALE_SOCKET): TailscaleClient {
  return {
    async status() {
      let reply: LocalApiReply;
      try { reply = await localApiGet(socketPath, '/status'); }
      catch (e) { throw unreachable(socketPath, e); }
      if (reply.status === 403) throw forbidden();
      if (reply.status !== 200) throw new TailscaleError('failed', `Tailscale status answered ${reply.status}: ${reply.body.trim().slice(0, 200)}`);
      let json: { BackendState?: string; Self?: { DNSName?: string }; CertDomains?: string[] | null };
      try { json = JSON.parse(reply.body) as typeof json; }
      catch { throw new TailscaleError('failed', 'Tailscale status was not valid JSON'); }
      const dns = json.Self?.DNSName?.replace(/\.$/, '') ?? '';
      return { backendState: json.BackendState ?? 'Unknown', dnsName: dns || null, certDomains: json.CertDomains ?? [] };
    },
    async cert(domain) {
      let reply: LocalApiReply;
      try { reply = await localApiGet(socketPath, `/cert/${encodeURIComponent(domain)}?type=pair`, 60_000); }
      catch (e) { throw unreachable(socketPath, e); }
      if (reply.status === 403) throw forbidden();
      if (reply.status !== 200) throw new TailscaleError('failed', `Tailscale could not issue a certificate for ${domain} (${reply.status}): ${reply.body.trim().slice(0, 300)}`);
      return parsePair(reply.body, domain);
    },
  };
}

function forbidden(): TailscaleError {
  return new TailscaleError('forbidden', 'This user may not fetch certificates from tailscaled. Run `sudo tailscale set --operator=$USER` once, then restart the daemon.');
}

function httpsDisabled(): TailscaleError {
  return new TailscaleError('https_disabled', 'HTTPS certificates are not enabled for this tailnet. Enable "HTTPS Certificates" on the DNS page of the Tailscale admin console (https://login.tailscale.com/admin/dns).');
}

/** Split tailscaled's `type=pair` body (private key first, then the certificate chain). */
export function parsePair(pem: string, domain: string): TailscaleCertPair {
  const blocks = pem.match(/-----BEGIN ([A-Z ]+)-----[\s\S]*?-----END \1-----/g) ?? [];
  const keyBlocks = blocks.filter((b) => /PRIVATE KEY-----/.test(b.split('\n')[0]!));
  const certBlocks = blocks.filter((b) => b.startsWith('-----BEGIN CERTIFICATE-----'));
  if (keyBlocks.length !== 1 || certBlocks.length === 0) {
    throw new TailscaleError('failed', `Tailscale's certificate reply for ${domain} did not hold one private key and a certificate chain`);
  }
  return { key: `${keyBlocks[0]}\n`, cert: `${certBlocks.join('\n')}\n` };
}

export function certNotAfter(certPem: string): Date {
  return new Date(new X509Certificate(certPem).validTo);
}

export interface ResolveOptions {
  /** `http.tls.domains`; the first entry wins over the tailnet name. */
  domains: readonly string[];
  waitMs?: number;
  retryMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface ResolvedCert extends TailscaleCertPair { domain: string; notAfter: Date }

const realSleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

/**
 * One attempt: status, then the certificate. Throws a `TailscaleError` whose `code` says whether
 * waiting can help.
 */
export async function fetchTailscaleCert(client: TailscaleClient, domains: readonly string[]): Promise<ResolvedCert> {
  const status = await client.status();
  if (status.backendState !== 'Running') {
    throw new TailscaleError('not_running', `Tailscale is ${status.backendState}, not Running. Run \`tailscale up\`, or set http.tls.mode to "files".`);
  }
  const domain = domains[0] ?? status.dnsName;
  if (!domain) throw new TailscaleError('not_running', 'Tailscale is running but this node has no DNS name yet. Enable MagicDNS for the tailnet.');
  // An empty CertDomains is tailscaled's way of saying HTTPS certificates are off for the tailnet.
  if (status.certDomains.length === 0) throw httpsDisabled();
  if (!status.certDomains.includes(domain)) {
    throw new TailscaleError('failed', `"${domain}" is not a name Tailscale can issue a certificate for (it offers ${status.certDomains.join(', ')}). Fix http.tls.domains.`);
  }
  const pair = await client.cert(domain);
  return { ...pair, domain, notAfter: certNotAfter(pair.cert) };
}

/**
 * Start-up resolution: an unreachable tailscaled or a node that is not yet Running is waited for
 * (a reboot can start the daemon's unit first), every other failure is final.
 */
export async function resolveTailscaleCert(client: TailscaleClient, opts: ResolveOptions): Promise<ResolvedCert> {
  const waitMs = opts.waitMs ?? TAILSCALE_START_WAIT_MS;
  const retryMs = opts.retryMs ?? TAILSCALE_START_RETRY_MS;
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;
  const deadline = now() + waitMs;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetchTailscaleCert(client, opts.domains);
    } catch (e) {
      if (!(e instanceof TailscaleError) || !e.transient || now() + retryMs > deadline) throw e;
      log.info({ attempt, retryInMs: retryMs, reason: e.message }, 'waiting for tailscale before serving TLS');
      await sleep(retryMs);
    }
  }
}

export interface RenewalHandle { stop(): void }

/**
 * Re-checks the certificate on a schedule and hands a fresh one to `apply` while the current one has
 * `RENEW_WINDOW_MS` or less left. A failure keeps the current certificate in service and is retried:
 * at the next check, or hourly once under a day remains.
 */
export function startCertRenewal(o: {
  client: TailscaleClient;
  domains: readonly string[];
  current: ResolvedCert;
  apply: (pair: TailscaleCertPair) => void;
  checkMs?: number;
  windowMs?: number;
  now?: () => number;
}): RenewalHandle {
  const checkMs = o.checkMs ?? RENEW_CHECK_MS;
  const windowMs = o.windowMs ?? RENEW_WINDOW_MS;
  const now = o.now ?? Date.now;
  let current = o.current;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let running = false;

  const schedule = (delay: number): void => {
    if (stopped) return;
    timer = setTimeout(() => { void tick(); }, delay);
    timer.unref();
  };

  const tick = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    let next = checkMs;
    try {
      const left = current.notAfter.getTime() - now();
      if (left <= windowMs) {
        try {
          const fresh = await fetchTailscaleCert(o.client, o.domains);
          if (stopped) return;
          o.apply(fresh);
          current = fresh;
          log.info({ domain: fresh.domain, notAfter: fresh.notAfter.toISOString() }, 'renewed the tailscale certificate');
        } catch (e) {
          log.warn({ err: e instanceof Error ? e.message : String(e), validForMs: left }, 'tailscale certificate renewal failed; keeping the current certificate');
          if (left <= RENEW_URGENT_MS) next = Math.min(next, RENEW_URGENT_RETRY_MS);
        }
      }
    } finally {
      running = false;
      schedule(next);
    }
  };

  schedule(checkMs);
  return { stop() { stopped = true; if (timer) clearTimeout(timer); timer = null; } };
}
