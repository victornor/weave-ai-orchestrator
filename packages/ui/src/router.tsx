import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Outlet, redirect } from '@tanstack/react-router';
import { RouteError } from './components/RouteError';
import { getWorkspaceId } from './api/client';

const rootRoute = createRootRoute({ component: () => <Outlet /> });

// ---- The app (VS-343), promoted from `/v2` to the root (VS-456) ----
// One frontend, served at `/`: the shell and every page load through `lazyRouteComponent`, so the
// entry chunk carries none of their module or CSS. Workspace pages are `/w/$ws/<section>`, global
// pages are `/<section>`. V1's route tree is deliberately *not* mounted below — it answers no URL,
// and the follow-up deletion ticket removes its modules. Retired addresses redirect at the end.
// Pathless with an explicit id: it adds no URL segment, and every child below carries its full
// root path. A path of `/` would instead collide with the index route's own id.
const v2RootRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app-root',
  component: lazyRouteComponent(() => import('./v2/V2Root'), 'V2Root'),
  // Every signed-in page needs a session; `/login` is exempt so the guard cannot loop. Kept as a
  // dynamic import so the app entry bundle still carries none of the shell module (VS-343/VS-353).
  beforeLoad: async ({ location }) => {
    if (location.pathname === '/login') return;
    const { v2Refused } = await import('./v2/auth');
    if (await v2Refused()) {
      throw redirect({ to: '/login', search: { next: location.href } as never });
    }
  },
});

const v2IndexRoute = createRoute({
  getParentRoute: () => v2RootRoute,
  path: '/',
  beforeLoad: () => {
    const ws = getWorkspaceId();
    throw redirect({ to: (ws ? `/w/${ws}/needs` : '/onboarding') as never });
  },
  component: () => null,
});

// The sign-in screen is chromeless: it sits beside the shell, not inside it (VS-353).
const v2LoginRoute = createRoute({
  getParentRoute: () => v2RootRoute,
  path: '/login',
  validateSearch: (s: Record<string, unknown>) => s,
  component: lazyRouteComponent(() => import('./v2/V2Login'), 'V2Login'),
});

// The rail and the phone tab bar wrap every signed-in destination. A pathless layout route adds no
// URL segment, so no address changes.
const v2ShellRoute = createRoute({
  getParentRoute: () => v2RootRoute,
  id: 'v2-shell',
  component: lazyRouteComponent(() => import('./v2/V2Root'), 'V2ShellLayout'),
});

type V2PageExports = typeof import('./v2/pages');

const v2GlobalRoute = <K extends keyof V2PageExports>(path: string, page: K) =>
  createRoute({
    getParentRoute: () => v2ShellRoute,
    path,
    validateSearch: (s: Record<string, unknown>) => s,
    component: lazyRouteComponent(() => import('./v2/pages'), page),
  });

const v2OnboardingRoute = createRoute({
  getParentRoute: () => v2ShellRoute,
  path: '/onboarding',
  component: lazyRouteComponent(() => import('./v2/V2Onboarding'), 'V2OnboardingPage'),
});

const v2WsRoute = createRoute({
  getParentRoute: () => v2ShellRoute,
  path: '/w/$ws',
  component: lazyRouteComponent(() => import('./v2/V2Root'), 'V2Workspace'),
});

const v2WsIndexRoute = createRoute({
  getParentRoute: () => v2WsRoute,
  path: '/',
  beforeLoad: ({ params }) => {
    throw redirect({ to: `/w/${(params as { ws: string }).ws}/needs` as never });
  },
  component: () => null,
});

const v2WsRouteFor = <K extends keyof V2PageExports>(path: string, page: K) =>
  createRoute({
    getParentRoute: () => v2WsRoute,
    path,
    component: lazyRouteComponent(() => import('./v2/pages'), page),
  });

