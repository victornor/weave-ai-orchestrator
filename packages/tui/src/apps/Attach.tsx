/**
 * `weave attach <agent>` — the universal terminal view of one agent (PLAN §14b.1): live transcript,
 * status bar, and an input line that sends live to a worker (VS-99: the ticket comment is recorded
 * either way, and the notice line says whether it reached the running turn or was queued for the
 * next one) or a thread message (conductor).
 *
 * Keys (command mode): p pause/resume · o open ticket · r relaunch · c cancel run · q quit ·
 * i or Enter to type, Esc back to command mode.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import type { Agent, Run, RunDeltaFrame, RunEvent, RunLiveSnapshot } from '@weave-ai/shared';
import { isActiveRun } from '@weave-ai/shared';
import { applyDelta, dropSuperseded, fromSnapshot, runEventFromFrame, runtimePartialOutput, runEventsToTranscript, workerToCard, type PartialMap, type TranscriptBlock } from '@weave-ai/render';
import { ActivityLine } from '../components/ActivityLine.js';
import { StatusBar } from '../components/StatusBar.js';
import { TextInput } from '../components/TextInput.js';
import { TranscriptView } from '../components/Transcript.js';
import { items, unwrap, type TuiClient } from '../client.js';
import { useKeys, useStream, useTerminalSize } from '../hooks.js';
import { setTerminalTitle } from '../terminal.js';

interface WorkerDetail { agent?: Agent; ticket?: Record<string, unknown>; lastRun?: Run; usage?: Record<string, unknown>; input?: LiveInputStatus }

/** `GET /workers/:id`'s `input` field (VS-99): whether the human's next message reaches a running turn. */
export interface LiveInputStatus { midTurn: boolean; reason?: string }

/** The notice line for `POST /workers/:id/message`'s outcome (VS-99) — never invents "delivered". */
export function deliveryNotice(outcome: { delivery?: 'mid_turn' | 'queued' } | null | undefined): string {
  return outcome?.delivery === 'mid_turn' ? 'delivered to the running turn' : 'queued for the next turn';
}

/**
 * Fold one `run.delta` frame into the partial map (VS-603), but only for the run being followed.
 * Pure, so the "a frame moves the row" rule is testable without rendering Ink.
 */
export function foldDelta(current: PartialMap, frame: RunDeltaFrame, runId: string | null): { map: PartialMap; gap: boolean; matched: boolean } {
  if (!runId || frame.runId !== runId || !Array.isArray(frame.parts)) return { map: current, gap: false, matched: false };
  const { map, gap } = applyDelta(current, frame.parts);
  return { map, gap, matched: true };
}

/**
 * The pre-send label for `weave attach` (VS-253): whether the words about to be typed reach the
 * running turn or queue for the next one, carrying the reason the API supplies. The wording is the
 * web app's composer label (`WorkerPage.tsx`), and `null` while the detail fetch has not resolved, so
 * an unresolved status implies neither delivery.
 */
