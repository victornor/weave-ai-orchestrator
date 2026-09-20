import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SECRET_HEADER = /key|token|secret|auth|cookie/i;
const MIN_SECRET_LENGTH = 8;

/**
 * The `debugWire` capture: one `<n>.jsonl` per request attempt under the run's wire directory, with
 * the request as sent and the response as received. It is opt-in because message content is kept.
 * Nothing that identifies the caller is: secret-looking headers are replaced, and every known secret
 * value (the provider key and the tool environment) is scrubbed from every line, so a key echoed
 * back in a body or an error message cannot land in the file either.
 */
export class WireLog {
  private n = 0;
  private path: string | null = null;
  private decoder = new TextDecoder('utf-8');
  private secrets: string[];

  constructor(private dir: string, secrets: Array<string | undefined>) {
    this.secrets = secrets.filter((s): s is string => typeof s === 'string' && s.length >= MIN_SECRET_LENGTH).sort((a, b) => b.length - a.length);
    mkdirSync(dir, { recursive: true });
  }

  scrub(text: string): string {
    let out = text;
    for (const s of this.secrets) if (out.includes(s)) out = out.split(s).join('[redacted]');
    return out;
  }

  private write(line: Record<string, unknown>): void {
    if (!this.path) return;
    try { appendFileSync(this.path, `${this.scrub(JSON.stringify(line))}\n`); } catch { /* a capture must never fail the turn */ }
  }

  /** Start the next file with the request. */
  request(url: string, headers: Record<string, string>, body: unknown): void {
    this.path = join(this.dir, `${++this.n}.jsonl`);
    this.decoder = new TextDecoder('utf-8');
    const shown = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, SECRET_HEADER.test(k) ? '[redacted]' : v]));
    this.write({ dir: 'request', at: new Date().toISOString(), url, headers: shown, body });
  }

  head(status: number, headers: Headers): void {
    const shown: Record<string, string> = {};
    headers.forEach((v, k) => { shown[k] = SECRET_HEADER.test(k) ? '[redacted]' : v; });
    this.write({ dir: 'response', at: new Date().toISOString(), status, headers: shown });
  }

  chunk(bytes: Uint8Array): void { const data = this.decoder.decode(bytes, { stream: true }); if (data) this.write({ dir: 'response', data }); }
  error(message: string): void { this.write({ dir: 'error', at: new Date().toISOString(), message }); }
}
