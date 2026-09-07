import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { AppShell } from './app/AppShell';
import { WorkspaceProvider } from './api/context';
import { getWorkspaceId } from './api/client';
import { LoginRoute } from './routes/Login';
import { OnboardingRoute } from './routes/Onboarding';
import { NeedsYouRoute } from './routes/NeedsYou';
import { ChatRoute } from './routes/Chat';
import { BoardRoute } from './routes/Board';
import { MergeQueueRoute } from './routes/MergeQueue';
import { TicketRoute } from './routes/TicketPage';
import { TeamRoute } from './routes/Team';
import { WorkerRoute } from './routes/WorkerPage';
import { RunsRoute } from './routes/Runs';
import { RunRoute } from './routes/RunPage';
import { UsageRoute } from './routes/Usage';
import { KnowledgeRoute } from './routes/Knowledge';
import { ProjectOverviewRoute } from './routes/project/ProjectOverview';
import { SettingsRoute } from './routes/Settings';

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: LoginRoute });
const onboardingRoute = createRoute({ getParentRoute: () => rootRoute, path: '/onboarding', component: OnboardingRoute });

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
const mergeQueueRoute = child('/merge-queue', MergeQueueRoute, searchPassthrough);
const ticketRoute = child('/tickets/$ticketId', TicketRoute, searchPassthrough);
const teamRoute = child('/team', TeamRoute, searchPassthrough);
const workerRoute = child('/workers/$workerId', WorkerRoute);
const runsRoute = child('/runs', RunsRoute, searchPassthrough);
const runRoute = child('/runs/$runId', RunRoute);
const usageRoute = child('/usage', UsageRoute, searchPassthrough);
const knowledgeRoute = child('/knowledge', KnowledgeRoute, searchPassthrough);
// A project is addressed by its slug; its id resolves to the same page, as `GET /projects/:id` does.
const projectRoute = child('/p/$project', ProjectOverviewRoute, searchPassthrough);
const settingsRoute = child('/settings', SettingsRoute, searchPassthrough);

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  onboardingRoute,
  wsRoute.addChildren([
    wsIndexRoute,
    needsRoute,
    chatRoute,
    boardRoute,
    mergeQueueRoute,
    ticketRoute,
    teamRoute,
    workerRoute,
    runsRoute,
    runRoute,
    usageRoute,
    knowledgeRoute,
    projectRoute,
    settingsRoute,
  ]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