const v2NeedsRoute = v2GlobalRoute('/needs', 'V2NeedsPage');
// Live reads a `worker` search param, so it validates search by passthrough like the other pages.
// It is its own `createRoute` (not `v2GlobalRoute`) and so was missed when VS-353 re-parented the
// children under the shell; it must sit under the shell like every other signed-in destination.
const v2LiveRoute = createRoute({
  getParentRoute: () => v2ShellRoute,
  path: '/live',
  validateSearch: (s: Record<string, unknown>) => s,
  component: lazyRouteComponent(() => import('./v2/pages'), 'V2LivePage'),
});
const v2IncidentsRoute = v2GlobalRoute('/incidents', 'V2IncidentsPage');
const v2MapRoute = v2GlobalRoute('/map', 'V2MapPage');
const v2RunsRoute = v2GlobalRoute('/runs', 'V2RunsPage');
const v2RunRoute = v2GlobalRoute('/runs/$runId', 'V2RunPage');
const v2ScheduledRoute = v2GlobalRoute('/scheduled', 'V2ScheduledPage');
const v2SettingsRoute = v2GlobalRoute('/settings', 'V2SettingsPage');
const v2ChatsRoute = v2GlobalRoute('/chats', 'V2ChatsPage');

const v2ChatRoute = v2WsRouteFor('chat', 'V2ChatPage');
const v2WsNeedsRoute = v2WsRouteFor('needs', 'V2NeedsPage');
const v2WorkRoute = v2WsRouteFor('work', 'V2WorkPage');
const v2RolesRoute = v2WsRouteFor('roles', 'V2RolesPage');
// The page was named Team before VS-333; V1 kept the old address resolving and V2 mirrors the
// alias, so a `/team` link lands on Roles (VS-455).
const v2TeamRedirectRoute = createRoute({
  getParentRoute: () => v2WsRoute,
  path: '/team',
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/w/$ws/roles', params: { ws: (params as { ws: string }).ws } } as never);
  },
  component: () => null,
});
const v2KnowledgeRoute = v2WsRouteFor('knowledge', 'V2KnowledgePage');
const v2KnowledgeGraphRoute = v2WsRouteFor('knowledge/graph', 'V2GraphPage');
const v2KnowledgeExplorerRoute = v2WsRouteFor('knowledge/explorer', 'V2ExplorerPage');
const v2KnowledgeChangelogRoute = v2WsRouteFor('knowledge/changelog', 'V2KnowledgeChangelogPage');
const v2KnowledgeSpecsRoute = v2WsRouteFor('knowledge/specs', 'V2KnowledgeSpecsPage');
const v2UsageRoute = v2WsRouteFor('usage', 'V2UsagePage');
const v2ChangelogRoute = v2WsRouteFor('changelog', 'V2ChangelogPage');
const v2ProjectRoute = v2WsRouteFor('p/$project', 'V2ProjectPage');
// VS-452: the change explorer, deep-linkable per file. A sibling of the project page rather than a
// child, so a file's own URL is stable (`p/:project/changes/:number?file=`).
const v2ChangesRoute = createRoute({
  getParentRoute: () => v2WsRoute,
  path: 'p/$project/changes/$number',
  validateSearch: (s: Record<string, unknown>) => s,
  component: lazyRouteComponent(() => import('./v2/pages'), 'V2ChangeExplorerPage'),
});
const v2TicketRoute = v2WsRouteFor('tickets/$ticketId', 'V2TicketPage');
const v2TicketArtifactRoute = v2WsRouteFor('tickets/$ticketId/artifacts/$key', 'V2TicketArtifactReader');
const v2ArtifactRoute = v2WsRouteFor('artifacts/$key', 'V2ArtifactPage');
const v2WorkerRoute = v2WsRouteFor('workers/$workerId', 'V2WorkerPage');
const v2PluginPageRoute = v2WsRouteFor('plugins/$pluginId', 'V2PluginPage');

// ---- Retired addresses (VS-456) ----
// The app was served at `/v2` and V1 owned `/`. Both schemes must keep resolving, matching the
// redirect table in the web-v2/navigation spec. These routes render nothing; they only redirect,
// so a typed address or a hard reload lands on the destination address with its query intact.

