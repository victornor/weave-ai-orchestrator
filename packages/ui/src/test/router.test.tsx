import { describe, expect, it } from 'vitest';
import { router } from '../router';
import { MergeQueueRoute } from '../routes/MergeQueue';

interface RouteNode {
  path?: string;
  children?: RouteNode[];
  options?: { component?: unknown; validateSearch?: unknown };
}

/** Every workspace section is a child of `w/$ws`; a route missing here is unreachable by URL. */
const workspaceRoutes = (): RouteNode[] => {
  const root = router.routeTree as unknown as RouteNode;
  return (root.children ?? []).find((r) => r.path === 'w/$ws')?.children ?? [];
};

describe('the workspace routes', () => {
  it('registers the merge queue at its own address, with its own component', () => {
    const route = workspaceRoutes().find((r) => r.path === 'merge-queue');
    expect(route).toBeDefined();
    expect(route?.options?.component).toBe(MergeQueueRoute);
  });

  it('lets the merge queue carry the project it is showing in the URL', () => {
    const route = workspaceRoutes().find((r) => r.path === 'merge-queue');
    expect(route?.options?.validateSearch).toBeTypeOf('function');
    const passthrough = route?.options?.validateSearch as (s: Record<string, unknown>) => Record<string, unknown>;
    expect(passthrough({ project: 'p2' })).toEqual({ project: 'p2' });
  });
});
