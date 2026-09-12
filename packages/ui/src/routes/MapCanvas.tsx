/**
 * Instance Map canvas (VS-192): a radial tree lit like Gource — thin luminous edges, small
 * glowing nodes, continuous per-node drift, and a decorative beam for each live worker. See
 * openspec/changes/vs-192-rebuild-the-global-map-as-a-gource-style/design.md.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Agent } from '@weave-ai/shared';
import { ticketUiStatus } from '@weave-ai/shared';
import { Button } from '../components/Button';
import { EmptyState } from '../components/States';
import { cx } from '../lib/cx';
import { beamsFor, type Beam } from '../lib/map/beams';
import { driftOffset } from '../lib/map/drift';
import { declutterLabels, type LabelCandidate } from '../lib/map/labels';
import { filterKinds, type MapModel, type MapNode, type MapNodeKind } from '../lib/map/model';
import { layoutRadial, minSiblingGapByDepth, type RadialLayout } from '../lib/map/radial';
import { projectColorVar } from '../lib/projectColor';
import { STATUS_VAR } from '../lib/status';
import {
  boundsOf,
  fitTo,
  IDENTITY,
  midpoint,
  panBy,
  pinchScale,
  toGraph,
  toSvg,
  zoomAround,
  type Point,
  type Size,
  type ViewportTransform,
} from '../lib/graph/viewport';

const FALLBACK_SIZE: Size = { width: 900, height: 520 };
const CLICK_SLOP_PX = 4;
const SPRING_MS = 260;
const BEAM_LOOP_MS = 1400;
const BEAM_FADE_MS = 600;
const FONT_PX = 11;
const HALO_SCALE = 2.6;

const KIND_LABEL: Record<MapNodeKind, string> = {
  workspace: 'Workspace',
  project: 'Project',
  weaver: 'Weaver',
  role: 'Role',
  ticket: 'Ticket',
  knowledge: 'Knowledge',
};

const KINDS: MapNodeKind[] = ['workspace', 'project', 'weaver', 'role', 'ticket', 'knowledge'];

/** Core dot radius per kind, graph units — small, per the brief, not the old chip sizes. */
const CORE_RADIUS: Record<MapNodeKind, number> = {
  workspace: 10, project: 7, weaver: 7, role: 5, ticket: 3.5, knowledge: 3.5,
};

/** Label priority: lower wins when two labels would overlap (design.md §3). */
const LABEL_PRIORITY: Record<MapNodeKind, number> = {
  workspace: 0, project: 1, weaver: 1, role: 2, ticket: 3, knowledge: 3,
};

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

function truncate(title: string): string {
  return title.length > 26 ? `${title.slice(0, 24)}…` : title;
}

/** `var(--project-2)` -> `project-2`, `var(--status-blocked)` -> `status-blocked`: a defs id. */
function paletteKey(cssVar: string): string {
  return cssVar.replace(/^var\(--/, '').replace(/\)$/, '');
}

/** A node's hue: per-workspace/per-project identity for branch kinds, status for a ticket, and the parent's hue for anything hanging off one (design.md §5). */
function hueFor(node: MapNode, model: MapModel): string {
  switch (node.kind) {
    case 'workspace': {
      const siblings = model.nodes.filter((n) => n.kind === 'workspace').map((n) => n.workspaceId);
      return projectColorVar(node.workspaceId, siblings);
    }
    case 'project': {
      const siblings = model.nodes.filter((n) => n.kind === 'project' && n.workspaceId === node.workspaceId).map((n) => n.projectId!);
      return projectColorVar(node.projectId!, siblings);
    }
    case 'ticket':
      return STATUS_VAR[ticketUiStatus(node.ticketStatus ?? 'in_progress')];
    case 'weaver':
    case 'role':
    case 'knowledge':
    default: {
      if (node.projectId) {
        const project = model.byId.get(`project:${node.projectId}`);
        if (project) return hueFor(project, model);
      }
      const ws = model.byId.get(`workspace:${node.workspaceId}`);
      return ws ? hueFor(ws, model) : projectColorVar(node.workspaceId, []);
    }
  }
}

/** Branch nodes render darkened toward the background; leaves keep their hue at full strength. */
function coreFillFor(node: MapNode, hue: string): string {
  if (node.kind === 'ticket' || node.kind === 'knowledge') return hue;
  return `color-mix(in srgb, ${hue} 55%, var(--bg-0))`;
}

