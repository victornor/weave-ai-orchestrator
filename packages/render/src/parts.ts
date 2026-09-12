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
