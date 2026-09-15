/** The app route table (VS-343/VS-353), promoted to the root (VS-456): every destination addressable
 * at a root path, nothing supports the merge queue, and every retired address redirects. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../v2/auth', () => ({
  v2Refused: vi.fn(async () => true),
  v2NextTarget: () => null,
  v2Landing: () => '/w/acme/needs',
  resetV2RefusedCache: vi.fn(),
}));

const { router } = await import('../router');

interface RouteNode {
  id?: string;
  path?: string;
  children?: RouteNode[];
  options?: { component?: unknown; beforeLoad?: (arg: unknown) => unknown };
}

const norm = (p: string | undefined): string => (p ?? '').replace(/^\//, '');

function child(node: RouteNode, path: string): RouteNode | undefined {
  return (node.children ?? []).find((r) => norm(r.path) === path);
}

function collect(node: RouteNode, acc: string[] = []): string[] {
  for (const c of node.children ?? []) {
    acc.push(norm(c.path));
    collect(c, acc);
  }
  return acc;
}

/** The options of the redirect a route's `beforeLoad` throws. */
function redirectOptions(route: RouteNode | undefined, arg: unknown): Record<string, unknown> | undefined {
  let thrown: unknown;
  try {
    route?.options?.beforeLoad?.(arg);
  } catch (e) {
    thrown = e;
  }
  return (thrown as { options?: Record<string, unknown> } | undefined)?.options;
}