/** `/v2/*` loses the prefix; `/v2` alone becomes the root. */
const legacyV2Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/v2',
  component: () => null,
  beforeLoad: ({ location }) => {
    throw redirect({ href: `/${location.searchStr ?? ''}` });
  },
});
const legacyV2WildRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/v2/$',
  component: () => null,
  beforeLoad: ({ location }) => {
    const rest = location.pathname.replace(/^\/v2(?=\/|$)/, '');
    throw redirect({ href: `${rest || '/'}${location.searchStr ?? ''}` });
  },
});

/** `/w/$ws/board` → `/w/$ws/work`. */
const legacyBoardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/w/$ws/board',
  component: () => null,
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/w/$ws/work', params: { ws: (params as { ws: string }).ws } } as never);
  },
});

/** `/w/$ws/merge-queue?project=X` → `/w/$ws/work?project=X`; the search is carried whole. */
const legacyMergeQueueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/w/$ws/merge-queue',
  validateSearch: (s: Record<string, unknown>) => s,
  component: () => null,
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: '/w/$ws/work', params: { ws: (params as { ws: string }).ws }, search } as never);
  },
});

/** A workspace's Live is now the global Live, scoped: `/w/$ws/live` → `/live?ws=$ws`. */
const legacyWorkspaceLiveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/w/$ws/live',
  validateSearch: (s: Record<string, unknown>) => s,
  component: () => null,
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: '/live', search: { ...search, ws: (params as { ws: string }).ws } } as never);
  },
});

/** A workspace's Runs is now the global Runs, scoped: `/w/$ws/runs` → `/runs?ws=$ws`. */
const legacyWorkspaceRunsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/w/$ws/runs',
  validateSearch: (s: Record<string, unknown>) => s,
  component: () => null,
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: '/runs', search: { ...search, ws: (params as { ws: string }).ws } } as never);
  },
});

/** A run detail drops its workspace segment: `/w/$ws/runs/$runId` → `/runs/$runId`. */
const legacyWorkspaceRunRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/w/$ws/runs/$runId',
  component: () => null,
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/runs/$runId', params: { runId: (params as { runId: string }).runId } } as never);
  },
});

/** A workspace's settings is now the global settings, scoped: `/w/$ws/settings` → `/settings?scope=$ws`. */
const legacyWorkspaceSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/w/$ws/settings',
  validateSearch: (s: Record<string, unknown>) => s,
  component: () => null,
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: '/settings', search: { ...search, scope: (params as { ws: string }).ws } } as never);
  },
});

const routeTree = rootRoute.addChildren([
  v2RootRoute.addChildren([
    v2IndexRoute,
    v2LoginRoute,
    v2ShellRoute.addChildren([
      v2OnboardingRoute,
      v2NeedsRoute,
      v2LiveRoute,
      v2IncidentsRoute,
      v2MapRoute,
      v2RunsRoute,
      v2RunRoute,
      v2ScheduledRoute,
      v2SettingsRoute,
      v2ChatsRoute,
      v2WsRoute.addChildren([
        v2WsIndexRoute,
        v2ChatRoute,
        v2WsNeedsRoute,
        v2WorkRoute,
        v2RolesRoute,
        v2TeamRedirectRoute,
        v2KnowledgeRoute,
        v2KnowledgeGraphRoute,
        v2KnowledgeExplorerRoute,
        v2KnowledgeChangelogRoute,
        v2KnowledgeSpecsRoute,
        v2UsageRoute,
        v2ChangelogRoute,
        v2ProjectRoute,
        v2ChangesRoute,
        v2TicketRoute,
        v2TicketArtifactRoute,
        v2ArtifactRoute,
        v2WorkerRoute,
        v2PluginPageRoute,
      ]),
    ]),
  ]),
  legacyV2Route,
  legacyV2WildRoute,
  legacyBoardRoute,
  legacyMergeQueueRoute,
  legacyWorkspaceLiveRoute,
  legacyWorkspaceRunsRoute,
  legacyWorkspaceRunRoute,
  legacyWorkspaceSettingsRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent', defaultErrorComponent: RouteError });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
