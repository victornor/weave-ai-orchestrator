/**
 * `weave chat` — the conductor thread with inline decision cards and a composer (PLAN §21.2).
 * Commands: `/talk <ticket>` binds the thread to a ticket, `/weaver` goes back,
 * `/d <decision> <key|number>` answers a decision, `/quit` leaves.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import type { Agent, ChannelThread, Decision, Run, RunDeltaFrame, RunEvent, RunLiveSnapshot, ThreadMessage } from '@weave-ai/shared';
import { isActiveRun } from '@weave-ai/shared';
import { applyDelta, chatTranscript, decisionToCard, dropSuperseded, formatRelative, fromSnapshot, runEventFromFrame, type CardModel, type PartialMap, type TranscriptBlock } from '@weave-ai/render';
import { ActivityLine } from '../components/ActivityLine.js';
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
  '/weaver          go back to the weaver',
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
  const [conductorRuntimeId, setConductorRuntimeId] = useState<string | null>(null);
  /** The conductor run being streamed, or null when it is idle. */
  const [runId, setRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  /** VS-603: the live row's partial output and clock. */
  const [partials, setPartials] = useState<PartialMap>(() => new Map());
  const [partialClock, setPartialClock] = useState<{ last: number | null; since: number | null }>({ last: null, since: null });
  const runIdRef = useRef<string | null>(null);
  useEffect(() => { runIdRef.current = runId; }, [runId]);
  const partialsRef = useRef<PartialMap>(partials);
  useEffect(() => { partialsRef.current = partials; }, [partials]);

  /** VS-603: a chat opened mid-turn, or reconnected, reads the run's partials once. */
  const readLive = useCallback(async (id: string) => {
    try {
      const snap = await client.wget<RunLiveSnapshot>(`/runs/${encodeURIComponent(id)}/live`);
      if (!snap?.partials?.length) return;
      setPartials(fromSnapshot(snap));
      setPartialClock((c) => ({ last: Date.now(), since: c.since ?? Date.now() }));
    } catch {
      /* the live row is an extra; the thread still works without it */
    }
  }, [client]);

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
        const payload = await client.wget<unknown>('/weaver');
        if (cancelled) return;
        const agent = unwrap<Agent>(payload, 'agent', 'worker');
        setConductorId(agent?.id ?? null);
        setConductorRuntimeId(agent?.runtimeId ?? null);
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
    const event = runEventFromFrame(message.json);
    if (!event) return;
    setEvents((prev) => (prev.some((e) => e.id === event.id) ? prev : [...prev, event]));
  });

  const connection = useStream(client, client.workspace ? client.w('/events') : null, (message) => {
    if (message.type === 'run.delta') {
      const delta = (message.json as { payload?: RunDeltaFrame } | null)?.payload ?? null;
      if (!delta || !Array.isArray(delta.parts)) return;
      const current = runIdRef.current;
      if (!current || delta.runId !== current) return;
      const applied = applyDelta(partialsRef.current, delta.parts);
      partialsRef.current = applied.map;
      setPartials(applied.map);
      setPartialClock((c) => ({ last: Date.now(), since: c.since ?? Date.now() }));
      if (applied.gap) void readLive(delta.runId);
      return;
    }
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
        if (id) { runIdRef.current = id; setRunId(id); setEvents([]); }
        partialsRef.current = new Map();
        setPartials(new Map());
        setPartialClock({ last: null, since: null });
      } else {
        setRunId((cur) => (cur === null || cur === id ? null : cur));
        partialsRef.current = new Map();
        setPartials(new Map());
        setPartialClock({ last: null, since: null });
        setPending(false);
      }
      return;
    }
    if (message.type.startsWith('decision.')) void loadDecisions();
  });

  // A chat opened mid-turn, or one whose stream dropped and came back, reads the run's partials once.
  useEffect(() => {
    if (runId) void readLive(runId);
  }, [runId, readLive]);
  useEffect(() => {
    if (connection === 'connected' && runId) void readLive(runId);
  }, [connection, runId, readLive]);

  // The reply renders as the thread message weave_human_send created; showing the call too would
  // put the same words on screen twice.
  const blocks: TranscriptBlock[] = useMemo(() => chatTranscript(events), [events]);
  /** VS-603: the partials not yet superseded, so the row says "Writing", not "Waiting". */
  const livePartials = useMemo(() => dropSuperseded(partials, events), [partials, events]);
  const working = pending || runId !== null;

  const cards: CardModel[] = useMemo(() => decisions.map((d) => decisionToCard(d, {})), [decisions]);

  useEffect(() => {
    setTerminalTitle(['Weaver', boundTicket ?? undefined, cards.length ? 'needs you' : working ? 'working' : 'idle'].filter(Boolean).join(' · '));
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
    if (card.confirm && card.destructive) { setNotice(`${card.confirm.prompt} — use \`weave decision answer\` for destructive decisions`); return; }
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

    if (text === '/weaver') {
      if (!thread?.id) return;
      try {
        await client.wpost(`/threads/${encodeURIComponent(thread.id)}/bind`, { ticketId: null });
        setBoundTicket(null);
        setNotice('talking to the weaver');
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
              {message.direction === 'inbound' ? 'you' : 'weaver'} · {formatRelative(message.createdAt)}
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
          <ActivityLine
            events={events}
            partials={livePartials}
            runtimeId={conductorRuntimeId}
            partialSince={partialClock.since}
            lastPartialAt={partialClock.last}
            live={working}
          />
          {blocks.length ? <TranscriptView blocks={blocks} maxLines={12} /> : null}
        </Box>
      ) : null}
      {notice ? <Text color="yellow">{notice}</Text> : null}
      <TextInput
        value={input}
        onChange={setInput}
        onSubmit={(text) => { void submit(text); }}
        placeholder={boundTicket ? `message ${boundTicket} · /weaver to go back` : 'message the weaver · /help'}
        history={history}
      />
      <StatusBar
        left={`${boundTicket ? `ticket ${boundTicket}` : 'weaver'} · ${client.workspace ?? 'no workspace'}`}
        right={`${cards.length} needs you · esc quit`}
        connection={connection}
      />
    </Box>
  );
}
