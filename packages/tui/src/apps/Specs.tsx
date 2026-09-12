/**
 * `weave specs explore` — capability list, capability page, neighbours list. Phone and TUI show the
 * graph the same way: the selected node, then its neighbours, one hop at a time (design contract §7.4).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import { oneLine } from '@weave-ai/render';
import { StatusBar } from '../components/StatusBar.js';
import { items, type TuiClient } from '../client.js';
import { useKeys, useTerminalSize } from '../hooks.js';
import { setTerminalTitle } from '../terminal.js';

interface Capability { id?: string; capability?: string; title?: string | null; requirementCount?: number; pendingChanges?: number; updatedAt?: string }
interface CapabilityPage {
  capability?: string; title?: string | null; body?: string;
  requirements?: Array<{ name?: string; text?: string }>;
  pending?: Array<{ changeName?: string; ticketId?: string | null; deltaKind?: string }>;
  history?: Array<{ changeName?: string; ticketId?: string | null; archivedAt?: string | null }>;
}
interface GraphNode { id?: string; kind?: string; label?: string; status?: string }
interface GraphEdge { from?: string; to?: string; kind?: string }

type View = 'list' | 'page' | 'neighbours';

export function Specs({ client, projectId }: { client: TuiClient; projectId: string }): React.ReactElement {
  const { exit } = useApp();
  const { rows } = useTerminalSize();
  const [view, setView] = useState<View>('list');
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [cursor, setCursor] = useState(0);
  const [page, setPage] = useState<CapabilityPage | null>(null);
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await client.wget(`/specs/${encodeURIComponent(projectId)}`);
        if (!cancelled) setCapabilities(items<Capability>(payload, 'capabilities'));
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [client, projectId]);

  const selected = capabilities[cursor] ?? null;

  useEffect(() => {
    setTerminalTitle(`Specs · ${projectId}${selected?.capability ? ` · ${selected.capability}` : ''}`);
  }, [projectId, selected?.capability]);

  const openCapability = useCallback(async () => {
    if (!selected?.capability) return;
    try {
      const payload = await client.wget<CapabilityPage>(`/specs/${encodeURIComponent(projectId)}/capabilities/${encodeURIComponent(selected.capability)}`);
      setPage(payload);
      setView('page');
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [client, projectId, selected]);

  const openNeighbours = useCallback(async () => {
    if (!selected?.capability) return;
    try {
      const payload = await client.wget<{ nodes?: GraphNode[]; edges?: GraphEdge[] }>(`/specs/${encodeURIComponent(projectId)}/graph`);
      setGraph({ nodes: payload?.nodes ?? [], edges: payload?.edges ?? [] });
      setView('neighbours');
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [client, projectId, selected]);

  const neighbours = useMemo(() => {
    if (!graph || !selected?.capability) return [];
    const id = selected.id ?? selected.capability;
    const related = graph.edges.filter((edge) => edge.from === id || edge.to === id);
    const ids = new Set(related.map((edge) => (edge.from === id ? edge.to : edge.from)));
    return graph.nodes.filter((node) => node.id !== undefined && ids.has(node.id));
  }, [graph, selected]);

  useKeys((key, meta) => {
    if (key === 'q' || (meta.escape && view === 'list')) { exit(); return; }
    if (meta.escape || key === 'h' || meta.leftArrow) { setView('list'); return; }
    if (view !== 'list') return;
    if (meta.downArrow || key === 'j') setCursor((c) => Math.min(capabilities.length - 1, c + 1));
    if (meta.upArrow || key === 'k') setCursor((c) => Math.max(0, c - 1));
    if (meta.return || key === 'l') void openCapability();
    if (key === 'n') void openNeighbours();
  });

  const height = Math.max(4, rows - 4);

  return (
    <Box flexDirection="column">
      {error ? <Text color="red">{error}</Text> : null}

      {view === 'list' ? (
        <Box flexDirection="column">
          {capabilities.slice(0, height).map((capability, index) => (
            <Text key={capability.capability ?? String(index)} inverse={index === cursor}>
              {(capability.capability ?? '').padEnd(28)}
              <Text dimColor>{String(capability.requirementCount ?? 0).padStart(4)} reqs</Text>
              {capability.pendingChanges ? <Text color="yellow">{`  ${capability.pendingChanges} pending`}</Text> : null}
              {capability.title ? <Text dimColor>{`  ${oneLine(capability.title, 40)}`}</Text> : null}
            </Text>
          ))}
          {capabilities.length === 0 ? <Text dimColor>no capabilities indexed for {projectId}</Text> : null}
        </Box>
      ) : null}

      {view === 'page' && page ? (
        <Box flexDirection="column">
          <Text bold>{page.title ?? page.capability}</Text>
          {(page.requirements ?? []).slice(0, height).map((requirement, index) => (
            <Box key={requirement.name ?? String(index)} flexDirection="column" marginTop={1}>
              <Text bold>{requirement.name}</Text>
              <Text>{oneLine(requirement.text ?? '', 400)}</Text>
            </Box>
          ))}
          {(page.pending ?? []).length > 0 ? (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>Pending</Text>
              {(page.pending ?? []).map((delta, index) => (
                <Text key={`${delta.changeName ?? index}`} color="yellow">
                  {(delta.deltaKind ?? '').toUpperCase()} {delta.changeName}{delta.ticketId ? ` · ${delta.ticketId}` : ''}
                </Text>
              ))}
            </Box>
          ) : null}
        </Box>
      ) : null}

      {view === 'neighbours' ? (
        <Box flexDirection="column">
          <Text bold>{selected?.capability} · neighbours</Text>
          {neighbours.slice(0, height).map((node, index) => (
            <Text key={node.id ?? String(index)}>
              <Text dimColor>{(node.kind ?? '').padEnd(11)}</Text>
              {node.label ?? node.id}
              {node.status ? <Text dimColor>{`  ${node.status}`}</Text> : null}
            </Text>
          ))}
          {neighbours.length === 0 ? <Text dimColor>no neighbours</Text> : null}
        </Box>
      ) : null}

      <StatusBar
        left={`specs · ${projectId} · ${view}`}
        right={view === 'list' ? 'j/k move · enter open · n neighbours · q quit' : 'esc back · q quit'}
      />
    </Box>
  );
}
