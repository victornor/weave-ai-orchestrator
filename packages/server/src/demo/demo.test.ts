import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright-core';
import { startDemo, type DemoHandle } from './index.js';
import { capture } from './capture.js';
import { PRIMARY_WORKSPACE, SHOTS } from './manifest.js';

const uiDist = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'ui', 'dist');
const browserReady = ((): boolean => {
  if (!existsSync(join(uiDist, 'index.html'))) return false;
  if (process.env['CHROME_PATH'] && existsSync(process.env['CHROME_PATH'])) return true;
  try { if (existsSync(chromium.executablePath())) return true; } catch { /* no bundled browser */ }
  return ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].some((p) => existsSync(p));
})();

describe('the demo daemon (VS-770)', () => {
  let dir: string;
  let demo: DemoHandle;
  let base: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'weave-demo-daemon-'));
    demo = await startDemo({ dir: join(dir, 'config'), port: 0, uiDir: existsSync(uiDist) ? uiDist : null });
    base = demo.publicUrl;
  }, 60_000);

  afterAll(async () => {
    await demo?.stop('test');
    rmSync(dir, { recursive: true, force: true });
  });

  const get = async (path: string): Promise<{ status: number; body: unknown }> => {
    const res = await fetch(`${base}${path}`);
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  it('registers only the pretend runtimes and forge: nothing can reach a coding CLI, git remote or network', () => {
    expect([...demo.registries.runtimes.keys()].sort()).toEqual(['claude', 'codex']);
    expect([...demo.registries.channels.keys()]).toEqual([]);
    expect([...demo.registries.surfaces.keys()]).toEqual([]);
    expect(demo.registries.forges.get('github')?.id).toBe('github');
    expect(demo.registries.forges.get('github')?.constructor.name).toBe('Object');
  });

  it('serves a populated workspace through the real routes', async () => {
    const tickets = await get(`/api/w/${PRIMARY_WORKSPACE}/tickets`);
    expect(tickets.status).toBe(200);
    expect((tickets.body as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(15);
    const decisions = await get(`/api/w/${PRIMARY_WORKSPACE}/decisions`);
    expect((decisions.body as unknown[]).length).toBeGreaterThanOrEqual(10);
    const health = await get('/api/health');
    expect((health.body as { workspaces: Array<{ id: string }> }).workspaces.map((w) => w.id).sort()).toEqual(['fernwood', 'lumen']);
  });

  it('resolves the data behind every manifest route', async () => {
    for (const shot of SHOTS) {
      const path = shot.path.replace('{ws}', PRIMARY_WORKSPACE);
      let probe: string | null = null;
      let m: RegExpExecArray | null;
      if ((m = /^\/w\/([^/]+)\/tickets\/(.+)$/.exec(path))) probe = `/api/w/${m[1]}/tickets/${m[2]}`;
      else if ((m = /^\/w\/([^/]+)\/workers\/(.+)$/.exec(path))) probe = `/api/w/${m[1]}/workers/${m[2]}`;
      else if ((m = /^\/runs\/(.+)$/.exec(path))) probe = `/api/w/${PRIMARY_WORKSPACE}/runs/${m[1]}`;
      else if ((m = /^\/w\/([^/]+)\/p\/([^/]+)/.exec(path))) probe = `/api/w/${m[1]}/projects/${m[2]}`;
      if (probe) expect((await get(probe)).status, `${shot.name}: ${probe}`).toBe(200);
    }
  });

  it('keeps its running runs moving: the player appends scripted events', async () => {
    const runs = (await get(`/api/w/${PRIMARY_WORKSPACE}/runs?status=running`)).body as { items: Array<{ id: string }> };
    expect(runs.items.length).toBeGreaterThanOrEqual(3);
    const before = ((await get(`/api/w/${PRIMARY_WORKSPACE}/runs/${runs.items[0]!.id}/events`)).body as unknown[]).length;
    await new Promise((r) => setTimeout(r, 3_500));
    const after = ((await get(`/api/w/${PRIMARY_WORKSPACE}/runs/${runs.items[0]!.id}/events`)).body as unknown[]).length;
    expect(after).toBeGreaterThan(before);
  }, 15_000);

  it.skipIf(!browserReady)('renders every manifest route without a page error or a failed request', async () => {
    const results = await capture({ baseUrl: base, outDir: join(dir, 'shots'), check: true, viewports: ['desktop'], themes: ['dark'] });
    expect(results).toHaveLength(SHOTS.length);
    const failed = results.filter((r) => r.errors.length > 0).map((r) => `${r.name}: ${r.errors.join('; ')}`);
    expect(failed).toEqual([]);
  }, 240_000);
});
