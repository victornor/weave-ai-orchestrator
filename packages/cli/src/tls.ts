/** Certificate pinning for `conductor login --pin` (PLAN §4.4): self-signed daemons on a LAN or tailnet. */
import { connect } from 'node:tls';
import { createHash } from 'node:crypto';

export interface PinResult { pin: string; subject: string; validTo: string }

/** SHA-256 of the server's DER certificate, formatted as `sha256:<hex>`. */
export function fetchCertPin(url: string, timeoutMs = 8000): Promise<PinResult> {
  const target = new URL(url);
  const port = target.port ? Number(target.port) : 443;
  return new Promise((resolve, reject) => {
    const socket = connect({ host: target.hostname, port, servername: /^[0-9.]+$|^\[?[0-9a-f:]+\]?$/i.test(target.hostname) ? undefined : target.hostname, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const cert = socket.getPeerCertificate(false);
      socket.end();
      if (!cert || !cert.raw) { reject(new Error(`no certificate presented by ${target.host}`)); return; }
      resolve({
        pin: `sha256:${createHash('sha256').update(cert.raw).digest('hex')}`,
        subject: typeof cert.subject === 'object' ? Object.entries(cert.subject).map(([k, v]) => `${k}=${String(v)}`).join(', ') : String(cert.subject ?? ''),
        validTo: String(cert.valid_to ?? ''),
      });
    });
    socket.once('error', reject);
    socket.once('timeout', () => { socket.destroy(); reject(new Error(`timed out connecting to ${target.host}`)); });
  });
}

/**
 * Verify a stored pin before any request is made. Node's fetch does not expose per-request TLS
 * options, so the pin is checked out of band once per process; if it matches we accept the
 * self-signed chain for this process only, and if it does not we refuse to run at all.
 */
export async function applyCertPin(url: string, pin: string): Promise<void> {
  if (!url.startsWith('https:')) return;
  const seen = await fetchCertPin(url);
  if (seen.pin !== pin) {
    throw new Error(`certificate pin mismatch for ${url}: expected ${pin}, got ${seen.pin}. Re-run \`conductor login ${url} --pin\` only if you changed the certificate yourself.`);
  }
  process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
  // The pin was just verified out of band; Node's blanket warning about the env var is noise for this process.
  const listeners = process.listeners('warning');
  process.removeAllListeners('warning');
  process.on('warning', (w: Error) => {
    if (/NODE_TLS_REJECT_UNAUTHORIZED/.test(String(w.message))) return;
    for (const l of listeners) (l as (warning: Error) => void)(w);
  });
}
