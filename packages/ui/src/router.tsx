import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Outlet, redirect } from '@tanstack/react-router';
import { RouteError } from './components/RouteError';
import { AppShell } from './app/AppShell';
import { WorkspaceProvider } from './api/context';
import { getWorkspaceId } from './api/client';
import { LoginRoute } from './routes/Login';
import { OnboardingRoute } from './routes/Onboarding';
import { NeedsYouRoute } from './routes/NeedsYou';
import { ChatRoute } from './routes/Chat';
import { BoardRoute } from './routes/Board';
import { LiveRoute } from './routes/Live';
import { MergeQueueRoute } from './routes/MergeQueue';
import { TicketRoute } from './routes/TicketPage';
import { WeaverArtifactRoute } from './routes/WeaverArtifactPage';
import { RolesRoute } from './routes/Roles';
import { WorkerRoute } from './routes/WorkerPage';
import { RunsRoute } from './routes/Runs';
import { RunRoute } from './routes/RunPage';
import { UsageRoute } from './routes/Usage';
import { KnowledgeRoute } from './routes/Knowledge';
import { ProjectOverviewRoute } from './routes/project/ProjectOverview';
import { PluginPageRoute } from './routes/PluginPage';
import { DaemonSettingsRoute, WorkspaceSettingsRoute } from './routes/Settings';
import { redirectForSettingsRoute } from './lib/settings';
import { GlobalNeedsRoute } from './routes/GlobalNeeds';
import { GlobalLiveRoute } from './routes/GlobalLive';
import { GlobalChatsRoute } from './routes/GlobalChats';
import { GlobalIncidentsRoute } from './routes/GlobalIncidents';
import { GlobalMapRoute } from './routes/GlobalMap';
import { GlobalScheduledRoute } from './routes/GlobalScheduled';

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: LoginRoute });
const onboardingRoute = createRoute({ getParentRoute: () => rootRoute, path: '/onboarding', component: OnboardingRoute });

const globalNeedsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/needs',
  component: () => (
    <AppShell>
      <GlobalNeedsRoute />
    </AppShell>
  ),
});
const globalLiveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/live',
  component: () => (
    <AppShell>
      <GlobalLiveRoute />
    </AppShell>
  ),
});
const globalChatsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chats',
  component: () => (
    <AppShell>
      <GlobalChatsRoute />
    </AppShell>
  ),
});
const globalIncidentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/incidents',
  validateSearch: (s: Record<string, unknown>) => s,
  component: () => (
    <AppShell>
      <GlobalIncidentsRoute />
    </AppShell>
  ),
});
const globalMapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/map',
  component: () => (
    <AppShell>
      <GlobalMapRoute />
    </AppShell>
  ),
});
const globalScheduledRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/scheduled',
  validateSearch: (s: Record<string, unknown>) => s,
  component: () => (
    <AppShell>
      <GlobalScheduledRoute />
    </AppShell>
  ),
});

// The daemon's settings, above the workspaces and in need of one (VS-230). A URL naming a
// workspace section instead moves to a workspace's settings — or, with none remembered, sheds the
// stale names and shows the daemon page's first section.
export function DaemonSettingsShell(): React.ReactElement {
  return (
    <AppShell>
      <DaemonSettingsRoute />
    </AppShell>
  );
}

const globalSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  validateSearch: (s: Record<string, unknown>) => s,
  beforeLoad: ({ search }) => {
    const r = redirectForSettingsRoute('daemon', search as Record<string, string | undefined>, getWorkspaceId());
    if (r.type === 'redirect') {
      throw redirect({ to: r.to, search: r.search, ...(r.ws ? { params: { ws: r.ws } } : {}) } as never);
    }
  },
  component: DaemonSettingsShell,
});

// ---- V2 (VS-343) ----
// A parallel frontend at `/v2`, served by the same SPA and no daemon change. The shell and every
// page load through `lazyRouteComponent`, so V1's entry chunk does not carry V2's module or CSS.
// Addresses mirror V1 under the prefix: workspace pages are `/v2/w/$ws/<section>`, global pages are
// `/v2/<section>`.
const v2RootRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/v2',
  component: lazyRouteComponent(() => import('./v2/V2Root'), 'V2Root'),
  // Every signed-in V2 page needs a session; `/v2/login` is exempt so the guard cannot loop. Kept
  // as a dynamic import so V1's entry bundle still carries none of the V2 module (VS-343/VS-353).
  beforeLoad: async ({ location }) => {
    if (location.pathname === '/v2/login') return;
    const { v2Refused } = await import('./v2/auth');
    if (await v2Refused()) {
      throw redirect({ to: '/v2/login', search: { next: location.href } as never });
    }
  },
});

