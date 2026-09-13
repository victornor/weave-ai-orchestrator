/** The V2 route table: every destination addressable, nothing V2 supports the merge queue. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../v2/auth', () => ({
  v2Refused: vi.fn(async () => true),
  v2NextTarget: () => null,
  v2Landing: () => '/v2/w/acme/needs',
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

describe('the V2 route tree (VS-343, VS-353)', () => {
  const root = router.routeTree as unknown as RouteNode;
  const v2 = child(root, 'v2');
  // The signed-in chrome is a pathless layout, so it matches by id rather than by path.
  const shell = (v2?.children ?? []).find((r) => r.id === '/v2/v2-shell');

  beforeEach(() => localStorage.clear());

  it('mounts a /v2 subtree beside V1', () => {
    expect(v2).toBeDefined();
    expect(v2?.options?.component).toBeDefined();
  });

  it('puts the sign-in screen beside the shell, so it renders without chrome', () => {
    expect(child(v2!, 'login')).toBeDefined();
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
        'usage',
        'changelog',
        'p/$project',
        'tickets/$ticketId',
        'artifacts/$key',
        'workers/$workerId',
      ]),
    );
  });

  it('gives the merge queue no V2 route', () => {
    expect(collect(shell!).some((p) => p.includes('merge-queue'))).toBe(false);
  });

  it('resolves /v2 with no workspace to V2 onboarding, not V1', () => {
    const index = (v2?.children ?? []).find((r) => r.path === '/');
    let thrown: unknown;
    try {
      index?.options?.beforeLoad?.({ params: {}, search: {}, location: { pathname: '/v2' } });
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { options?: { to?: string } } | undefined)?.options?.to).toBe('/v2/onboarding');
  });

  it('sends an unauthenticated /v2 visit to /v2/login with the address remembered', async () => {
    let thrown: unknown;
    try {
      await v2?.options?.beforeLoad?.({ location: { pathname: '/v2/w/acme/work', href: '/v2/w/acme/work' } });
    } catch (e) {
      thrown = e;
    }
    const opts = (thrown as { options?: { to?: string; search?: { next?: string } } } | undefined)?.options;
    expect(opts?.to).toBe('/v2/login');
    expect(opts?.search?.next).toBe('/v2/w/acme/work');
  });

  it('never guards the sign-in screen itself', async () => {
    await expect(v2?.options?.beforeLoad?.({ location: { pathname: '/v2/login', href: '/v2/login' } })).resolves.toBeUndefined();
  });

  it('keeps V2 out of V1’s static module graph — only dynamic imports', () => {
    for (const file of ['src/router.tsx', 'src/main.tsx']) {
      const src = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(src).not.toMatch(/from\s+['"][^'"]*v2\//);
      expect(src).not.toMatch(/^\s*import\s+['"][^'"]*v2\//m);
    }
  });
});
