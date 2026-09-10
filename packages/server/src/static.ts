/**
 * Serves the built web UI (`packages/ui/dist`) with an SPA fallback. Hashed assets are immutable;
 * `index.html` is never cached. A path under the built asset directory is content-addressed build
 * output: a miss there 404s rather than falling back to the app shell, since that would parse as
 * HTML where a script or stylesheet was expected. When the UI has not been built, every other path
 * gets a small page saying so rather than a 404.
 */
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { join, normalize, extname, resolve } from 'node:path';
import { Hono } from 'hono';
import { OcError } from '@agent-conductor/shared';
import type { AppEnv } from './types.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

const PLACEHOLDER = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>AgentConductor</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:15px/1.6 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#0f1115;color:#e6e8ee}
main{max-width:38rem;padding:2rem}code{background:#1b1f28;padding:.15em .4em;border-radius:4px}a{color:#7aa2f7}</style>
</head><body><main><h1>AgentConductor daemon is running</h1>
<p>The web UI has not been built. Run <code>pnpm --filter @agent-conductor/ui run build</code> and reload.</p>
<p>The API is live at <code>/api</code>; see <a href="/api/openapi.json">/api/openapi.json</a> and <a href="/llms/api.txt">/llms/api.txt</a>.</p>
</main></body></html>`;

const ASSET_DIR = 'assets/';

export function staticRoutes(uiDir: string | null | undefined): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const root = uiDir && existsSync(uiDir) ? resolve(uiDir) : null;

  app.get('*', async (c) => {
    if (!root) return c.html(PLACEHOLDER, 200);
    const requested = decodeURIComponent(new URL(c.req.url).pathname);
    const rel = relPath(root, requested);
    if (rel !== null && rel.startsWith(ASSET_DIR)) {
      const candidate = join(root, rel);
      if (!(await isFile(candidate))) throw new OcError('not_found', `no built asset at /${rel}`);
      return serveFile(candidate);
    }
    const file = await resolveFile(root, requested);
    if (!file) return c.html(PLACEHOLDER, 200);
    return serveFile(file);
  });

  return app;
}

async function serveFile(file: string): Promise<Response> {
  const info = await stat(file);
  const ext = extname(file);
  const immutable = /\/assets\//.test(file) && /[.-][0-9a-f]{8,}\./i.test(file);
  return new Response(Readable.toWeb(createReadStream(file)) as unknown as ReadableStream, {
    headers: {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'content-length': String(info.size),
      'cache-control': ext === '.html' ? 'no-cache' : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    },
  });
}

/** The requested path relative to `root`, or `null` if it would escape it. */
function relPath(root: string, pathname: string): string | null {
  const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
  return join(root, rel).startsWith(root) ? rel : null;
}

async function resolveFile(root: string, pathname: string): Promise<string | null> {
  const rel = relPath(root, pathname);
  if (rel === null) return null;
  const candidate = join(root, rel);
  if (rel && (await isFile(candidate))) return candidate;
  const index = join(root, 'index.html');
  return (await isFile(index)) ? index : null;   // SPA fallback
}

async function isFile(p: string): Promise<boolean> {
  try { return (await stat(p)).isFile(); } catch { return false; }
}
