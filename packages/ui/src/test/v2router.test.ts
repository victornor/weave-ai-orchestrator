/** The V2 route table: every destination addressable, nothing V2 supports the merge queue. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { router } from '../router';

interface RouteNode {
  path?: string;
  children?: RouteNode[];
  options?: { component?: unknown };
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

describe('the V2 route tree (VS-343)', () => {
  const root = router.routeTree as unknown as RouteNode;
  const v2 = child(root, 'v2');

  it('mounts a /v2 subtree beside V1', () => {
    expect(v2).toBeDefined();
    expect(v2?.options?.component).toBeDefined();
  });

  it('registers every global destination', () => {
    const paths = (v2?.children ?? []).map((r) => norm(r.path));
    expect(paths).toEqual(
      expect.arrayContaining(['needs', 'live', 'incidents', 'map', 'runs', 'runs/$runId', 'scheduled', 'settings', 'chats', 'w/$ws']),
    );
  });

  it('registers every workspace destination', () => {
    const ws = child(v2!, 'w/$ws');
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
    expect(collect(v2!).some((p) => p.includes('merge-queue'))).toBe(false);
  });

  it('keeps V2 out of V1’s static module graph — only dynamic imports', () => {
    for (const file of ['src/router.tsx', 'src/main.tsx']) {
      const src = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(src).not.toMatch(/from\s+['"][^'"]*v2\//);
      expect(src).not.toMatch(/^\s*import\s+['"][^'"]*v2\//m);
    }
  });
});
