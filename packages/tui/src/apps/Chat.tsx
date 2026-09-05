/**
 * `conductor chat` — the conductor thread with inline decision cards and a composer (PLAN §21.2).
 * Commands: `/talk <ticket>` binds the thread to a ticket, `/conductor` goes back,
 * `/d <decision> <key|number>` answers a decision, `/quit` leaves.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import type { Agent, ChannelThread, Decision, Run, RunEvent, ThreadMessage } from '@agent-conductor/shared';
import { isActiveRun } from '@agent-conductor/shared';
import { chatTranscript, decisionToCard, formatRelative, type CardModel, type TranscriptBlock } from '@agent-conductor/render';
import { DecisionCardView } from '../components/DecisionCard.js';
import { StatusBar } from '../components/StatusBar.js';
import { TextInput } from '../components/TextInput.js';
import { TranscriptView } from '../components/Transcript.js';
import { items, unwrap, type TuiClient } from '../client.js';
import { useKeys, useStream } from '../hooks.js';
import { setTerminalTitle } from '../terminal.js';

export interface ChatOptions { ticketId?: string }

const HELP = [
  '/talk <ticket>   bind this thread to a ticket and talk to its worker',
  '/conductor       go back to the conductor',
  '/d <id> <n|key>  answer a decision (a number picks the numbered option)',
  '/refresh         reload messages and decisions',
  '/quit            leave',
];

export function Chat({ client, options }: { client: TuiClient; options: ChatOptions }): React.ReactElement {
  const { exit } = useApp();
  const [thread, setThread] = useState<ChannelThread | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [boundTicket, setBoundTicket] = useState<string | null>(options.ticketId ?? null);
  const [conductorId, setConductorId] = useState<string | null>(null);
  /** The conductor run being streamed, or null when it is idle. */
  const [runId, setRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);

  const loadDecisions = useCallback(async () => {
    try {
      const payload = await client.wget('/decisions', { status: 'open', owner: 'human' });
      setDecisions(items<Decision>(payload, 'decisions'));
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const existing = items<ChannelThread>(await client.wget('/threads', { channel: 'web' }), 'threads');
        const found = existing[0] ?? (await client.wpost<ChannelThread>('/threads', { channel: 'web' }));
        if (cancelled) return;
        setThread(found);
        if (options.ticketId && found?.id) {
          await client.wpost(`/threads/${encodeURIComponent(found.id)}/bind`, { ticketId: options.ticketId }).catch(() => undefined);
        }
        setBoundTicket(options.ticketId ?? found?.ticketId ?? null);
        const loaded = items<ThreadMessage>(await client.wget(`/threads/${encodeURIComponent(String(found?.id ?? ''))}/messages`, { limit: 60 }), 'messages');
        if (!cancelled) setMessages(loaded);
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message);
      }
      await loadDecisions();
    })();
    return () => { cancelled = true; };
  }, [client, options.ticketId, loadDecisions]);

  // Which agent is the conductor, and is it mid-turn right now? Opening the chat during a turn
  // resumes it rather than showing nothing until the next one starts.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await client.wget<unknown>('/conductor');
        if (cancelled) return;
        const agent = unwrap<Agent>(payload, 'agent', 'worker');
        setConductorId(agent?.id ?? null);
        const last = (payload as { lastRun?: Run } | null)?.lastRun ?? null;
        if (last?.id && isActiveRun(last.status)) setRunId((cur) => cur ?? last.id);
      } catch {
        /* the live view is an extra; the thread still works without it */
      }
    })();
    return () => { cancelled = true; };
  }, [client]);

  // Persisted events for the run, so the transcript starts from what the turn has already done.
  useEffect(() => {
    if (!runId) { setEvents([]); return; }
    let cancelled = false;
    void (async () => {
      try {
        const loaded = items<RunEvent>(await client.wget(`/runs/${encodeURIComponent(runId)}/events`, { limit: 400 }), 'events');
        if (!cancelled) setEvents((prev) => (prev.length ? prev : loaded));
      } catch {
        /* the stream replays from the start anyway */
      }
    })();
    return () => { cancelled = true; };
  }, [client, runId]);

  useStream(client, runId ? client.w(`/runs/${encodeURIComponent(runId)}/events/stream`) : null, (message) => {
    const raw = message.json as RunEvent | { payload?: RunEvent } | null;
    const event = (raw && typeof raw === 'object' && 'payload' in raw ? (raw as { payload?: RunEvent }).payload : raw) as RunEvent | null;
    if (!event || typeof event.seq !== 'number') return;
    setEvents((prev) => (prev.some((e) => e.id === event.id) ? prev : [...prev, event]));
  });

  const connection = useStream(client, client.workspace ? client.w('/events') : null, (message) => {
    if (message.type === 'thread.message') {
      const payload = (message.json as { payload?: ThreadMessage } | null)?.payload;
      if (!payload || (thread?.id && String(payload.threadId) !== String(thread.id))) return;
      setMessages((prev) => (prev.some((m) => m.id === payload.id) ? prev : [...prev, payload]));
      if (payload.direction === 'outbound') setPending(false);
      return;
    }
    // The conductor's turns are the ones we stream; the run id is the event's entity.
    if (message.type === 'run.started' || message.type === 'run.finished') {
      const frame = message.json as { entityId?: string; payload?: { agentId?: string } } | null;
      if (!conductorId || frame?.payload?.agentId !== conductorId) return;
      const id = String(frame?.entityId ?? '');
      if (message.type === 'run.started') {
        if (id) { setRunId(id); setEvents([]); }
      } else {
        setRunId((cur) => (cur === null || cur === id ? null : cur));
        setPending(false);
      }
      return;
    }
    if (message.type.startsWith('decision.')) void loadDecisions();
  });

  // The reply renders as the thread message ac_human_send created; showing the call too would
  // put the same words on screen twice.
  const blocks: TranscriptBlock[] = useMemo(() => chatTranscript(events), [events]);
  const working = pending || runId !== null;

  const cards: CardModel[] = useMemo(() => decisions.map((d) => decisionToCard(d, {})), [decisions]);

  useEffect(() => {
    setTerminalTitle(['Conductor', boundTicket ?? undefined, cards.length ? 'needs you' : working ? 'working' : 'idle'].filter(Boolean).join(' · '));
  }, [boundTicket, cards.length, working]);

  const answer = useCallback(async (decisionId: string, raw: string) => {
    const card = cards.find((c) => c.id === decisionId || c.id.endsWith(decisionId));
    if (!card) { setNotice(`no open decision ${decisionId}`); return; }
    const index = Number.parseInt(raw, 10);
    const body: Record<string, unknown> = {};
    if (Number.isFinite(index) && index >= 1 && index <= card.options.length) body['key'] = card.options[index - 1]!.key;
    else if (card.options.some((o) => o.key === raw)) body['key'] = raw;
    else if (card.allowFreeText) body['text'] = raw;
    else { setNotice(`not an option: ${raw}`); return; }
    if (card.confirm && card.destructive) { setNotice(`${card.confirm.prompt} — use \`conductor decision answer\` for destructive decisions`); return; }
    try {
      await client.wpost(`/decisions/${encodeURIComponent(card.id)}/answer`, body);
      setNotice(`answered ${card.id}`);
      await loadDecisions();
    } catch (cause) {
      setNotice((cause as Error).message);
    }
  }, [cards, client, loadDecisions]);

  const submit = useCallback(async (text: string) => {
    setInput('');
    setHistory((prev) => [...prev, text].slice(-50));
    setNotice(null);

    if (text === '/quit' || text === '/exit') { exit(); return; }
    if (text === '/help') { setNotice(HELP.join('\n')); return; }
    if (text === '/refresh') { await loadDecisions(); return; }

    if (text.startsWith('/d ')) {
      const [, id, ...rest] = text.split(/\s+/);
      if (!id || rest.length === 0) { setNotice('usage: /d <decision> <number|key|text>'); return; }
      await answer(id, rest.join(' '));
      return;
    }

    if (text.startsWith('/talk')) {
      const ticketId = text.split(/\s+/)[1];
      if (!ticketId) { setNotice('usage: /talk <ticket>'); return; }
      if (!thread?.id) { setNotice('no thread yet'); return; }
      try {
        await client.wpost(`/threads/${encodeURIComponent(thread.id)}/bind`, { ticketId });
        setBoundTicket(ticketId);
        setNotice(`talking to ${ticketId}`);
      } catch (cause) { setNotice((cause as Error).message); }
      return;
    }

    if (text === '/conductor') {
      if (!thread?.id) return;
      try {
        await client.wpost(`/threads/${encodeURIComponent(thread.id)}/bind`, { ticketId: null });
        setBoundTicket(null);
        setNotice('talking to the conductor');
      } catch (cause) { setNotice((cause as Error).message); }
      return;
    }

    if (text.startsWith('/')) { setNotice(`unknown command: ${text.split(' ')[0]}`); return; }
    if (!thread?.id) { setNotice('no thread yet'); return; }

    setPending(true);
    try {
      await client.wpost(`/threads/${encodeURIComponent(thread.id)}/messages`, { body: text });
    } catch (cause) {
      setPending(false);
      setNotice((cause as Error).message);
    }
  }, [answer, client, exit, loadDecisions, thread]);

  useKeys((_input, key) => {
    if (key.escape) exit();
  });

  return (
    <Box flexDirection="column">
      {error ? <Text color="red">{error}</Text> : null}
      <Box flexDirection="column">
        {messages.slice(-40).map((message) => (
          <Box key={message.id ?? `${message.createdAt}-${message.direction}`} flexDirection="column" marginBottom={1}>
            <Text dimColor>
              {message.direction === 'inbound' ? 'you' : 'conductor'} · {formatRelative(message.createdAt)}
            </Text>
            <Text>{String(message.body ?? '')}</Text>
          </Box>
        ))}
      </Box>
      {cards.map((card, index) => (
        <Box key={card.id} marginBottom={1}>
          <DecisionCardView card={card} index={index + 1} />
        </Box>
      ))}
      {/* The turn in flight. Transient: it goes when the run finishes and the thread's
          messages stand alone, so the reply is never on screen twice. */}
      {working ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor>{runId ? 'conductor is working…' : 'conductor is starting…'}</Text>
          {blocks.length ? <TranscriptView blocks={blocks} maxLines={12} /> : null}
        </Box>
      ) : null}
      {notice ? <Text color="yellow">{notice}</Text> : null}
      <TextInput
        value={input}
        onChange={setInput}
        onSubmit={(text) => { void submit(text); }}
        placeholder={boundTicket ? `message ${boundTicket} · /conductor to go back` : 'message the conductor · /help'}
        history={history}
      />
      <StatusBar
        left={`${boundTicket ? `ticket ${boundTicket}` : 'conductor'} · ${client.workspace ?? 'no workspace'}`}
        right={`${cards.length} needs you · esc quit`}
        connection={connection}
      />
    </Box>
  );
}