/**
 * Relative recency among siblings, for role and knowledge nodes only (design.md §5): the most
 * recently updated sibling glows at full strength, the oldest at a floor, everything else
 * interpolated. A lone child — nothing to be relatively brighter or dimmer than — glows at full.
 */
function computeGlowOpacity(model: MapModel): Map<string, number> {
  const out = new Map<string, number>();
  const groups = new Map<string, string[]>();
  for (const n of model.nodes) {
    if (n.kind !== 'role' && n.kind !== 'knowledge') continue;
    const parent = model.edges.find((e) => e.target === n.id)?.source;
    if (!parent) continue;
    const list = groups.get(parent) ?? [];
    list.push(n.id);
    groups.set(parent, list);
  }
  for (const ids of groups.values()) {
    const timed = ids
      .map((id) => ({ id, t: Date.parse(model.byId.get(id)?.updatedAt ?? '') }))
      .filter((x) => Number.isFinite(x.t));
    if (timed.length <= 1) {
      for (const id of ids) out.set(id, 1);
      continue;
    }
    const min = Math.min(...timed.map((x) => x.t));
    const max = Math.max(...timed.map((x) => x.t));
    for (const { id, t } of timed) out.set(id, max === min ? 1 : 0.35 + ((t - min) / (max - min)) * 0.65);
    for (const id of ids) if (!out.has(id)) out.set(id, 1);
  }
  return out;
}

/** The floor a workspace/project node's glow renders at when nothing in-flight sits under it. */
function activityOpacity(node: MapNode): number {
  return node.hasLiveActivity ? 1 : 0.55;
}

function glowOpacityFor(node: MapNode, recency: ReadonlyMap<string, number>): number {
  if (node.kind === 'workspace' || node.kind === 'project') return activityOpacity(node);
  if (node.kind === 'role' || node.kind === 'knowledge') return recency.get(node.id) ?? 1;
  return 1;
}

function lerp(a: number, b: number, p: number): number {
  return a + (b - a) * p;
}

