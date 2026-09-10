/**
 * The SPA static server (VS-210, `daemon-upgrade/asset-serving`): a miss under the built asset
 * directory must 404, never fall back to the app shell, while an ordinary app route keeps falling
 * back to `index.html` exactly as before.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { staticRoutes } from '../src/static.js';
import { onError } from '../src/http.js';
import type { AppEnv } from '../src/types.js';

const tmps: string[] = [];
function uiDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'ac-ui-'));
  tmps.push(d);
  mkdirSync(join(d, 'assets'), { recursive: true });
  writeFileSync(join(d, 'index.html'), '<!doctype html><html><body>shell</body></html>', 'utf8');
  writeFileSync(join(d, 'assets', 'App-deadbeef1.js'), 'console.log("app")', 'utf8');
  return d;
}
afterEach(() => { while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true }); });

function app(root: string): Hono<AppEnv> {
  const a = new Hono<AppEnv>();
  a.onError(onError);
  a.route('/', staticRoutes(root));
  return a;
}

describe('a missing built asset', () => {
  it('404s with the standard error envelope, not a 200 HTML fallback', async () => {
    const res = await app(uiDir()).request('/assets/App-notreal99.js');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = await res.json();
    expect(body).toMatchObject({ error: { code: 'not_found' } });
  });
});

describe('an existing built asset', () => {
  it('is served unchanged, with its immutable caching', async () => {
    const res = await app(uiDir()).request('/assets/App-deadbeef1.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/javascript/);
    expect(res.headers.get('cache-control')).toMatch(/immutable/);
    expect(await res.text()).toBe('console.log("app")');
  });
});

describe('an ordinary app route', () => {
  it('still falls through to index.html when nothing matches', async () => {
    const res = await app(uiDir()).request('/w/acme/knowledge');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(await res.text()).toContain('shell');
  });
});
