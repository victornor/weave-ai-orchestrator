/**
 * The knowledge graph: hub files and documents as nodes, [[links]] as edges, laid out with a
 * small force simulation (no dependency; the graph is tens of nodes, not thousands). Hubs are
 * larger, nodes are coloured by project, and a click opens the page.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { useKnowledgeGraph } from '../api/hooks';
import type { KnowledgeGraph } from '../api/types';
import { cx } from '../lib/cx';

interface LaidOut { id: string; x: number; y: number; kind: 'hub' | 'doc'; title: string; group: string; tokens: number; degree: number }

const PALETTE = ['var(--accent)', 'var(--status-done)', 'var(--status-working)', 'var(--status-merging)', 'var(--status-blocked)', 'var(--status-needs-you)'];

/** Deterministic force layout in a 100×100 box: repulsion between all nodes, springs along edges, a pull to the centre. */
export function layoutGraph(graph: KnowledgeGraph, iterations = 260): LaidOut[] {
  const nodes = graph.nodes.map((n, i) => {
    const angle = (i / Math.max(1, graph.nodes.length)) * Math.PI * 2;
    const r = n.kind === 'hub' ? 18 : 34;
    return { id: n.id, x: 50 + Math.cos(angle) * r, y: 50 + Math.sin(angle) * r, vx: 0, vy: 0, kind: n.kind, title: n.title, group: n.projectSlug ?? n.scope, tokens: n.tokens, degree: 0 };
  });
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const edges = graph.edges.map((e) => [index.get(e.from), index.get(e.to)] as const).filter((e): e is readonly [number, number] => e[0] !== undefined && e[1] !== undefined);
  for (const [a, b] of edges) { nodes[a]!.degree++; nodes[b]!.degree++; }
  const n = nodes.length;
  if (n === 0) return [];
  const spring = 14;
  for (let it = 0; it < iterations; it++) {
    const cool = 1 - it / iterations;
    for (let i = 0; i < n; i++) {
      const a = nodes[i]!;
      let fx = (50 - a.x) * 0.03;
      let fy = (50 - a.y) * 0.03;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const b = nodes[j]!;
        let dx = a.x - b.x; let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = (Math.random() - 0.5) * 0.1; dy = (Math.random() - 0.5) * 0.1; d2 = 0.01; }
        const rep = 40 / d2;
        fx += dx * rep; fy += dy * rep;
      }
      a.vx = (a.vx + fx) * 0.5; a.vy = (a.vy + fy) * 0.5;
    }
    for (const [i, j] of edges) {
      const a = nodes[i]!; const b = nodes[j]!;
      const dx = b.x - a.x; const dy = b.y - a.y;
      const d = Math.max(0.1, Math.hypot(dx, dy));
      const f = ((d - spring) / d) * 0.06;
      a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
    }
    for (const a of nodes) {
      a.x = Math.min(92, Math.max(8, a.x + a.vx * cool));
      a.y = Math.min(88, Math.max(8, a.y + a.vy * cool));
    }
  }
  return nodes.map(({ vx: _vx, vy: _vy, ...rest }) => rest);
}

export function KnowledgeGraphView({ project, onOpen }: { project?: string; onOpen: (path: string) => void }): React.ReactElement {
  const graph = useKnowledgeGraph(project);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  const nodes = useMemo(() => (graph.data ? layoutGraph(graph.data) : []), [graph.data]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const groups = useMemo(() => [...new Set(nodes.map((n) => n.group))].sort(), [nodes]);
  const colour = (g: string): string => PALETTE[groups.indexOf(g) % PALETTE.length]!;
  const neighbours = useMemo(() => {
    const focus = hover ?? selected;
    if (!focus) return null;
    const set = new Set<string>([focus]);
    for (const e of graph.data?.edges ?? []) { if (e.from === focus) set.add(e.to); if (e.to === focus) set.add(e.from); }
    return set;
  }, [hover, selected, graph.data]);

  useEffect(() => { setSelected(null); }, [project]);

  if (graph.isLoading) return <SkeletonRows rows={6} />;
  if (graph.isError) return <ErrorState code="KNOWLEDGE_GRAPH_FAILED" message="The graph could not be built." onRetry={() => void graph.refetch()} />;
  if (!nodes.length) return <EmptyState title="Nothing to draw yet." detail="The graph fills in as documents are written and linked." />;

  const sel = selected ? byId.get(selected) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {groups.map((g) => (
          <span key={g} className="flex items-center gap-1.5 text-micro text-text-2">
            <span className="size-2 rounded-full" style={{ background: colour(g) }} />
            {g}
          </span>
        ))}
        <span className="ac-mono ml-auto text-nano text-text-4">{nodes.length} pages · {graph.data?.edges.length ?? 0} links · click to select, double-click to open</span>
      </div>
      <div className="ac-card p-2">
        <svg ref={svg} viewBox="0 0 100 100" className="h-[32rem] w-full select-none" role="img" aria-label="Knowledge graph">
          {(graph.data?.edges ?? []).map((e, i) => {
            const a = byId.get(e.from); const b = byId.get(e.to);
            if (!a || !b) return null;
            const dim = neighbours ? !(neighbours.has(e.from) && neighbours.has(e.to)) : false;
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--line-3)" strokeWidth={dim ? 0.15 : 0.35} strokeOpacity={dim ? 0.35 : 0.9} />;
          })}
          {nodes.map((n) => {
            const r = n.kind === 'hub' ? 2.6 : 1.4 + Math.min(1.4, n.degree * 0.25);
            const dim = neighbours ? !neighbours.has(n.id) : false;
            const active = selected === n.id;
            return (
              <g
                key={n.id}
                className="cursor-pointer"
                opacity={dim ? 0.3 : 1}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setSelected(n.id)}
                onDoubleClick={() => onOpen(n.id)}
              >
                {n.kind === 'hub' ? (
                  <rect x={n.x - r} y={n.y - r} width={r * 2} height={r * 2} rx={0.6} transform={`rotate(45 ${n.x} ${n.y})`} fill={colour(n.group)} fillOpacity={0.9} stroke={active ? 'var(--text-1)' : 'var(--bg-0)'} strokeWidth={0.4} />
                ) : (
                  <circle cx={n.x} cy={n.y} r={r} fill={colour(n.group)} fillOpacity={0.85} stroke={active ? 'var(--text-1)' : 'var(--bg-0)'} strokeWidth={0.35} />
                )}
                <text x={n.x} y={n.y + r + 2.4} fontSize={n.kind === 'hub' ? 2.2 : 1.9} textAnchor="middle" fill="var(--text-2)" className={cx(n.kind === 'hub' && 'font-semibold')}>
                  {n.title.length > 26 ? `${n.title.slice(0, 24)}…` : n.title}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {sel ? (
        <div className="ac-card flex flex-wrap items-center gap-3 px-3.5 py-2.5">
          <span className="text-meta font-medium text-text-1">{sel.title}</span>
          <span className="ac-mono text-nano text-text-4">{sel.id} · {sel.tokens} tok · {sel.degree} links</span>
          <div className="flex-1" />
          <button type="button" onClick={() => onOpen(sel.id)} className="text-micro text-accent-link hover:underline">Open</button>
        </div>
      ) : null}
    </div>
  );
}