export function preSendLabel(input: LiveInputStatus | null | undefined): string | null {
  if (!input) return null;
  return input.midTurn ? 'Reaches the running turn immediately.' : `Queued for the next turn${input.reason ? ` — ${input.reason}` : ''}.`;
}

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
  /** The daemon's runtimes, for what this run's runtime can stream. */
  const [runtimes, setRuntimes] = useState<Array<{ id: string; capabilities?: unknown }> | null>(null);
  useEffect(() => { void client.get<Array<{ id: string; capabilities?: unknown }>>('/runtimes').then(setRuntimes).catch(() => undefined); }, [client]);
  /** VS-603: what the run is still generating, and whether a turn is live for the row. */
  const [partials, setPartials] = useState<PartialMap>(() => new Map());
  const [partialClock, setPartialClock] = useState<{ last: number | null; since: number | null }>({ last: null, since: null });
  const [live, setLive] = useState(false);

  const isConductor = agentId === 'weaver';

  /** A page that connects mid-step reads what has been shown so far once, then follows frames. */
  const readLive = useCallback(async (id: string) => {
    try {
      const snap = await client.wget<RunLiveSnapshot>(`/runs/${encodeURIComponent(id)}/live`);
      if (!snap?.partials?.length) return;
      setPartials(fromSnapshot(snap));
      setPartialClock((c) => ({ last: Date.now(), since: c.since ?? Date.now() }));
    } catch {
      /* the live row is an extra; the transcript still works without it */
    }
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = isConductor
          ? await client.wget<unknown>('/weaver')
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
        if (record.lastRun?.status && isActiveRun(record.lastRun.status)) setLive(true);
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

  /** The current run id, readable from the stream handler without waiting for a re-render. */
  const runIdRef = useRef<string | null>(null);
  useEffect(() => { runIdRef.current = runId; }, [runId]);
  const partialsRef = useRef<PartialMap>(partials);
  useEffect(() => { partialsRef.current = partials; }, [partials]);

  // Run events for the current run, plus the workspace stream so a new run swaps us over to it.
  useStream(client, runId ? client.w(`/runs/${encodeURIComponent(runId)}/events/stream`) : null, (message) => {
    const event = runEventFromFrame(message.json);
    if (!event) return;
    setEvents((prev) => (prev.some((e) => e.id === event.id) ? prev : [...prev, event]));
  }, { after: lastSeq });

  const connection = useStream(client, client.workspace ? client.w('/events') : null, (message) => {
    if (message.type === 'run.delta') {
      const frame = (message.json as { payload?: RunDeltaFrame } | null)?.payload ?? null;
      if (!frame) return;
      const next = foldDelta(partialsRef.current, frame, runIdRef.current);
      if (!next.matched) return;
      partialsRef.current = next.map;
      setPartials(next.map);
      setPartialClock((c) => ({ last: Date.now(), since: c.since ?? Date.now() }));
      if (next.gap) void readLive(frame.runId);
      return;
    }
    if (message.type === 'run.started') {
      const payload = (message.json as { payload?: Record<string, unknown> } | null)?.payload ?? {};
      if (String(payload['agentId'] ?? '') !== String(detail?.agent?.id ?? agentId)) return;
      const started = String(payload['id'] ?? payload['runId'] ?? '');
      if (started) { runIdRef.current = started; setRunId(started); setEvents([]); void readLive(started); }
      setLive(true);
      setPartials(new Map());
      setPartialClock({ last: null, since: null });
      // A turn starting changes the pre-send label (VS-253); refetch the detail. A turn ending
      // already does via `run.finished`, and no interval exists, so the label only moves on events.
      setNonce((n) => n + 1);
      return;
    }
    if (message.type === 'run.finished') {
      if (String((message.json as { entityId?: string } | null)?.entityId ?? '') !== String(runIdRef.current ?? '')) {
        // Only clear the row for the run we are following; another run's finish just refreshes detail.
        setNonce((n) => n + 1);
        return;
      }
      setLive(false);
      setPartials(new Map());
      setPartialClock({ last: null, since: null });
      setNonce((n) => n + 1);
      return;
    }
    if (message.type === 'worker.status') setNonce((n) => n + 1);
  });

  // A page opened mid-step, or one whose stream dropped and came back, reads the run's partials once.
  useEffect(() => {
    if (connection !== 'connected' || !runId) return;
    void readLive(runId);
  }, [connection, runId, readLive]);

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

  /** The partials not yet superseded by a completed event, so the row says "Writing", not "Waiting". */
  const livePartials = useMemo(() => dropSuperseded(partials, events), [partials, events]);

  // Before a message: whether it would reach the running turn or queue (VS-253); null until known.
  const preSend = isConductor ? null : preSendLabel(detail?.input);

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
    const workerId = encodeURIComponent(String(detail?.agent?.id ?? agentId));
    try {
      const outcome = await client.wpost<{ delivery?: 'mid_turn' | 'queued' }>(`/workers/${workerId}/message`, { body: text, live: true });
      setNotice(deliveryNotice(outcome));
      setNonce((n) => n + 1);
    } catch (cause) {
      setNotice((cause as Error).message);
    }
  }, [client, detail, isConductor, agentId]);

  useKeys((key, meta) => {
    if (mode === 'insert') {
      if (meta.escape) setMode('command');
      return;
    }
    if (key === 'q' || meta.escape) { exit(); return; }
    if (key === 'i' || meta.return) { setMode('insert'); return; }
    if (key === 'p') {
      const paused = detail?.agent?.status === 'paused';
      void act(paused ? 'resumed' : 'paused', () => client.wpost(`/workers/${encodeURIComponent(String(detail?.agent?.id ?? agentId))}/${paused ? 'resume' : 'pause'}`, { reason: 'from weave attach' }));
      return;
    }
    if (key === 'r') {
      void act('relaunched', () => client.wpost(`/workers/${encodeURIComponent(String(detail?.agent?.id ?? agentId))}/relaunch`, { note: 'relaunched from weave attach' }));
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

  const maxLines = Math.max(6, rows - 8 - (preSend ? 1 : 0) - (live ? 1 : 0));

  return (
    <Box flexDirection="column">
      {error ? <Text color="red">{error}</Text> : null}
      <TranscriptView blocks={blocks} maxLines={maxLines} />
      {notice ? <Text color="yellow">{notice}</Text> : null}
      {preSend ? <Text dimColor>{preSend}</Text> : null}
      <ActivityLine
        events={events}
        partials={livePartials}
        partialOutput={runtimePartialOutput(runtimes, detail?.agent?.runtimeId)}
        partialSince={partialClock.since}
        lastPartialAt={partialClock.last}
        live={live}
      />
      {mode === 'insert' ? (
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={(text) => { void submit(text); }}
          placeholder={isConductor ? 'message the weaver' : 'steer the worker'}
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
