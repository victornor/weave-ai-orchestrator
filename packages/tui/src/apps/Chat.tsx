/**
 * `conductor chat` — the conductor thread with inline decision cards and a composer (PLAN §21.2).
 * Commands: `/talk <ticket>` binds the thread to a ticket, `/conductor` goes back,
 * `/d <decision> <key|number>` answers a decision, `/quit` leaves.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import type { ChannelThread, Decision, ThreadMessage } from '@agent-conductor/shared';
import { decisionToCard, formatRelative, type CardModel } from '@agent-conductor/render';
import { DecisionCardView } from '../components/DecisionCard.js';
import { StatusBar } from '../components/StatusBar.js';
import { TextInput } from '../components/TextInput.js';
import { items, type TuiClient } from '../client.js';
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

  const connection = useStream(client, client.workspace ? client.w('/events') : null, (message) => {
    if (message.type === 'thread.message') {
      const payload = (message.json as { payload?: ThreadMessage } | null)?.payload;
      if (!payload || (thread?.id && String(payload.threadId) !== String(thread.id))) return;
      setMessages((prev) => (prev.some((m) => m.id === payload.id) ? prev : [...prev, payload]));
      if (payload.direction === 'outbound') setPending(false);
      return;
    }
    if (message.type.startsWith('decision.')) void loadDecisions();
  });

  const cards: CardModel[] = useMemo(() => decisions.map((d) => decisionToCard(d, {})), [decisions]);

  useEffect(() => {
    setTerminalTitle(['Conductor', boundTicket ?? undefined, cards.length ? 'needs you' : pending ? 'working' : 'idle'].filter(Boolean).join(' · '));
  }, [boundTicket, cards.length, pending]);

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
      {notice ? <Text color="yellow">{notice}</Text> : null}
      {pending ? <Text dimColor>conductor is replying…</Text> : null}
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
