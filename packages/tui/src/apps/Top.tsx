/** `conductor top` — one screen, every worker, grouped by project and role (PLAN §14b.1). */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import type { Agent } from '@agent-conductor/shared';
import { statusRank, workerToCard, type WorkerCardModel } from '@agent-conductor/render';
import { StatusBar } from '../components/StatusBar.js';
import { items, type TuiClient } from '../client.js';
import { useKeys, useStream, useTerminalSize } from '../hooks.js';
import { setTerminalTitle } from '../terminal.js';

interface Group { key: string; project: string; role: string; workers: WorkerCardModel[] }

export function Top({ client }: { client: TuiClient }): React.ReactElement {
  const { exit } = useApp();
  const { rows } = useTerminalSize();
  const [workers, setWorkers] = useState<Agent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [includeRetired, setIncludeRetired] = useState(false);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async () => {
    try {
      const payload = await client.wget('/workers', includeRetired ? { includeRetired: 'true' } : undefined);
      setWorkers(items<Agent>(payload, 'workers'));
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
    if (message.type.startsWith('worker.') || message.type.startsWith('run.') || message.type.startsWith('ticket.')) {
      setNonce((n) => n + 1);
    }
  });

  const groups: Group[] = useMemo(() => {
    const cards = workers.map((agent) => workerToCard(agent, {}));
    const byKey = new Map<string, Group>();
    for (const card of cards) {
      const project = card.project ?? '—';
      const role = card.role ?? (card.kind === 'weaver' ? 'weaver' : '—');
      const key = `${project}/${role}`;
      const group = byKey.get(key) ?? { key, project, role, workers: [] };
      group.workers.push(card);
      byKey.set(key, group);
    }
    for (const group of byKey.values()) group.workers.sort((a, b) => statusRank(a.uiStatus) - statusRank(b.uiStatus));
    return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [workers]);

  const needsYou = useMemo(() => groups.flatMap((g) => g.workers).filter((w) => w.uiStatus === 'needs-you').length, [groups]);

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
              <Text key={worker.id}>
                {'  '}
                <Text>{worker.glyph} </Text>
                <Text>{pad(worker.name, 24)}</Text>
                <Text dimColor>{pad(worker.ticket?.identifier ?? '—', 12)}</Text>
                <Text dimColor>{pad(worker.statusLabel, 10)}</Text>
                <Text dimColor>{pad(worker.tokens ?? '—', 10)}</Text>
                <Text dimColor>{worker.cost ?? '—'}</Text>
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
