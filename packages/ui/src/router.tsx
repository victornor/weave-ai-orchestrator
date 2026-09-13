import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
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
    settingsRoute,
  ]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent', defaultErrorComponent: RouteError });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
