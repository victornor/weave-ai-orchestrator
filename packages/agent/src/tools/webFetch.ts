import { fetchWithPolicy, SsrfError, type Resolver, type Transfer } from '../net/ssrf.js';
import { errorOutput, type ToolDefinition } from './index.js';

export const WEB_FETCH_MAX_BYTES = 5 * 1024 * 1024;
export const WEB_FETCH_RESULT_MAX_CHARS = 50 * 1024;
export const WEB_FETCH_TIMEOUT_MS = 30_000;

export interface WebFetchDeps {
  /** Defaults to `dns.promises.lookup`; a test supplies a fake resolver. */
  resolve?: Resolver;
  /** Defaults to the node http/https transfer; a test supplies a fake. */
  transfer?: Transfer;
}

/** Textual media types returned as they are; HTML is reduced; anything else is refused. */
const TEXTUAL = /^(text\/|application\/(json|xml|xhtml\+xml|javascript|ecmascript|graphql|ld\+json|yaml|x-yaml)|image\/svg\+xml)/;

export function makeWebFetchTool(deps: WebFetchDeps = {}): ToolDefinition {
  return {
    name: 'web_fetch',
    description: 'Fetch an http(s) URL and return its text. Refuses loopback, private, link-local and cloud-metadata addresses, directly and through redirects.',
    readOnly: true,
    parameters: {
      type: 'object', additionalProperties: false, required: ['url'],
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL' },
        max_bytes: { type: 'integer', minimum: 1, maximum: WEB_FETCH_MAX_BYTES, description: `How many bytes to read (default and maximum ${WEB_FETCH_MAX_BYTES})` },
      },
    },
    async run(args, ctx) {
      if (typeof args['url'] !== 'string' || !args['url']) return errorOutput('url is required');
      let url: URL;
      try { url = new URL(args['url']); } catch { return errorOutput(`invalid url "${args['url']}"`); }
      const requested = typeof args['max_bytes'] === 'number' && Number.isFinite(args['max_bytes']) ? Math.floor(args['max_bytes']) : WEB_FETCH_MAX_BYTES;
      const maxBytes = Math.max(1, Math.min(requested, WEB_FETCH_MAX_BYTES));
      try {
        const res = await fetchWithPolicy(url.toString(), {
          ...(deps.resolve ? { resolve: deps.resolve } : {}),
          ...(deps.transfer ? { transfer: deps.transfer } : {}),
          signal: ctx.signal, maxBytes, timeoutMs: WEB_FETCH_TIMEOUT_MS,
        });
        const text = readable(res.mediaType, res.body);
        if (text === null) return errorOutput(`web_fetch refused binary content type "${res.mediaType || 'unknown'}"`);
        const header = `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''} ${res.finalUrl}`;
        const note = res.truncated ? `\n[output truncated at ${maxBytes} bytes]` : '';
        return { text: capResult(`${header}\n${text}${note}`) };
      } catch (e) {
        if (e instanceof SsrfError) return errorOutput(`web_fetch refused ${e.message}`);
        return errorOutput(`web_fetch failed: ${(e as Error).message}`);
      }
    },
  };
}

function readable(mediaType: string, body: Buffer): string | null {
  const text = body.toString('utf8');
  if (mediaType === 'text/html' || mediaType === 'application/xhtml+xml') return htmlToText(text);
  if (mediaType === '' || TEXTUAL.test(mediaType)) return text;
  return null;
}

/** A small HTML reducer: drop script/style/comments, turn block tags into newlines, strip the rest, decode entities. */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|ul|ol|h[1-6]|tr|table|header|footer|nav|main|pre|blockquote)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s.split('\n').map((l) => l.replace(/[ \t\r\f\v]+/g, ' ').trim()).filter((l) => l.length > 0).join('\n');
}

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…',
  copy: '©', reg: '®', trade: '™', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·', bull: '•',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[body] ?? m;
  });
}

function capResult(text: string): string {
  return text.length > WEB_FETCH_RESULT_MAX_CHARS ? `${text.slice(0, WEB_FETCH_RESULT_MAX_CHARS)}\n[truncated at ${WEB_FETCH_RESULT_MAX_CHARS} characters]` : text;
}