const v2IndexRoute = createRoute({
  getParentRoute: () => v2RootRoute,
  path: '/',
  beforeLoad: () => {
    const ws = getWorkspaceId();
    throw redirect({ to: (ws ? `/v2/w/${ws}/needs` : '/v2/onboarding') as never });
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
// URL segment, so no V2 address changes.
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
    throw redirect({ to: `/v2/w/${(params as { ws: string }).ws}/needs` as never });
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
// VS-350: Live reads a `worker` search param, so it validates search by passthrough like V1's pages.
// It is its own `createRoute` (not `v2GlobalRoute`) and so was missed when VS-353 re-parented the
// V2 children under the shell; it must sit under the shell like every other signed-in destination.
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
const v2KnowledgeRoute = v2WsRouteFor('knowledge', 'V2KnowledgePage');
const v2GraphRoute = v2WsRouteFor('knowledge/graph', 'V2GraphPage');
const v2ExplorerRoute = v2WsRouteFor('knowledge/explorer', 'V2ExplorerPage');
const v2UsageRoute = v2WsRouteFor('usage', 'V2UsagePage');
const v2ChangelogRoute = v2WsRouteFor('changelog', 'V2ChangelogPage');
const v2ProjectRoute = v2WsRouteFor('p/$project', 'V2ProjectPage');
const v2TicketRoute = v2WsRouteFor('tickets/$ticketId', 'V2TicketPage');
const v2TicketArtifactRoute = v2WsRouteFor('tickets/$ticketId/artifacts/$key', 'V2TicketArtifactReader');
const v2ArtifactRoute = v2WsRouteFor('artifacts/$key', 'V2ArtifactPage');
const v2WorkerRoute = v2WsRouteFor('workers/$workerId', 'V2WorkerPage');

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    const ws = getWorkspaceId();
    // Signing in from a phone is almost always prompted by something waiting,
    // so the app lands on Needs you, not Chat. With no remembered workspace the
    // onboarding decides: it creates the first one, or the 401 redirect sends
    // an anonymous visitor to /login.
    throw redirect({ to: (ws ? `/w/${ws}/needs` : '/onboarding') as never });
  },
  component: () => null,
});

function WorkspaceLayout(): React.ReactElement {
  const { ws } = wsRoute.useParams() as { ws: string };
  return (
    <WorkspaceProvider ws={ws}>
      <AppShell />
    </WorkspaceProvider>
  );
}

const wsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/w/$ws', component: WorkspaceLayout });

const wsIndexRoute = createRoute({
  getParentRoute: () => wsRoute,
  path: '/',
  beforeLoad: ({ params }) => {
    throw redirect({ to: `/w/${(params as { ws: string }).ws}/needs` as never });
  },
  component: () => null,
});

const child = (path: string, component: () => React.ReactElement, validateSearch?: (s: Record<string, unknown>) => Record<string, unknown>) =>
  createRoute({ getParentRoute: () => wsRoute, path, component, ...(validateSearch ? { validateSearch } : {}) });

const searchPassthrough = (s: Record<string, unknown>): Record<string, unknown> => s;

const needsRoute = child('/needs', NeedsYouRoute);
const chatRoute = child('/chat', ChatRoute, searchPassthrough);
const boardRoute = child('/board', BoardRoute, searchPassthrough);
const liveRoute = child('/live', LiveRoute);
const mergeQueueRoute = child('/merge-queue', MergeQueueRoute, searchPassthrough);
const ticketRoute = child('/tickets/$ticketId', TicketRoute, searchPassthrough);
const weaverArtifactRoute = child('/artifacts/$key', WeaverArtifactRoute);
const rolesRoute = child('/roles', RolesRoute, searchPassthrough);
// The page was named Team before VS-333; old links must keep resolving.
const teamRedirectRoute = createRoute({
  getParentRoute: () => wsRoute,
  path: '/team',
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/w/$ws/roles', params: { ws: (params as { ws: string }).ws } } as never);
  },
  component: () => null,
});
const workerRoute = child('/workers/$workerId', WorkerRoute);
const runsRoute = child('/runs', RunsRoute, searchPassthrough);
const runRoute = child('/runs/$runId', RunRoute);
const usageRoute = child('/usage', UsageRoute, searchPassthrough);
const knowledgeRoute = child('/knowledge', KnowledgeRoute, searchPassthrough);
// A project is addressed by its slug; its id resolves to the same page, as `GET /projects/:id` does.
const projectRoute = child('/p/$project', ProjectOverviewRoute, searchPassthrough);
// VS-334: one static route with a dynamic `$pluginId` segment — not a route added per plugin.
const pluginPageRoute = child('/plugins/$pluginId', PluginPageRoute);
// This workspace's settings only (VS-230). A URL naming the daemon side — `?area=daemon` or one of
// its sections — moves to `/settings`, carrying the section and the rest of the search.
const settingsRoute = createRoute({
  getParentRoute: () => wsRoute,
  path: '/settings',
  validateSearch: searchPassthrough,
  beforeLoad: ({ search, params }) => {
    const r = redirectForSettingsRoute('workspace', search as Record<string, string | undefined>, params.ws);
    if (r.type === 'redirect') {
      throw redirect({ to: r.to, search: r.search, ...(r.ws ? { params: { ws: r.ws } } : {}) } as never);
    }
  },
  component: WorkspaceSettingsRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  onboardingRoute,
  globalNeedsRoute,
  globalLiveRoute,
  globalChatsRoute,
  globalIncidentsRoute,
  globalMapRoute,
  globalScheduledRoute,
  globalSettingsRoute,
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
        v2KnowledgeRoute,
        v2GraphRoute,
        v2ExplorerRoute,
        v2UsageRoute,
        v2ChangelogRoute,
        v2ProjectRoute,
        v2TicketRoute,
        v2TicketArtifactRoute,
        v2ArtifactRoute,
        v2WorkerRoute,
      ]),
    ]),
  ]),
  wsRoute.addChildren([
    wsIndexRoute,
    needsRoute,
    chatRoute,
    boardRoute,
    liveRoute,
    mergeQueueRoute,
    ticketRoute,
    weaverArtifactRoute,
    rolesRoute,
    teamRedirectRoute,
    workerRoute,
    runsRoute,
    runRoute,
    usageRoute,
    knowledgeRoute,
    projectRoute,
    pluginPageRoute,
    settingsRoute,
  ]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent', defaultErrorComponent: RouteError });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
