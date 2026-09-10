/**
 * Daemon-wide Chats (VS-168): one conductor pane per workspace, side by side.
 */
import { WorkspaceProvider } from '../api/context';
import { useWorkspaces } from '../api/hooks';
import { Page, PageBody, PageHeader } from '../components/Page';
import { Skeleton } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { ChatPage } from './Chat';

export function GlobalChatsRoute(): React.ReactElement {
  const workspaces = useWorkspaces();
  const listed = workspaces.data ?? [];

  return (
    <Page>
      <PageHeader title="Chats" meta={listed.length ? `${listed.length} workspaces` : undefined} />
      <PageBody className="min-h-0">
        {workspaces.isError ? (
          <ErrorState className="m-4" code="WORKSPACES_QUERY_FAILED" message="Could not load workspaces." onRetry={() => void workspaces.refetch()} />
        ) : !workspaces.data ? (
          <div className="flex h-full gap-3 overflow-x-auto p-4">
            <Skeleton className="h-full min-w-80 flex-1" />
            <Skeleton className="h-full min-w-80 flex-1" />
          </div>
        ) : listed.length === 0 ? (
          <EmptyState className="m-4" title="No workspaces." detail="Create a workspace to talk to its conductor." />
        ) : (
          <div className="flex h-full min-h-0 overflow-x-auto">
            {listed.map((w) => (
              <section
                key={w.id}
                aria-label={w.name}
                className="flex min-h-0 min-w-80 flex-1 flex-col border-r border-line-1 last:border-r-0"
              >
                <div className="flex-none truncate border-b border-line-1 px-3.5 py-2 text-ui font-medium text-text-1">{w.name}</div>
                <div className="flex min-h-0 flex-1 flex-col">
                  <WorkspaceProvider ws={w.id} remember={false}>
                    <ChatPage />
                  </WorkspaceProvider>
                </div>
              </section>
            ))}
          </div>
        )}
      </PageBody>
    </Page>
  );
}
