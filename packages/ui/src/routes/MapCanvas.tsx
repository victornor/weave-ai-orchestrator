/**
 * Instance Map canvas: reuses `lib/graph/` simulation, viewport and hulls with Map node kinds.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { EmptyState } from '../components/States';
import { cx } from '../lib/cx';
import { buildModel, type GraphModel, type GraphNode } from '../lib/graph/model';
import { edgeDimmed, highlighted, nodeDimmed, visible } from '../lib/graph/filters';
import { createSimulation, nodeRadius, type GraphSimulation, type SimLink, type SimNode } from '../lib/graph/simulation';
import { hullPath, type Point } from '../lib/graph/hull';
import {
  boundsOf,
  fitTo,
  IDENTITY,
  labelDetail,
  toSvg,
  toGraph,
  panBy,
  pinchScale,
  midpoint,
  zoomAround,
  type LabelDetail,
  type Size,
  type ViewportTransform,
} from '../lib/graph/viewport';
import { filterKinds, type MapModel, type MapNode, type MapNodeKind } from '../lib/map/model';

const FALLBACK_SIZE: Size = { width: 900, height: 520 };
const CLICK_SLOP_PX = 4;
const HULL_PAD = 36;
const VIEW_TWEEN_MS = 260;
const PALETTE = ['var(--accent)', 'var(--status-done)', 'var(--status-working)', 'var(--status-merging)', 'var(--status-blocked)', 'var(--status-needs-you)'];

const KIND_LABEL: Record<MapNodeKind, string> = {
  workspace: 'Workspace',
  project: 'Project',
  conductor: 'Conductor',
  role: 'Role',
  ticket: 'Ticket',
  knowledge: 'Knowledge',
};

const KINDS: MapNodeKind[] = ['workspace', 'project', 'conductor', 'role', 'ticket', 'knowledge'];

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (): void => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

function mapToGraph(model: MapModel): GraphModel {
  return buildModel({
    nodes: model.nodes.map((n) => ({
      id: n.id,
      kind: n.kind === 'workspace' || n.kind === 'conductor' ? 'hub' : 'doc',
      title: n.title,
      scope: n.kind,
      projectId: n.projectId ?? null,
      projectSlug: n.workspaceId,
      slug: null,
      tokens: 0,
      updatedAt: '',
    })),
    edges: model.edges.map((e) => ({ from: e.source, to: e.target })),
  });
}

export function MapCanvas({ model, onOpen }: { model: MapModel; onOpen: (node: MapNode) => void }): React.ReactElement {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const phone = useMediaQuery('(max-width: 640px)');
  const animated = !reduced;

  const [hidden, setHidden] = useState<ReadonlySet<MapNodeKind>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [detail, setDetail] = useState<LabelDetail>('truncated');
  const [canvas, setCanvas] = useState(false);

  const filtered = useMemo(() => filterKinds(model, hidden), [model, hidden]);
  const graph = useMemo(() => mapToGraph(filtered), [filtered]);
  const shown = useMemo(() => visible(graph, new Set()), [graph]);
  const lit = useMemo(() => highlighted(shown, hover ?? selected), [shown, hover, selected]);
  const colourOf = useCallback((group: string): string => {
    const i = Math.max(0, shown.groups.indexOf(group));
    return PALETTE[i % PALETTE.length]!;
  }, [shown]);

  const frameRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const sceneRef = useRef<SVGGElement>(null);
  const nodeRefs = useRef(new Map<string, SVGGElement>());
  const labelRefs = useRef(new Map<string, SVGGElement>());
  const edgeRefs = useRef(new Map<string, SVGPathElement>());
  const hullRefs = useRef(new Map<string, SVGPathElement>());
  const simRef = useRef<GraphSimulation | null>(null);
  const viewRef = useRef<ViewportTransform>(IDENTITY);
  const sizeRef = useRef<Size>(FALLBACK_SIZE);
  const autoFitRef = useRef(true);
  const labelsDirtyRef = useRef(true);
  const tweenRef = useRef<number | null>(null);

  const measure = useCallback((): Size => {
    const el = frameRef.current;
    const width = el?.clientWidth || FALLBACK_SIZE.width;
    const height = el?.clientHeight || FALLBACK_SIZE.height;
    sizeRef.current = { width, height };
    return sizeRef.current;
  }, []);

  const applyView = useCallback((next: ViewportTransform): void => {
    const zoomed = viewRef.current.k !== next.k;
    viewRef.current = next;
    sceneRef.current?.setAttribute('transform', toSvg(next));
    if (zoomed) {
      writeLabels(labelRefs.current, next.k);
      labelsDirtyRef.current = false;
      setDetail((was) => {
        const now = labelDetail(next.k);
        return now === was ? was : now;
      });
    }
  }, []);

  const moveView = useCallback((target: ViewportTransform): void => {
    if (tweenRef.current !== null) cancelAnimationFrame(tweenRef.current);
    tweenRef.current = null;
    if (!animated) {
      applyView(target);
      return;
    }
    const from = viewRef.current;
    const started = performance.now();
    const step = (): void => {
      const p = Math.min(1, (performance.now() - started) / VIEW_TWEEN_MS);
      const e = 1 - (1 - p) * (1 - p);
      applyView({ k: from.k + (target.k - from.k) * e, x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e });
      tweenRef.current = p < 1 ? requestAnimationFrame(step) : null;
    };
    step();
  }, [animated, applyView]);

  const draw = useCallback((): void => {
    const sim = simRef.current;
    if (!sim) return;
    const nodes = sim.nodes();
    if (labelsDirtyRef.current) {
      writeLabels(labelRefs.current, viewRef.current.k);
      labelsDirtyRef.current = false;
    }
    for (const n of nodes) nodeRefs.current.get(n.id)?.setAttribute('transform', `translate(${n.x} ${n.y})`);
    for (const link of sim.links()) {
      const el = edgeRefs.current.get(link.id);
      if (!el) continue;
      el.setAttribute('d', edgePath(link));
    }
    const byGroup = new Map<string, Point[]>();
    for (const n of nodes) {
      const points = byGroup.get(n.group) ?? [];
      points.push({ x: n.x, y: n.y });
      byGroup.set(n.group, points);
    }
    for (const [group, el] of hullRefs.current) {
      const d = hullPath(byGroup.get(group) ?? [], HULL_PAD);
      if (d) el.setAttribute('d', d);
      else el.removeAttribute('d');
    }
    if (autoFitRef.current) {
      const bounds = boundsOf(nodes.map((n) => ({ x: n.x, y: n.y })));
      if (bounds) applyView(fitTo(bounds, sizeRef.current));
    }
  }, [applyView]);

  const animatedRef = useRef(animated);
  useEffect(() => {
    if (!shown.nodes.length) return;
    const size = measure();
    if (simRef.current && animatedRef.current !== animated) {
      simRef.current.destroy();
      simRef.current = null;
    }
    animatedRef.current = animated;
    let sim = simRef.current;
    if (!sim) {
      sim = createSimulation(shown, size, { animated });
      simRef.current = sim;
      sim.onTick(draw);
      sim.start(1);
    } else {
      sim.update(shown, size);
    }
    labelsDirtyRef.current = true;
    draw();
  }, [shown, animated, draw, measure]);

  useEffect(() => () => {
    simRef.current?.destroy();
    simRef.current = null;
    if (tweenRef.current !== null) cancelAnimationFrame(tweenRef.current);
  }, []);

  const fitView = useCallback((): void => {
    const nodes = simRef.current?.nodes() ?? [];
    const bounds = boundsOf(nodes.map((n) => ({ x: n.x, y: n.y })));
    autoFitRef.current = false;
    if (bounds) moveView(fitTo(bounds, measure()));
  }, [measure, moveView]);

  const pointersRef = useRef(new Map<number, Point>());
  const gestureRef = useRef<{ pointerId: number; nodeId: string | null; last: Point; moved: number } | null>(null);
  const pinchRef = useRef<readonly [Point, Point] | null>(null);
  const draggedRef = useRef(false);

  const localPoint = useCallback((e: { clientX: number; clientY: number }): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  }, []);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    const at = localPoint(e);
    pointersRef.current.set(e.pointerId, at);
    draggedRef.current = false;
    autoFitRef.current = false;
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = [a!, b!];
      gestureRef.current = null;
      return;
    }
    const nodeId = (e.target as Element | null)?.closest?.('[data-node]')?.getAttribute('data-node') ?? null;
    gestureRef.current = { pointerId: e.pointerId, nodeId, last: at, moved: 0 };
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (!pointersRef.current.has(e.pointerId)) return;
    const at = localPoint(e);
    pointersRef.current.set(e.pointerId, at);
    if (pinchRef.current && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const now = [a!, b!] as const;
      applyView(zoomAround(viewRef.current, midpoint(now[0], now[1]), pinchScale(pinchRef.current, now)));
      pinchRef.current = now;
      return;
    }
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    const dx = at.x - gesture.last.x;
    const dy = at.y - gesture.last.y;
    gesture.last = at;
    gesture.moved += Math.hypot(dx, dy);
    if (gesture.moved > CLICK_SLOP_PX) draggedRef.current = true;
    if (gesture.nodeId) {
      const g = toGraph(viewRef.current, at);
      simRef.current?.drag(gesture.nodeId, g.x, g.y);
    } else {
      applyView(panBy(viewRef.current, dx, dy));
    }
  };

  const endPointer = (e: React.PointerEvent<SVGSVGElement>): void => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    const gesture = gestureRef.current;
    if (gesture && gesture.pointerId === e.pointerId) {
      if (gesture.nodeId) simRef.current?.endDrag(gesture.nodeId);
      gestureRef.current = null;
    }
    svgRef.current?.releasePointerCapture?.(e.pointerId);
  };

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      autoFitRef.current = false;
      applyView(zoomAround(viewRef.current, localPoint(e), Math.exp(-e.deltaY * 0.0015)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyView, localPoint, canvas, phone]);

  const selectNode = (id: string): void => {
    if (draggedRef.current) return;
    setSelected(id);
  };

  const openNode = (id: string): void => {
    const n = filtered.byId.get(id);
    if (n) onOpen(n);
  };

  if (!filtered.nodes.length) {
    return <EmptyState title="Every kind is hidden." detail="Switch a kind back on to see its nodes." />;
  }

  const asList = phone && !canvas;
  const sel = selected ? filtered.byId.get(selected) ?? null : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {!asList ? <Button size="sm" onClick={fitView}>Fit</Button> : null}
        {phone ? (
          <Button size="sm" onClick={() => setCanvas((v) => !v)}>{canvas ? 'List' : 'Canvas'}</Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {KINDS.map((k) => {
          const off = hidden.has(k);
          return (
            <button
              key={k}
              type="button"
              aria-pressed={!off}
              onClick={() => setHidden((was) => {
                const next = new Set(was);
                if (next.has(k)) next.delete(k);
                else next.add(k);
                return next;
              })}
              className={cx('flex items-center gap-1.5 text-micro', off ? 'text-text-4 line-through' : 'text-text-2')}
            >
              {KIND_LABEL[k]}
            </button>
          );
        })}
      </div>

      {asList ? (
        <NeighbourList model={filtered} graph={shown} selected={selected} onSelect={setSelected} onOpen={openNode} colourOf={colourOf} />
      ) : (
        <div ref={frameRef} className="ac-card relative overflow-hidden p-0">
          <svg
            ref={svgRef}
            className="h-[32rem] w-full touch-none select-none"
            aria-label="Instance map"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
          >
            <g ref={sceneRef}>
              <g aria-hidden="true">
                {shown.groups.map((g) => (
                  <path
                    key={g}
                    ref={(el) => { if (el) hullRefs.current.set(g, el); else hullRefs.current.delete(g); }}
                    fill={colourOf(g)}
                    fillOpacity={0.07}
                    stroke={colourOf(g)}
                    strokeOpacity={0.18}
                    strokeWidth={1.5}
                  />
                ))}
              </g>
              <g aria-hidden="true">
                {shown.edges.map((e) => {
                  const dim = edgeDimmed(e, lit, null);
                  return (
                    <path
                      key={e.id}
                      ref={(el) => { if (el) edgeRefs.current.set(e.id, el); else edgeRefs.current.delete(e.id); }}
                      data-edge={e.id}
                      fill="none"
                      stroke="var(--line-3)"
                      strokeWidth={dim ? 0.8 : 1.6}
                      strokeOpacity={dim ? 0.25 : 0.85}
                    />
                  );
                })}
              </g>
              <g>
                {shown.nodes.map((n) => {
                  const mapNode = filtered.byId.get(n.id);
                  return (
                    <MapNodeShape
                      key={n.id}
                      node={n}
                      kind={mapNode?.kind ?? 'project'}
                      colour={colourOf(n.group)}
                      dimmed={nodeDimmed(n.id, lit, null)}
                      selected={selected === n.id}
                      label={labelFor(n, detail, selected === n.id || hover === n.id)}
                      nodeRef={(el) => { if (el) nodeRefs.current.set(n.id, el); else nodeRefs.current.delete(n.id); }}
                      labelRef={(el) => { if (el) labelRefs.current.set(n.id, el); else labelRefs.current.delete(n.id); }}
                      onEnter={() => setHover(n.id)}
                      onLeave={() => setHover((was) => (was === n.id ? null : was))}
                      onSelect={() => selectNode(n.id)}
                      onOpen={() => openNode(n.id)}
                    />
                  );
                })}
              </g>
            </g>
          </svg>
        </div>
      )}

      {sel ? (
        <div className="ac-card flex flex-wrap items-center gap-2 px-3.5 py-3" data-graph-detail>
          <span className="text-meta font-medium text-text-1">{sel.title}</span>
          <span className="ac-mono text-nano text-text-4">{KIND_LABEL[sel.kind]} · {sel.workspaceName}</span>
          <div className="flex-1" />
          <Button size="sm" variant="primary" onClick={() => onOpen(sel)}>Open</Button>
          <Button size="sm" variant="ghost" aria-label="Close the detail panel" onClick={() => setSelected(null)}>Close</Button>
        </div>
      ) : null}
    </div>
  );
}

export default MapCanvas;

function labelFor(node: GraphNode, detail: LabelDetail, focused: boolean): string | null {
  if (detail === 'none' && node.kind !== 'hub' && !focused) return null;
  if (detail === 'full' || focused) return node.title;
  return node.title.length > 26 ? `${node.title.slice(0, 24)}…` : node.title;
}

function edgePath(link: SimLink): string {
  const s = link.source as SimNode;
  const t = link.target as SimNode;
  if (typeof s !== 'object' || typeof t !== 'object') return '';
  const dx = t.x - s.x;
  const dy = t.y - s.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return `M${round(s.x + ux * s.radius)} ${round(s.y + uy * s.radius)}L${round(t.x - ux * t.radius)} ${round(t.y - uy * t.radius)}`;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function writeLabels(labels: ReadonlyMap<string, SVGGElement>, k: number): void {
  const inverse = 1 / k;
  for (const el of labels.values()) {
    el.setAttribute('transform', `translate(0 ${Number(el.dataset['r'] ?? 8)}) scale(${inverse})`);
  }
}

function MapNodeShape({
  node, kind, colour, dimmed, selected, label, nodeRef, labelRef, onEnter, onLeave, onSelect, onOpen,
}: {
  node: GraphNode;
  kind: MapNodeKind;
  colour: string;
  dimmed: boolean;
  selected: boolean;
  label: string | null;
  nodeRef: (el: SVGGElement | null) => void;
  labelRef: (el: SVGGElement | null) => void;
  onEnter: () => void;
  onLeave: () => void;
  onSelect: () => void;
  onOpen: () => void;
}): React.ReactElement {
  const r = nodeRadius(node);
  const stroke = selected ? 'var(--text-1)' : 'var(--bg-0)';
  return (
    <g
      ref={nodeRef}
      data-node={node.id}
      data-kind={kind}
      role="button"
      tabIndex={0}
      aria-label={node.title}
      className="cursor-pointer"
      opacity={dimmed ? 0.22 : 1}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); onSelect(); }
        if (e.key === ' ') { e.preventDefault(); onOpen(); }
      }}
    >
      {kind === 'workspace' || kind === 'conductor' ? (
        <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={3} transform="rotate(45)" fill={colour} fillOpacity={0.9} stroke={stroke} strokeWidth={selected ? 2.5 : 1.5} />
      ) : kind === 'knowledge' ? (
        <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={2} fill={colour} fillOpacity={0.85} stroke={stroke} strokeWidth={selected ? 2.5 : 1.5} />
      ) : (
        <circle r={r} fill={colour} fillOpacity={0.85} stroke={stroke} strokeWidth={selected ? 2.5 : 1.5} />
      )}
      <g ref={labelRef} data-r={kind === 'workspace' ? r * 1.45 : r} aria-hidden="true">
        {label ? (
          <text y={11} textAnchor="middle" fontSize={11} fill="var(--text-2)" className="pointer-events-none">{label}</text>
        ) : null}
      </g>
    </g>
  );
}

function NeighbourList({
  model, graph, selected, onSelect, onOpen, colourOf,
}: {
  model: MapModel;
  graph: GraphModel;
  selected: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  colourOf: (group: string) => string;
}): React.ReactElement {
  const root = (selected && graph.byId.get(selected)) || [...graph.nodes].sort((a, b) => b.degree - a.degree)[0]!;
  const neighbours = [...(graph.neighbours.get(root.id) ?? [])]
    .map((id) => graph.byId.get(id))
    .filter((n): n is GraphNode => Boolean(n));
  return (
    <div className="ac-card flex flex-col gap-2 p-3" data-graph-list>
      <div className="flex flex-wrap items-center gap-2">
        <span className="size-2 shrink-0 rounded-full" style={{ background: colourOf(root.group) }} />
        <span className="text-meta font-medium text-text-1">{root.title}</span>
        <span className="ac-mono text-nano text-text-4">{model.byId.get(root.id)?.kind}</span>
        <div className="flex-1" />
        <Button size="sm" variant="primary" onClick={() => onOpen(root.id)}>Open</Button>
      </div>
      <div className="ac-label">neighbours</div>
      {neighbours.length ? (
        <ul className="flex flex-col">
          {neighbours.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => onSelect(n.id)} className="flex w-full items-center gap-2 py-1.5 text-left text-micro text-text-2 hover:text-text-1">
                <span className="truncate">{n.title}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-micro text-text-4">Nothing links here yet.</span>
      )}
    </div>
  );
}
