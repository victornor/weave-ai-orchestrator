import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ThreadMessage } from '@agent-conductor/shared';
import { ticketUiStatus, agentUiStatus } from '@agent-conductor/shared';
import { Page, PageBody, PageHeader } from '../components/Page';
import { Composer } from '../components/Composer';
import { DecisionCard } from '../components/DecisionCard';
import { WorkerChip, CommandChip } from '../components/Chips';
import { Skeleton } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { Markdown } from '../components/Markdown';
import {
  useAnswerDecision,
  useCreateThread,
  useDecisions,
  usePostThreadMessage,
  useProjects,
  useThreadMessages,
  useThreads,
  useTickets,
  useWorkers,
} from '../api/hooks';
import { useConnection, useWorkspaceEvents, useWs } from '../api/context';
import { enqueue, useQueueCount } from '../lib/queue';
import { useGo } from '../app/link';
import { clock } from '../lib/format';
import { cx } from '../lib/cx';

const IDENTIFIER = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

/** Ticket identifiers in agent text become chips that expand inline. */
function MessageBody({
  body,
  onTicket,
}: {
  body: string;
  onTicket: (id: string) => void;
  ticketStatus: (id: string) => ReturnType<typeof ticketUiStatus> | null;
}): React.ReactElement {
  // Ticket identifiers become chips, but the rest of the message is still markdown: the identifiers
  // are rewritten into anchors the markdown renderer keeps, and clicks on those open the ticket.
  const source = useMemo(() => body.replace(IDENTIFIER, (id) => `[${id}](#ticket:${id})`), [body]);
  const onClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const a = (e.target as HTMLElement).closest('a[href^="#ticket:"]');
    if (!a) return;
    e.preventDefault();
    onTicket(decodeURIComponent(a.getAttribute('href')!.slice('#ticket:'.length)));
  };
  return (
    <div onClick={onClick}>
      <Markdown source={source} className="text-body" />
    </div>
  );
}

