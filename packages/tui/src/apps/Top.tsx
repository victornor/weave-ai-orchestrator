/** `weave top` — one screen, every worker, grouped by project and role (PLAN §14b.1). */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import type { Agent, WorkerActivitySummary } from '@weave-ai/shared';
import { clock, statusRank, workerToCard, type WorkerCardModel } from '@weave-ai/render';
import { StatusBar } from '../components/StatusBar.js';
import { items, type TuiClient } from '../client.js';
import { useKeys, useNow, useStream, useTerminalSize } from '../hooks.js';
import { setTerminalTitle } from '../terminal.js';

type LiveState = NonNullable<WorkerActivitySummary['live']>;
type ActivityLine = NonNullable<WorkerActivitySummary['activity']>;

/** A worker's row plus the live/activity fields the workers read and the activity frames carry (VS-603). */
interface WorkerRow { agent: Agent; live: LiveState | null; activity: ActivityLine | null }
interface Row { card: WorkerCardModel; live: LiveState | null; activity: ActivityLine | null }
interface Group { key: string; project: string; role: string; workers: Row[] }

/**
 * What the fleet row says a worker is doing (VS-603): the live-turn state and how long it has been in
 * it, then the activity line, then the bare status. Pure, so the fallback ladder is testable.
 */
export function fleetActivityLabel(entry: { live?: LiveState | null; activity?: ActivityLine | null }, statusLabel: string, now: number): string {
  const label = entry.live?.label ?? entry.activity?.label ?? statusLabel;
  const since = entry.live?.since ?? entry.activity?.since ?? null;
  if (!since) return label;
  const ms = now - Date.parse(since);
  return Number.isFinite(ms) && ms >= 0 ? `${label} · ${clock(ms)}` : label;
}

export function Top({ client }: { client: TuiClient }): React.ReactElement {
  const { exit } = useApp();
  const { rows } = useTerminalSize();
  const now = useNow(true);
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  /** The newest `worker.activity` frame per agent, so rows move between the 15 s refetches. */
  const [liveByAgent, setLiveByAgent] = useState<Map<string, WorkerActivitySummary>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const [includeRetired, setIncludeRetired] = useState(false);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async () => {
    try {
      const payload = await client.wget('/workers', includeRetired ? { includeRetired: 'true' } : undefined);
      setWorkers(items<Agent & { live?: LiveState | null; activity?: ActivityLine | null }>(payload, 'workers').map((agent) => ({ agent, live: agent.live ?? null, activity: agent.activity ?? null })));
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [client, includeRetired]);

  useEffect(() => { void load(); }, [load, nonce]);
  useEffect(() => {
    const timer = setInterval(() => setNonce((n) => n + 1), 15_000);
    return () => clearInterval(timer);
  }, []);

  const connection = useStream(client, client.workspace ? client.w('/events') : null, (message) => {
    if (message.type === 'worker.activity') {
      const summary = (message.json as { payload?: WorkerActivitySummary } | null)?.payload;
      if (summary?.agentId) setLiveByAgent((current) => new Map(current).set(summary.agentId, summary));
      return;
    }
    if (message.type.startsWith('worker.') || message.type.startsWith('run.') || message.type.startsWith('ticket.')) {
      setNonce((n) => n + 1);
    }
  });

  const groups: Group[] = useMemo(() => {
    const byKey = new Map<string, Group>();
    for (const row of workers) {
      const card = workerToCard(row.agent, {});
      const summary = liveByAgent.get(row.agent.id ?? '');
      const live = summary?.live ?? row.live ?? null;
      const activity = summary?.activity ?? row.activity ?? null;
      const project = card.project ?? '—';
      const role = card.role ?? (card.kind === 'weaver' ? 'weaver' : '—');
      const key = `${project}/${role}`;
      const group = byKey.get(key) ?? { key, project, role, workers: [] };
      group.workers.push({ card, live, activity });
      byKey.set(key, group);
    }
    for (const group of byKey.values()) group.workers.sort((a, b) => statusRank(a.card.uiStatus) - statusRank(b.card.uiStatus));
    return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [workers, liveByAgent]);

  const needsYou = useMemo(() => groups.flatMap((g) => g.workers).filter((w) => w.card.uiStatus === 'needs-you').length, [groups]);

  useEffect(() => {
    setTerminalTitle(`Fleet · ${workers.length} workers · ${needsYou} need you`);
  }, [workers.length, needsYou]);

  useKeys((key, meta) => {
    if (key === 'q' || meta.escape) { exit(); return; }
    if (key === 'r') setNonce((n) => n + 1);
    if (key === 'a') setIncludeRetired((value) => !value);
  });

  const budget = Math.max(4, rows - 4);
  let printed = 0;

  return (
    <Box flexDirection="column">
      {error ? <Text color="red">{error}</Text> : null}
      {groups.map((group) => {
        if (printed >= budget) return null;
        printed += 1 + group.workers.length;
        return (
          <Box key={group.key} flexDirection="column">
            <Text bold>{group.project} · {group.role}</Text>
            {group.workers.map((worker) => (
              <Text key={worker.card.id}>
                {'  '}
                <Text>{worker.card.glyph} </Text>
                <Text>{pad(worker.card.name, 24)}</Text>
                <Text dimColor>{pad(worker.card.ticket?.identifier ?? '—', 12)}</Text>
                <Text dimColor>{pad(fleetActivityLabel(worker, worker.card.statusLabel, now), 34)}</Text>
                <Text dimColor>{pad(worker.card.tokens ?? '—', 10)}</Text>
                <Text dimColor>{worker.card.cost ?? '—'}</Text>
              </Text>
            ))}
          </Box>
        );
      })}
      {groups.length === 0 ? <Text dimColor>no workers running</Text> : null}
      <StatusBar
        left={`${workers.length} worker${workers.length === 1 ? '' : 's'} · ${needsYou} need you${includeRetired ? ' · including retired' : ''}`}
        right="r refresh · a retired · q quit"
        connection={connection}
      />
    </Box>
  );
}

function pad(text: string, width: number): string {
  const value = text.length > width - 1 ? `${text.slice(0, Math.max(0, width - 2))}…` : text;
  return value.padEnd(width);
}
