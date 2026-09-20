/**
 * A `ThreadMessage`'s `card` parts, which carry a decision already pushed to the conversation
 * (VS-309). The web chat uses the part only to find the decision it names (`ref.id`); the decision
 * itself supplies the options, their descriptions and everything else the card renders.
 */
export interface DecisionCardAction {
  key: string;
  label: string;
  style?: 'primary' | 'danger' | 'default';
}

export interface DecisionCardPart {
  type: 'card';
  title: string;
  body: string;
  actions: DecisionCardAction[];
  ref: { kind: 'decision'; id: string };
}

function isDecisionCardPart(p: unknown): p is DecisionCardPart {
  if (typeof p !== 'object' || p === null) return false;
  const r = p as Record<string, unknown>;
  if (r.type !== 'card' || typeof r.title !== 'string' || typeof r.body !== 'string' || !Array.isArray(r.actions)) return false;
  if (typeof r.ref !== 'object' || r.ref === null) return false;
  const ref = r.ref as Record<string, unknown>;
  return ref.kind === 'decision' && typeof ref.id === 'string';
}

/** `ThreadMessage.parts` is opaque JSON (`unknown[]`) — this is the one place that trusts a card part. */
export function decisionCardPartsOf(parts: unknown[] | null | undefined): DecisionCardPart[] {
  return Array.isArray(parts) ? parts.filter(isDecisionCardPart) : [];
}

/**
 * VS-622: the card a planner publishes for a plan artifact. Unlike a decision card, whose `ref.id`
 * names a decision the web app fetches, this part carries everything the card needs — the plan and
 * key locate the artifact, the revision picks its bytes, and the title labels it. The HTML never
 * travels in the part; the open action frames the plan artifact's own sandboxed raw-serve route.
 */
export interface PlanArtifactCardPart {
  type: 'card';
  title: string;
  body: string;
  actions: DecisionCardAction[];
  ref: { kind: 'plan-artifact'; planId: string; key: string; revision: number };
}

function isPlanArtifactCardPart(p: unknown): p is PlanArtifactCardPart {
  if (typeof p !== 'object' || p === null) return false;
  const r = p as Record<string, unknown>;
  if (r.type !== 'card' || typeof r.title !== 'string' || typeof r.body !== 'string' || !Array.isArray(r.actions)) return false;
  if (typeof r.ref !== 'object' || r.ref === null) return false;
  const ref = r.ref as Record<string, unknown>;
  return ref.kind === 'plan-artifact' && typeof ref.planId === 'string' && typeof ref.key === 'string' && typeof ref.revision === 'number';
}

export function planArtifactCardPartsOf(parts: unknown[] | null | undefined): PlanArtifactCardPart[] {
  return Array.isArray(parts) ? parts.filter(isPlanArtifactCardPart) : [];
}