function trimmedPath(sx: number, sy: number, sr: number, tx: number, ty: number, tr: number): string {
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const x1 = sx + ux * sr;
  const y1 = sy + uy * sr;
  const x2 = tx - ux * tr;
  const y2 = ty - uy * tr;
  return `M${round(x1)} ${round(y1)}L${round(x2)} ${round(y2)}`;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

interface Pos { x: number; y: number }

export function MapCanvas({
  model, onOpen, liveWorkers = [],
}: {
  model: MapModel;
  onOpen: (node: MapNode) => void;
  liveWorkers?: readonly Pick<Agent, 'id' | 'ticketId'>[];
}): React.ReactElement {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const phone = useMediaQuery('(max-width: 640px)');
  const animated = !reduced;

  const [hidden, setHidden] = useState<ReadonlySet<MapNodeKind>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [canvas, setCanvas] = useState(false);
  const [zoom, setZoom] = useState(IDENTITY.k);
  const [dyingBeams, setDyingBeams] = useState<ReadonlyMap<string, { beam: Beam; diedAt: number }>>(new Map());

  const filtered = useMemo(() => filterKinds(model, hidden), [model, hidden]);
  const layout = useMemo<RadialLayout>(() => layoutRadial(filtered), [filtered]);
  const gaps = useMemo(() => minSiblingGapByDepth(filtered, layout), [filtered, layout]);
  const recency = useMemo(() => computeGlowOpacity(filtered), [filtered]);
  const focus = hover ?? selected;

  const liveBeams = useMemo(() => beamsFor(liveWorkers, filtered), [liveWorkers, filtered]);
  const liveBeamIds = useMemo(() => new Set(liveBeams.map((b) => b.workerId)), [liveBeams]);
  const prevLiveRef = useRef(new Map<string, Beam>());
  useEffect(() => {
    const justDied: Beam[] = [];
    for (const [id, beam] of prevLiveRef.current) if (!liveBeamIds.has(id)) justDied.push(beam);
    if (justDied.length) {
      const diedAt = performance.now();
      setDyingBeams((prev) => {
        const next = new Map(prev);
        for (const beam of justDied) next.set(beam.workerId, { beam, diedAt });
        return next;
      });
      for (const beam of justDied) {
        const id = beam.workerId;
        setTimeout(() => setDyingBeams((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Map(prev);
          next.delete(id);
          return next;
        }), BEAM_FADE_MS + 50);
      }
    }
    setDyingBeams((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const id of prev.keys()) if (liveBeamIds.has(id)) { next.delete(id); changed = true; }
      return changed ? next : prev;
    });
    prevLiveRef.current = new Map(liveBeams.map((b) => [b.workerId, b]));
  }, [liveBeams, liveBeamIds]);
  const dyingBeamsRef = useRef(dyingBeams);
  useEffect(() => { dyingBeamsRef.current = dyingBeams; }, [dyingBeams]);
  const displayBeams = useMemo(() => {
    const out = [...liveBeams];
    for (const { beam } of dyingBeams.values()) if (!liveBeamIds.has(beam.workerId)) out.push(beam);
    return out;
  }, [liveBeams, dyingBeams, liveBeamIds]);

  const shownLabels = useMemo(() => {
    const candidates: LabelCandidate[] = [];
    for (const n of filtered.nodes) {
      const isLeaf = n.kind === 'ticket' || n.kind === 'knowledge';
      if (isLeaf && n.id !== hover && n.id !== selected && n.id !== draggingId) continue;
      const pos = layout.get(n.id);
      if (!pos) continue;
      candidates.push({ id: n.id, x: pos.x * zoom, y: pos.y * zoom, text: truncate(n.title), priority: LABEL_PRIORITY[n.kind] });
    }
    return declutterLabels(candidates, FONT_PX);
  }, [filtered, layout, zoom, hover, selected, draggingId]);

  const frameRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const sceneRef = useRef<SVGGElement>(null);
  const nodeRefs = useRef(new Map<string, SVGGElement>());
  const edgeHaloRefs = useRef(new Map<string, SVGPathElement>());
  const edgeWireRefs = useRef(new Map<string, SVGPathElement>());
  const beamRefs = useRef(new Map<string, SVGCircleElement>());
  const viewRef = useRef<ViewportTransform>(IDENTITY);
  const sizeRef = useRef<Size>(FALLBACK_SIZE);
  const autoFitRef = useRef(true);
  const overrideRef = useRef(new Map<string, Pos>());
  const springRef = useRef(new Map<string, { fromX: number; fromY: number; start: number }>());
  const positionsRef = useRef(new Map<string, Pos>());
  const rafRef = useRef<number | null>(null);

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
    if (zoomed) setZoom(next.k);
  }, []);

  const naturalPos = useCallback((id: string, depth: number, now: number): Pos => {
    const base = layout.get(id);
    if (!base) return { x: 0, y: 0 };
    if (!animated) return { x: base.x, y: base.y };
    const { dx, dy } = driftOffset(id, depth, now, gaps.get(depth));
    return { x: base.x + dx, y: base.y + dy };
  }, [layout, gaps, animated]);

  const positionOf = useCallback((id: string, depth: number, now: number): Pos => {
    const spring = springRef.current.get(id);
    if (spring) {
      const p = Math.min(1, (now - spring.start) / SPRING_MS);
      const eased = 1 - (1 - p) * (1 - p);
      const nat = naturalPos(id, depth, now);
      if (p >= 1) springRef.current.delete(id);
      return { x: lerp(spring.fromX, nat.x, eased), y: lerp(spring.fromY, nat.y, eased) };
    }
    const override = overrideRef.current.get(id);
    if (override) return override;
    return naturalPos(id, depth, now);
  }, [naturalPos]);

  const draw = useCallback((now: number): void => {
    for (const n of filtered.nodes) {
      const l = layout.get(n.id);
      if (!l) continue;
      const pos = positionOf(n.id, l.depth, now);
      positionsRef.current.set(n.id, pos);
      nodeRefs.current.get(n.id)?.setAttribute('transform', `translate(${round(pos.x)} ${round(pos.y)})`);
    }
    for (const e of filtered.edges) {
      const s = positionsRef.current.get(e.source);
      const t = positionsRef.current.get(e.target);
      if (!s || !t) continue;
      const sr = CORE_RADIUS[filtered.byId.get(e.source)?.kind ?? 'ticket'];
      const tr = CORE_RADIUS[filtered.byId.get(e.target)?.kind ?? 'ticket'];
      const d = trimmedPath(s.x, s.y, sr, t.x, t.y, tr);
      edgeHaloRefs.current.get(e.id)?.setAttribute('d', d);
      edgeWireRefs.current.get(e.id)?.setAttribute('d', d);
    }
    for (const beam of displayBeams) {
      const from = positionsRef.current.get(beam.from);
      const to = positionsRef.current.get(beam.to);
      const el = beamRefs.current.get(beam.workerId);
      if (!from || !to || !el) continue;
      const frac = (now % BEAM_LOOP_MS) / BEAM_LOOP_MS;
      const x = lerp(from.x, to.x, frac);
      const y = lerp(from.y, to.y, frac);
      el.setAttribute('transform', `translate(${round(x)} ${round(y)})`);
      const dying = dyingBeamsRef.current.get(beam.workerId);
      const opacity = dying ? Math.max(0, 1 - (now - dying.diedAt) / BEAM_FADE_MS) : 1;
      el.setAttribute('opacity', String(opacity));
    }
  }, [filtered, layout, positionOf, displayBeams]);

  useEffect(() => {
    draw(animated ? performance.now() : 0);
    if (!animated) return;
    const tick = (now: number): void => {
      draw(now);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [draw, animated]);

  useEffect(() => {
    // The frame only exists once the phone has switched from its list default to the canvas —
    // fitting against it beforehand would measure the unmounted frame's fallback size instead.
    if (!filtered.nodes.length || (phone && !canvas)) return;
    const size = measure();
    if (autoFitRef.current) {
      const bounds = boundsOf([...layout.values()]);
      if (bounds) applyView(fitTo(bounds, size));
    }
  }, [filtered, layout, applyView, measure, phone, canvas]);

  const fitView = useCallback((): void => {
    const bounds = boundsOf([...positionsRef.current.values()].length ? [...positionsRef.current.values()] : [...layout.values()]);
    autoFitRef.current = false;
    if (bounds) applyView(fitTo(bounds, measure()));
  }, [layout, measure, applyView]);

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
    if (nodeId) {
      overrideRef.current.set(nodeId, positionsRef.current.get(nodeId) ?? { x: 0, y: 0 });
      springRef.current.delete(nodeId);
      setDraggingId(nodeId);
    }
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
      overrideRef.current.set(gesture.nodeId, toGraph(viewRef.current, at));
    } else {
      applyView(panBy(viewRef.current, dx, dy));
    }
  };

  const endPointer = (e: React.PointerEvent<SVGSVGElement>): void => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    const gesture = gestureRef.current;
    if (gesture && gesture.pointerId === e.pointerId) {
      if (gesture.nodeId) {
        const dropped = overrideRef.current.get(gesture.nodeId);
        overrideRef.current.delete(gesture.nodeId);
        if (dropped) springRef.current.set(gesture.nodeId, { fromX: dropped.x, fromY: dropped.y, start: animated ? performance.now() : 0 });
      }
      setDraggingId(null);
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
  const gradientKeys = [...new Set(filtered.nodes.map((n) => paletteKey(hueFor(n, filtered))))];

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
        <NeighbourList model={filtered} selected={selected} onSelect={setSelected} onOpen={openNode} />
      ) : (
        <div ref={frameRef} className="ac-card relative overflow-hidden p-0" style={{ background: 'var(--bg-0)' }}>
          <svg
            ref={svgRef}
            className="h-[32rem] w-full touch-none select-none"
            aria-label="Instance map"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
          >
            <defs>
              {gradientKeys.map((key) => (
                <radialGradient key={key} id={`glow-${key}`}>
                  <stop offset="0%" stopColor={`var(--${key})`} stopOpacity={0.9} />
                  <stop offset="45%" stopColor={`var(--${key})`} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={`var(--${key})`} stopOpacity={0} />
                </radialGradient>
              ))}
            </defs>
            <g ref={sceneRef}>
              <g aria-hidden="true">
                {filtered.edges.map((e) => {
                  const dim = Boolean(focus) && e.source !== focus && e.target !== focus;
                  const s = layout.get(e.source);
                  const t = layout.get(e.target);
                  const sr = CORE_RADIUS[filtered.byId.get(e.source)?.kind ?? 'ticket'];
                  const tr = CORE_RADIUS[filtered.byId.get(e.target)?.kind ?? 'ticket'];
                  const d = s && t ? trimmedPath(s.x, s.y, sr, t.x, t.y, tr) : '';
                  return (
                    <g key={e.id} opacity={dim ? 0.2 : 1}>
                      <path
                        ref={(el) => { if (el) edgeHaloRefs.current.set(e.id, el); else edgeHaloRefs.current.delete(e.id); }}
                        d={d}
                        fill="none"
                        stroke="var(--accent)"
                        strokeOpacity={0.15}
                        strokeWidth={4}
                      />
                      <path
                        ref={(el) => { if (el) edgeWireRefs.current.set(e.id, el); else edgeWireRefs.current.delete(e.id); }}
                        d={d}
                        fill="none"
                        stroke="var(--accent-link)"
                        strokeWidth={1.1}
                        strokeOpacity={0.85}
                      />
                    </g>
                  );
                })}
              </g>
              <g aria-hidden="true">
                {displayBeams.map((beam) => (
                  <circle
                    key={beam.workerId}
                    ref={(el) => { if (el) beamRefs.current.set(beam.workerId, el); else beamRefs.current.delete(beam.workerId); }}
                    r={3}
                    fill="var(--text-1)"
                  />
                ))}
              </g>
              <g>
                {filtered.nodes.map((n) => {
                  const l = layout.get(n.id);
                  if (!l) return null;
                  const hue = hueFor(n, filtered);
                  return (
                    <MapNodeGlyph
                      key={n.id}
                      node={n}
                      x={l.x}
                      y={l.y}
                      hue={hue}
                      coreFill={coreFillFor(n, hue)}
                      glowOpacity={glowOpacityFor(n, recency)}
                      dimmed={Boolean(focus) && n.id !== focus && !filtered.neighbours.get(focus ?? '')?.has(n.id)}
                      selected={selected === n.id}
                      showLabel={shownLabels.has(n.id)}
                      label={truncate(n.title)}
                      nodeRef={(el) => { if (el) nodeRefs.current.set(n.id, el); else nodeRefs.current.delete(n.id); }}
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

function MapNodeGlyph({
  node, x, y, hue, coreFill, glowOpacity, dimmed, selected, showLabel, label, nodeRef, onEnter, onLeave, onSelect, onOpen,
}: {
  node: MapNode;
  x: number;
  y: number;
  hue: string;
  coreFill: string;
  glowOpacity: number;
  dimmed: boolean;
  selected: boolean;
  showLabel: boolean;
  label: string;
  nodeRef: (el: SVGGElement | null) => void;
  onEnter: () => void;
  onLeave: () => void;
  onSelect: () => void;
  onOpen: () => void;
}): React.ReactElement {
  const r = CORE_RADIUS[node.kind];
  const halo = r * HALO_SCALE;
  const stroke = selected ? 'var(--text-1)' : 'transparent';
  return (
    <g
      ref={nodeRef}
      data-node={node.id}
      data-kind={node.kind}
      role="button"
      tabIndex={0}
      aria-label={node.title}
      className="cursor-pointer"
      transform={`translate(${x} ${y})`}
      opacity={dimmed ? 0.25 : 1}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); onSelect(); }
        if (e.key === ' ') { e.preventDefault(); onOpen(); }
      }}
    >
      <circle r={halo} fill={`url(#glow-${paletteKey(hue)})`} opacity={glowOpacity} />
      <circle r={r} fill={coreFill} stroke={stroke} strokeWidth={selected ? 2 : 1} />
      {showLabel ? (
        <text y={-(halo + 4)} textAnchor="middle" fontSize={FONT_PX} fill="var(--text-2)" className="pointer-events-none select-none">
          {label}
        </text>
      ) : null}
    </g>
  );
}

function NeighbourList({
  model, selected, onSelect, onOpen,
}: {
  model: MapModel;
  selected: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
}): React.ReactElement {
  const root = (selected && model.byId.get(selected))
    || [...model.nodes].sort((a, b) => (model.neighbours.get(b.id)?.size ?? 0) - (model.neighbours.get(a.id)?.size ?? 0))[0]!;
  const neighbours = [...(model.neighbours.get(root.id) ?? [])]
    .map((id) => model.byId.get(id))
    .filter((n): n is MapNode => Boolean(n));
  return (
    <div className="ac-card flex flex-col gap-2 p-3" data-graph-list>
      <div className="flex flex-wrap items-center gap-2">
        <span className="size-2 shrink-0 rounded-full" style={{ background: hueFor(root, model) }} />
        <span className="text-meta font-medium text-text-1">{root.title}</span>
        <span className="ac-mono text-nano text-text-4">{root.kind}</span>
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
