/**
 * `conductor attach <agent>` — the universal terminal view of one agent (PLAN §14b.1): live transcript,
 * status bar, and an input line that posts a ticket comment (worker) or a thread message (conductor).
 *
 * Keys (command mode): p pause/resume · o open ticket · r relaunch · c cancel run · q quit ·
 * i or Enter to type, Esc back to command mode.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import type { Agent, Run, RunEvent } from '@agent-conductor/shared';
import { runEventsToTranscript, workerToCard, type TranscriptBlock } from '@agent-conductor/render';
import { StatusBar } from '../components/StatusBar.js';
import { TextInput } from '../components/TextInput.js';
import { TranscriptView } from '../components/Transcript.js';
import { items, unwrap, type TuiClient } from '../client.js';
import { useKeys, useStream, useTerminalSize } from '../hooks.js';
import { setTerminalTitle } from '../terminal.js';

interface WorkerDetail { agent?: Agent; ticket?: Record<string, unknown>; lastRun?: Run; usage?: Record<string, unknown> }

export function Attach({ client, agentId }: { client: TuiClient; agentId: string }): React.ReactElement {
  const { exit } = useApp();
  const { rows } = useTerminalSize();
  const [detail, setDetail] = useState<WorkerDetail | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'command' | 'insert'>('command');
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [nonce, setNonce] = useState(0);

  const isConductor = agentId === 'conductor';

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = isConductor
          ? await client.wget<unknown>('/conductor')
          : await client.wget<unknown>(`/workers/${encodeURIComponent(agentId)}`);
        if (cancelled) return;
        const agent = unwrap<Agent>(payload, 'agent', 'worker');
        const record = (payload ?? {}) as WorkerDetail;
        setDetail({ ...record, agent });
        const resolvedRun = record.lastRun?.id
          ?? items<Run>(await client.wget('/runs', { agent: agent.id ?? agentId, limit: 1 }), 'runs')[0]?.id
          ?? null;
        if (cancelled) return;
        setRunId(resolvedRun ?? null);
        if (resolvedRun) {
          const loaded = items<RunEvent>(await client.wget(`/runs/${encodeURIComponent(resolvedRun)}/events`, { limit: 400 }), 'events');
          if (!cancelled) setEvents(loaded);
        }
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [agentId, client, isConductor, nonce]);

  const lastSeq = events.length > 0 ? events[events.length - 1]!.seq : 0;

  // Run events for the current run, plus the workspace stream so a new run swaps us over to it.
  useStream(client, runId ? client.w(`/runs/${encodeURIComponent(runId)}/events/stream`) : null, (message) => {
    const raw = message.json as RunEvent | { payload?: RunEvent } | null;
    const event = (raw && typeof raw === 'object' && 'payload' in raw ? (raw as { payload?: RunEvent }).payload : raw) as RunEvent | null;
    if (!event || typeof event.seq !== 'number') return;
    setEvents((prev) => (prev.some((e) => e.id === event.id) ? prev : [...prev, event]));
  }, { after: lastSeq });

  const connection = useStream(client, client.workspace ? client.w('/events') : null, (message) => {
    if (message.type === 'run.started') {
      const payload = (message.json as { payload?: Record<string, unknown> } | null)?.payload ?? {};
      if (String(payload['agentId'] ?? '') !== String(detail?.agent?.id ?? agentId)) return;
      const started = String(payload['id'] ?? payload['runId'] ?? '');
      if (started) { setRunId(started); setEvents([]); }
      return;
    }
    if (message.type === 'worker.status' || message.type === 'run.finished') setNonce((n) => n + 1);
  });

  const card = useMemo(() => {
    const agent = detail?.agent;
    if (!agent) return null;
    const ticket = detail?.ticket ?? null;
    const usage = detail?.usage ?? {};
    return workerToCard(agent, {
      ticket: ticket ? { id: String(ticket['id'] ?? ''), identifier: String(ticket['identifier'] ?? ''), title: String(ticket['title'] ?? '') } : null,
      usage: {
        tokens: typeof usage['tokens'] === 'number' ? usage['tokens'] : null,
        costCents: typeof usage['costCents'] === 'number' ? usage['costCents'] : null,
      },
    });
  }, [detail]);

  useEffect(() => {
    if (card) setTerminalTitle(card.windowTitle);
  }, [card]);

  const blocks: TranscriptBlock[] = useMemo(() => runEventsToTranscript(events), [events]);

  const act = useCallback(async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      setNotice(label);
      setNonce((n) => n + 1);
    } catch (cause) {
      setNotice((cause as Error).message);
    }
  }, []);

  const submit = useCallback(async (text: string) => {
    setInput('');
    setHistory((prev) => [...prev, text].slice(-50));
    setMode('command');
    const ticketId = detail?.ticket ? String(detail.ticket['id'] ?? '') : null;
    if (isConductor || !ticketId) {
      const threads = items<{ id?: string }>(await client.wget('/threads', { channel: 'web' }), 'threads');
      const threadId = threads[0]?.id ?? (await client.wpost<{ id?: string }>('/threads', { channel: 'web' }))?.id;
      if (!threadId) { setNotice('no thread available'); return; }
      await act('sent', () => client.wpost(`/threads/${encodeURIComponent(threadId)}/messages`, { body: text }));
      return;
    }
    await act('comment posted — the worker is woken', () => client.wpost(`/tickets/${encodeURIComponent(ticketId)}/comments`, { body: text }));
  }, [act, client, detail, isConductor]);

  useKeys((key, meta) => {
    if (mode === 'insert') {
      if (meta.escape) setMode('command');
      return;
    }
    if (key === 'q' || meta.escape) { exit(); return; }
    if (key === 'i' || meta.return) { setMode('insert'); return; }
    if (key === 'p') {
      const paused = detail?.agent?.status === 'paused';
      void act(paused ? 'resumed' : 'paused', () => client.wpost(`/workers/${encodeURIComponent(String(detail?.agent?.id ?? agentId))}/${paused ? 'resume' : 'pause'}`, { reason: 'from conductor attach' }));
      return;
    }
    if (key === 'r') {
      void act('relaunched', () => client.wpost(`/workers/${encodeURIComponent(String(detail?.agent?.id ?? agentId))}/relaunch`, { note: 'relaunched from conductor attach' }));
      return;
    }
    if (key === 'c') {
      if (!runId) { setNotice('no run to cancel'); return; }
      void act('run cancelled', () => client.wpost(`/runs/${encodeURIComponent(runId)}/cancel`, { mode: 'interrupt' }));
      return;
    }
    if (key === 'o') {
      const identifier = detail?.ticket ? String(detail.ticket['identifier'] ?? detail.ticket['id'] ?? '') : '';
      if (!identifier) { setNotice('no ticket on this agent'); return; }
      const url = `${client.baseUrl}/w/${client.workspace ?? ''}/tickets/${encodeURIComponent(identifier)}`;
      setNotice(url);
      void import('node:child_process').then(({ spawn }) => {
        try { spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref(); } catch { /* printed above either way */ }
      });
      return;
    }
    if (key === 'R') setNonce((n) => n + 1);
  }, { isActive: true });

  const maxLines = Math.max(6, rows - 8);

  return (
    <Box flexDirection="column">
      {error ? <Text color="red">{error}</Text> : null}
      <TranscriptView blocks={blocks} maxLines={maxLines} />
      {notice ? <Text color="yellow">{notice}</Text> : null}
      {mode === 'insert' ? (
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={(text) => { void submit(text); }}
          placeholder={isConductor ? 'message the conductor' : 'comment on the ticket (wakes the worker)'}
          history={history}
          focus
        />
      ) : (
        <Text dimColor>i type · p pause/resume · o open ticket · r relaunch · c cancel run · q quit</Text>
      )}
      <StatusBar
        left={card ? `${card.glyph} ${card.name} · ${card.role ?? '—'} · ${card.ticket?.identifier ?? 'no ticket'} · ${card.runtime}` : `attaching to ${agentId}…`}
        right={card ? `turn ${card.turn} · ${card.worktree?.label ?? 'no worktree'} · ${card.tokens ?? '—'} · ${card.cost ?? '—'}` : ''}
        connection={connection}
      />
    </Box>
  );
}
