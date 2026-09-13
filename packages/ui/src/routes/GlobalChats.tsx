/**
 * Daemon-wide Chats (VS-168): one conductor pane per workspace, side by side.
 *
 * Exactly one pane is "focused" (live) at a time (VS-199): only it holds a workspace event
 * subscription and a run-tail subscription, so the page's own connection count is a constant,
 * not one per listed workspace — see `conductor-chat/global-chats` § Exactly one pane is live at
 * a time. Every other pane still shows its workspace's history, decisions and composer from
 * ordinary queries; choosing a pane's header makes it the focused one and catches its data up.
 */
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WorkspaceProvider } from '../api/context';
import { useWorkspaces } from '../api/hooks';
import { qk } from '../api/keys';
import { Page, PageBody, PageHeader } from '../components/Page';
import { Skeleton } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { cx } from '../lib/cx';
import { ChatPage } from './Chat';

export function GlobalChatsRoute(): React.ReactElement {
  const workspaces = useWorkspaces();
  const qc = useQueryClient();
  const listed = workspaces.data ?? [];
  const [focusedWs, setFocusedWs] = useState<string | null>(null);
  const focused = focusedWs !== null && listed.some((w) => w.id === focusedWs) ? focusedWs : (listed[0]?.id ?? null);

  const focus = useCallback(
    (id: string) => {
      setFocusedWs(id);
      // Catch up the pane that was just unfocused-until-now: its own queries stayed mounted and
      // subscribed the whole time, so nothing would otherwise prompt a refetch just because it is
      // the one being looked at now (VS-199).
      void qc.invalidateQueries({ queryKey: qk.threads(id) });
      void qc.invalidateQueries({ queryKey: qk.decisions(id) });
      void qc.invalidateQueries({ queryKey: qk.weaver(id) });
    },
    [qc],
  );

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
          <EmptyState className="m-4" title="No workspaces." detail="Create a workspace to talk to its weaver." />
        ) : (
          <div className="flex h-full min-h-0 overflow-x-auto">
            {listed.map((w) => {
              const live = w.id === focused;
              return (
                <section
                  key={w.id}
                  aria-label={w.name}
                  className="flex min-h-0 min-w-80 flex-1 flex-col border-r border-line-1 last:border-r-0"
                >
                  <button
                    type="button"
                    aria-current={live}
                    onClick={() => focus(w.id)}
                    className={cx(
                      'flex-none truncate border-b px-3.5 py-2 text-left text-ui font-medium',
                      live ? 'border-accent-edge bg-accent-tint text-text-1' : 'border-line-1 text-text-1 hover:bg-bg-2',
                    )}
                  >
                    {w.name}
                  </button>
                  <div className="flex min-h-0 flex-1 flex-col">
                    <WorkspaceProvider ws={w.id} remember={false} live={live}>
                      <ChatPage focused={live} />
                    </WorkspaceProvider>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </PageBody>
    </Page>
  );
}
