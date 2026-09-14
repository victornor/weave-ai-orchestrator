/**
 * V2's Map canvas (VS-350): the worker graph drawn radially. It reuses V1's pure layout and
 * interaction primitives (`layoutRadial`, `declutterLabels`, `lib/graph/viewport` — pan, zoom, fit)
 * and restyles the nodes in Mono; the V1 ticket-centric canvas is untouched.
 */
import { useMemo, useRef, useState } from 'react';
import { agentUiStatus } from '@weave-ai/shared';
import { boundsOf, IDENTITY, panBy, toGraph, toSvg, zoomAround, type Point, type ViewportTransform } from '../../lib/graph/viewport';
import { declutterLabels, type LabelCandidate } from '../../lib/map/labels';
import type { MapModel, MapNode } from '../../lib/map/model';
import { layoutRadial } from '../../lib/map/radial';
import { projectColorVar } from '../../lib/projectColor';
import { STATUS_VAR } from '../../lib/status';

const CORE_RADIUS: Record<string, number> = { workspace: 11, project: 7, worker: 5 };
const LABEL_PRIORITY: Record<string, number> = { workspace: 0, project: 1, worker: 2 };
const PAD = 56;
const ZOOM_STEP = 1.25;

/** A node's hue: a worker carries its status, a project/workspace its identity colour. */
export function nodeHue(node: MapNode, model: MapModel): string {
  if (node.kind === 'worker') return STATUS_VAR[agentUiStatus(node.workerStatus ?? 'active')];
  if (node.kind === 'project') {
    const siblings = model.nodes.filter((n) => n.kind === 'project' && n.workspaceId === node.workspaceId).map((n) => n.projectId ?? '');
    return projectColorVar(node.projectId ?? node.id, siblings);
  }
  const siblings = model.nodes.filter((n) => n.kind === 'workspace').map((n) => n.workspaceId);
  return projectColorVar(node.workspaceId, siblings);
}

function truncate(text: string, n = 22): string {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

/**
 * The shape a node's kind owns (HANDOFF §13): a workspace is a circle, a project a square and a
 * worker a triangle. The colour is the node's own (a worker by status, a project/workspace by hue),
 * so the shape says the kind and the fill says the state.
 */
function NodeShape({ kind, r, hue }: { kind: MapNode['kind']; r: number; hue: string }): React.ReactElement {
  if (kind === 'project') return <rect x={-r} y={-r} width={r * 2} height={r * 2} fill={hue} />;
  if (kind === 'worker') return <polygon points={`0,${-r} ${r},${r} ${-r},${r}`} fill={hue} />;
  return <circle r={r} fill={hue} />;
}

export interface MapGraphProps {
  model: MapModel;
  onOpen: (node: MapNode) => void;
}

export function MapGraph({ model, onOpen }: MapGraphProps): React.ReactElement {
  const [view, setView] = useState<ViewportTransform>(IDENTITY);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const surface = useRef<HTMLDivElement>(null);

  const layout = useMemo(() => layoutRadial(model), [model]);
  const bounds = useMemo(() => boundsOf([...layout.values()].map((n) => ({ x: n.x, y: n.y }))), [layout]);

  // Centre the layout in a padded logical canvas, so the viewport transform has stable coordinates.
  const box = bounds ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const ox = PAD - box.minX;
  const oy = PAD - box.minY;
  const width = Math.max(1, box.maxX - box.minX) + PAD * 2;
  const height = Math.max(1, box.maxY - box.minY) + PAD * 2;
  const at = (id: string): Point | null => {
    const n = layout.get(id);
    return n ? { x: n.x + ox, y: n.y + oy } : null;
  };

  const shown = useMemo(() => {
    const candidates: LabelCandidate[] = model.nodes.map((n) => {
      const p = at(n.id);
      return {
        id: n.id,
        x: (p?.x ?? 0) * view.k + view.x,
        y: (p?.y ?? 0) * view.k + view.y,
        text: truncate(n.title),
        priority: LABEL_PRIORITY[n.kind] ?? 3,
      };
    });
    return declutterLabels(candidates);
  }, [model.nodes, layout, view, ox, oy]);

  /** Logical-canvas units per screen pixel, so a drag/wheel in pixels maps to the viewBox. */
  const unitScale = (): { sx: number; sy: number } => {
    const r = surface.current?.getBoundingClientRect();
    return { sx: r && r.width > 0 ? width / r.width : 1, sy: r && r.height > 0 ? height / r.height : 1 };
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    drag.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (!drag.current) return;
    const { sx, sy } = unitScale();
    const dx = (e.clientX - drag.current.x) * sx;
    const dy = (e.clientY - drag.current.y) * sy;
    drag.current = { x: e.clientX, y: e.clientY };
    setView((v) => panBy(v, dx, dy));
  };
  const endDrag = (): void => {
    drag.current = null;
  };
  const onWheel = (e: React.WheelEvent<SVGSVGElement>): void => {
    e.preventDefault();
    const { sx, sy } = unitScale();
    const r = surface.current?.getBoundingClientRect();
    const px = r ? (e.clientX - r.left) * sx : width / 2;
    const py = r ? (e.clientY - r.top) * sy : height / 2;
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    setView((v) => zoomAround(v, toGraph(v, { x: px, y: py }), factor));
  };

  return (
    <div ref={surface} className="relative min-h-0 flex-1" data-v2-map-canvas>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
        role="img"
        aria-label="Workspace, project and worker graph"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onWheel={onWheel}
      >
        <g data-v2-map-transform transform={toSvg(view)}>
          {model.edges.map((e) => {
            const a = at(e.source);
            const b = at(e.target);
            if (!a || !b) return null;
            return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--line-2)" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
          })}
          {model.nodes.map((n) => {
            const p = at(n.id);
            if (!p) return null;
            const hue = nodeHue(n, model);
            const r = CORE_RADIUS[n.kind] ?? 5;
            const label = shown.has(n.id) ? n.title : null;
            return (
              <g
                key={n.id}
                data-node={n.id}
                data-kind={n.kind}
                role="button"
                tabIndex={0}
                transform={`translate(${p.x} ${p.y})`}
                className="cursor-pointer"
                onClick={() => onOpen(n)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen(n);
                  }
                }}
              >
                <NodeShape kind={n.kind} r={r} hue={hue} />
                {label ? (
                  <text x={0} y={-r - 5} textAnchor="middle" fontSize={11} fill="var(--text-1)" style={{ pointerEvents: 'none' }}>
                    {truncate(label)}
                  </text>
                ) : null}
                <title>{n.kind === 'worker' ? `${n.title} · ${n.workerStatus ?? 'worker'}` : `${n.kind} · ${n.title}`}</title>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-r4 border border-line-1 bg-bg-2 p-0.5">
        <button type="button" aria-label="Zoom out" onClick={() => setView((v) => zoomAround(v, { x: width / 2, y: height / 2 }, 1 / ZOOM_STEP))} className="px-1.5 text-text-3 hover:text-text-1">
          −
        </button>
        <button type="button" aria-label="Zoom in" onClick={() => setView((v) => zoomAround(v, { x: width / 2, y: height / 2 }, ZOOM_STEP))} className="px-1.5 text-text-3 hover:text-text-1">
          +
        </button>
        <button type="button" aria-label="Reset view" onClick={() => setView(IDENTITY)} className="ac-mono px-1.5 text-nano text-text-3 hover:text-text-1">
          fit
        </button>
      </div>
    </div>
  );
}