export function ChatRoute(): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const conn = useConnection();
  const threads = useThreads();
  const createThread = useCreateThread();
  const [threadId, setThreadId] = useState<string | null>(null);
  const messages = useThreadMessages(threadId);
  const post = usePostThreadMessage();
  const decisions = useDecisions({ status: 'open', owner: 'human' });
  const answer = useAnswerDecision();
  const tickets = useTickets({ limit: 200 });
  const workers = useWorkers({ status: 'running' });
  const projects = useProjects();
  const queuedCount = useQueueCount('thread');
  const [midTurn, setMidTurn] = useState(false);
  const [streaming, setStreaming] = useState<string>('');
  const bottom = useRef<HTMLDivElement>(null);
  const offline = conn.state === 'offline' || conn.state === 'unreachable';

  useEffect(() => {
    if (threadId) return;
    const first = threads.data?.[0];
    if (first) setThreadId(first.id);
    else if (threads.isSuccess && !createThread.isPending && !createThread.data) createThread.mutate({}, { onSuccess: (t) => setThreadId(t.id) });
  }, [threads.data, threads.isSuccess, threadId, createThread]);

  // Streamed replies: `thread.message` frames arrive as the conductor writes.
  useWorkspaceEvents(
    useCallback(
      (e) => {
        if (e.type === 'thread.message') {
          const p = e.payload as { threadId?: string; direction?: string; body?: string; partial?: boolean } | null;
          if (p?.threadId && p.threadId !== threadId) return;
          if (p?.direction === 'outbound') {
            if (p.partial) setStreaming(p.body ?? '');
            else {
              setStreaming('');
              setMidTurn(false);
            }
          }
        }
        if (e.type === 'run.started') setMidTurn(true);
        if (e.type === 'run.finished') setMidTurn(false);
      },
      [threadId],
    ),
  );

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.data, streaming]);

  const ticketStatus = useCallback(
    (identifier: string) => {
      const t = tickets.data?.find((x) => x.identifier === identifier);
      return t ? ticketUiStatus(t.status) : null;
    },
    [tickets.data],
  );

  const openTicket = useCallback((identifier: string) => go('/w/$ws/tickets/$ticketId', { params: { ws, ticketId: identifier } }), [go, ws]);

  const send = (text: string): void => {
    if (!threadId) return;
    // Slash commands are resolved client-side where they are pure navigation.
    const talk = /^\/talk\s+(\S+)/.exec(text);
    if (talk?.[1]) {
      openTicket(talk[1].toUpperCase());
      return;
    }
    if (/^\/conductor\b/.test(text)) {
      go('/w/$ws/team', { params: { ws } });
      return;
    }
    const d = /^\/d\s+(\S+)\s*(\S+)?/.exec(text);
    if (d?.[1]) {
      answer.mutate({ id: d[1], ...(d[2] ? { key: d[2] } : {}) });
      return;
    }
    if (offline) {
      enqueue({ kind: 'thread', path: `/threads/${threadId}/messages`, body: { body: text }, label: text.slice(0, 60) });
      return;
    }
    setMidTurn(true);
    post.mutate({ threadId, body: text });
  };

  // Onboarding: the conductor's first-run interview is just Chat with a
  // progress bar, shown while the workspace has no projects.
  const onboarding = projects.isSuccess && (projects.data?.length ?? 0) === 0;
  const answered = Math.min(5, (messages.data ?? []).filter((m) => m.direction === 'inbound').length);

  return (
    <Page>
      <PageHeader
        title="Conductor"
        meta={`${workers.data?.length ?? 0} workers running · ${decisions.data?.length ?? 0} need you`}
        actions={<span className="ac-mono hidden text-micro text-text-nav md:block">/brief</span>}
      />

      {onboarding ? (
        <div className="flex items-center gap-3 border-b border-line-1 bg-bg-1 px-4 py-2.5">
          <span className="text-meta text-text-2">Setting up your workspace</span>
          <span className="h-1.5 w-32 overflow-hidden rounded-pill bg-bg-3">
            <span className="block h-full rounded-pill bg-accent transition-[width] duration-(--dur-panel) ease-ac" style={{ width: `${(answered / 5) * 100}%` }} />
          </span>
          <span className="ac-mono text-micro text-text-3">{answered}/5</span>
        </div>
      ) : null}

      <PageBody className="px-4 py-5 md:px-7">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {messages.isLoading ? (
            <>
              <Skeleton className="ml-auto h-12 w-2/3 rounded-r10" />
              <Skeleton className="h-16 w-4/5 rounded-r6" />
              <Skeleton className="h-24 w-full rounded-r8" />
            </>
          ) : messages.isError ? (
            <ErrorState code="CONDUCTOR_UNREACHABLE" message="Could not load the thread; the history below is the last known state." onRetry={() => void messages.refetch()} />
          ) : (messages.data?.length ?? 0) === 0 ? (
            <EmptyState
              title="Tell me what you need."
              detail={
                <>
                  Try “add dark mode to the dashboard in web”
                  <br />
                  or “what is everyone working on?”
                </>
              }
            />
          ) : (
            (messages.data ?? []).map((m: ThreadMessage) => <ChatMessage key={m.id} message={m} onTicket={openTicket} ticketStatus={ticketStatus} />)
          )}

          {streaming ? (
            <div className="flex flex-col gap-2">
              <MessageBody body={streaming} onTicket={openTicket} ticketStatus={ticketStatus} />
              <span className="inline-block h-3.5 w-0.5 bg-accent motion-safe:animate-[ac-blink_1s_steps(1)_infinite]" aria-hidden />
            </div>
          ) : null}

          {/* live worker chips */}
          {(workers.data ?? []).length ? (
            <div className="flex flex-wrap gap-2">
              {(workers.data ?? []).map((w) => (
                <WorkerChip
                  key={w.id}
                  name={w.name}
                  status={agentUiStatus(w.status)}
                  onClick={() => go('/w/$ws/workers/$workerId', { params: { ws, workerId: w.id } })}
                />
              ))}
            </div>
          ) : null}

          {/* decision cards are first-class blocks in the thread */}
          {(decisions.data ?? []).map((d) => (
            <DecisionCard
              key={d.id}
              decision={d}
              ticketIdentifier={tickets.data?.find((t) => t.id === d.ticketId)?.identifier ?? d.ticketId}
              busy={answer.isPending}
              onAnswer={(a) => answer.mutate({ id: d.id, ...a })}
            />
          ))}

          <div ref={bottom} />
        </div>
      </PageBody>

      <div className="flex-none border-t border-line-1 bg-bg-0 px-4 py-3 md:px-7">
        <div className="mx-auto max-w-3xl">
          <Composer
            placeholder="Message the conductor…"
            queuedReason={offline ? 'Offline — your message is queued' : midTurn ? 'Conductor is replying — your message is queued' : null}
            queuedCount={queuedCount}
            onSubmit={send}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            <CommandChip command="/talk ACME-42" />
            <CommandChip command="/conductor" />
            <CommandChip command="/d <id> approve" />
          </div>
        </div>
      </div>
    </Page>
  );
}

function ChatMessage({
  message,
  onTicket,
  ticketStatus,
}: {
  message: ThreadMessage;
  onTicket: (id: string) => void;
  ticketStatus: (id: string) => ReturnType<typeof ticketUiStatus> | null;
}): React.ReactElement {
  const mine = message.direction === 'inbound';
  return (
    <div className={cx('flex flex-col gap-1', mine && 'items-end')}>
      <div
        className={cx(
          mine ? 'max-w-[80%] rounded-r10 rounded-br-r4 bg-bg-3 px-3.5 py-2.5 text-body text-text-1' : 'w-full',
        )}
      >
        {mine ? message.body : <MessageBody body={message.body} onTicket={onTicket} ticketStatus={ticketStatus} />}
      </div>
      <span className="ac-mono text-nano text-text-4">{clock(message.createdAt)}</span>
    </div>
  );
}