describe('the app route tree (VS-343, VS-353, VS-456)', () => {
  const root = router.routeTree as unknown as RouteNode;
  // The app root is the one child whose path is `/` (norm '').
  const app = child(root, '');
  // The signed-in chrome is a pathless layout, so it matches by id rather than by path.
  const shell = (app?.children ?? []).find((r) => (r.id ?? '').endsWith('v2-shell'));

  beforeEach(() => localStorage.clear());

  it('mounts the app at the root', () => {
    expect(app).toBeDefined();
    expect(app?.id).toBe('/app-root');
    expect(app?.path).toBeUndefined();
    expect(app?.options?.component).toBeDefined();
  });

  it('puts the sign-in screen beside the shell, so it renders without chrome', () => {
    expect(child(app!, 'login')).toBeDefined();
    expect(shell).toBeDefined();
    // login is a direct child of the token root, not of the shell.
    expect((shell?.children ?? []).some((r) => norm(r.path) === 'login')).toBe(false);
  });

  it('registers every global destination under the shell', () => {
    const paths = (shell?.children ?? []).map((r) => norm(r.path));
    expect(paths).toEqual(
      expect.arrayContaining(['onboarding', 'needs', 'live', 'incidents', 'map', 'runs', 'runs/$runId', 'scheduled', 'settings', 'chats', 'w/$ws']),
    );
  });

  it('renders every signed-in destination inside the shell, not beside it', () => {
    // Only the chromeless sign-in screen and the bare-index redirect may sit beside the shell.
    const beside = (app?.children ?? []).filter((r) => {
      const path = norm(r.path);
      return !(r.id ?? '').endsWith('v2-shell') && path !== 'login' && path !== '';
    });
    expect(beside.map((r) => norm(r.path))).toEqual([]);
  });

  it('registers every workspace destination', () => {
    const ws = child(shell!, 'w/$ws');
    expect(ws).toBeDefined();
    const paths = (ws?.children ?? []).map((r) => norm(r.path));
    expect(paths).toEqual(
      expect.arrayContaining([
        'chat',
        'needs',
        'work',
        'roles',
        'knowledge',
        'knowledge/graph',
        'knowledge/explorer',
        'knowledge/changelog',
        'knowledge/specs',
        'usage',
        'changelog',
        'p/$project',
        'tickets/$ticketId',
        'artifacts/$key',
        'workers/$workerId',
        'plugins/$pluginId',
      ]),
    );
  });

  it('redirects the old Team address to Roles (VS-455)', () => {
    const ws = child(shell!, 'w/$ws');
    const team = child(ws!, 'team');
    const opts = redirectOptions(team, { params: { ws: 'acme' }, search: {} });
    expect(opts?.to).toBe('/w/$ws/roles');
    expect((opts?.params as { ws?: string })?.ws).toBe('acme');
  });

  it('renders V2PluginPage at the plugin route (VS-385)', () => {
    const ws = child(shell!, 'w/$ws');
    const pluginRoute = child(ws!, 'plugins/$pluginId');
    expect(pluginRoute?.options?.component).toBeDefined();
  });

  it('gives the merge queue no route', () => {
    expect(collect(shell!).some((p) => p.includes('merge-queue'))).toBe(false);
  });

  it('resolves the root with no workspace to onboarding', () => {
    const index = (app?.children ?? []).find((r) => r.path === '/');
    const opts = redirectOptions(index, { params: {}, search: {}, location: { pathname: '/' } });
    expect(opts?.to).toBe('/onboarding');
  });

  it('sends an unauthenticated visit to /login with the address remembered', async () => {
    let thrown: unknown;
    try {
      await app?.options?.beforeLoad?.({ location: { pathname: '/w/acme/work', href: '/w/acme/work' } });
    } catch (e) {
      thrown = e;
    }
    const opts = (thrown as { options?: { to?: string; search?: { next?: string } } } | undefined)?.options;
    expect(opts?.to).toBe('/login');
    expect(opts?.search?.next).toBe('/w/acme/work');
  });

  it('never guards the sign-in screen itself', async () => {
    await expect(app?.options?.beforeLoad?.({ location: { pathname: '/login', href: '/login' } })).resolves.toBeUndefined();
  });

  it('keeps the shell out of the static entry module graph — only dynamic imports', () => {
    for (const file of ['src/router.tsx', 'src/main.tsx']) {
      const src = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(src).not.toMatch(/from\s+['"][^'"]*v2\//);
      expect(src).not.toMatch(/^\s*import\s+['"][^'"]*v2\//m);
    }
  });

  it('serves the real kept-V1 screens, not placeholders (VS-352)', () => {
    const pages = readFileSync(resolve(process.cwd(), 'src/v2/pages.tsx'), 'utf8');
    expect(pages).toContain("export { V2ChatsScreen as V2ChatsPage } from './chats/ChatsPage'");
    expect(pages).toContain("export { V2UsageScreen as V2UsagePage } from './usage/UsagePage'");
    expect(pages).toContain("export { V2ChangelogScreen as V2ChangelogPage } from './changelog/ChangelogPage'");
    expect(pages).toContain("export { V2ProjectScreen as V2ProjectPage } from './project/ProjectPage'");
    // No bare placeholder function is left behind for those four.
    for (const title of ['Chats', 'Usage', 'Changelog', 'Project']) {
      expect(pages).not.toMatch(new RegExp(`<V2Page title="${title}"`));
    }
  });
});

describe('the retired addresses (VS-456)', () => {
  const root = router.routeTree as unknown as RouteNode;
  const legacy = (path: string): RouteNode | undefined => (root.children ?? []).find((r) => norm(r.path) === path);

  it('/v2 and /v2/* lose the prefix', () => {
    expect(redirectOptions(legacy('v2'), { location: { pathname: '/v2', searchStr: '?a=1' } })).toMatchObject({ href: '/?a=1' });
    expect(redirectOptions(legacy('v2/$'), { location: { pathname: '/v2/w/acme/work', searchStr: '' } })).toMatchObject({ href: '/w/acme/work' });
    expect(redirectOptions(legacy('v2/$'), { location: { pathname: '/v2/runs', searchStr: '?ws=acme' } })).toMatchObject({ href: '/runs?ws=acme' });
  });

  it('/w/$ws/board lands on Work', () => {
    const opts = redirectOptions(legacy('w/$ws/board'), { params: { ws: 'acme' } });
    expect(opts?.to).toBe('/w/$ws/work');
    expect((opts?.params as { ws?: string })?.ws).toBe('acme');
  });

  it('/w/$ws/merge-queue lands on Work, keeping the project', () => {
    const opts = redirectOptions(legacy('w/$ws/merge-queue'), { params: { ws: 'acme' }, search: { project: 'p1' } });
    expect(opts?.to).toBe('/w/$ws/work');
    expect((opts?.params as { ws?: string })?.ws).toBe('acme');
    expect(opts?.search).toEqual({ project: 'p1' });
  });

  it('/w/$ws/live lands on the global Live, scoped', () => {
    const opts = redirectOptions(legacy('w/$ws/live'), { params: { ws: 'acme' }, search: {} });
    expect(opts?.to).toBe('/live');
    expect(opts?.search).toEqual({ ws: 'acme' });
  });

  it('/w/$ws/runs lands on the global Runs, scoped', () => {
    const opts = redirectOptions(legacy('w/$ws/runs'), { params: { ws: 'acme' }, search: {} });
    expect(opts?.to).toBe('/runs');
    expect(opts?.search).toEqual({ ws: 'acme' });
  });

  it('/w/$ws/runs/$runId drops the workspace segment', () => {
    const opts = redirectOptions(legacy('w/$ws/runs/$runId'), { params: { ws: 'acme', runId: 'run_1' } });
    expect(opts?.to).toBe('/runs/$runId');
    expect((opts?.params as { runId?: string })?.runId).toBe('run_1');
  });

  it('/w/$ws/settings lands on the global settings, scoped', () => {
    const opts = redirectOptions(legacy('w/$ws/settings'), { params: { ws: 'acme' }, search: {} });
    expect(opts?.to).toBe('/settings');
    expect(opts?.search).toEqual({ scope: 'acme' });
  });

  it('leaves an already-matching shape to its own route, without a redirect', () => {
    // No retired route carries a ticket address, and the app's own route does.
    expect(legacy('w/$ws/tickets/$ticketId')).toBeUndefined();
    const shell = (child(root, '')?.children ?? []).find((r) => (r.id ?? '').endsWith('v2-shell'));
    expect(child(child(shell!, 'w/$ws')!, 'tickets/$ticketId')).toBeDefined();
  });

  it('has no catch-all that would redirect an unknown path', () => {
    // Only the listed retired addresses redirect; everything else reaches the router's not-found.
    const rootPaths = (root.children ?? []).map((r) => norm(r.path));
    expect(rootPaths).not.toContain('$');
    expect(rootPaths).not.toContain('*');
  });
});
