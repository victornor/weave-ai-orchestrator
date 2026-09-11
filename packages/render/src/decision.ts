/**
 * `decisionToCard` — one decision, one card (design contract §4). The variant decides the body and
 * the buttons; the TUI numbers the options and the web renders them as buttons, but the model is
 * identical so the two never drift.
 */
import type { Decision } from '@agent-conductor/shared';
import { conductorReviewCopy, decisionUiStatus } from '@agent-conductor/shared';
import { formatAge, formatDiffStat, joinMeta, oneLine } from './format.js';

/** What a decision belonging to no project is called, on every surface. */
export const WORKSPACE_LABEL = 'Workspace';
import { redact } from './redact.js';
import type { CardBodyLine, CardModel, CardOption, CardVariant } from './types.js';

export interface DecisionCardContext {
  /** `ACME-42` — the card subtitle reads `ACME-42 · api`. */
  ticketIdentifier?: string | null;
  projectName?: string | null;
  now?: Date;
}

type RawOption = { key: string; label: string; description?: string; recommended?: boolean };

const VARIANTS: Record<string, CardVariant> = {
  plan_approval: 'plan_approval',
  action_approval: 'action_approval',
  merge_approval: 'merge_approval',
  hire_approval: 'hire_approval',
  discard_approval: 'discard_approval',
  question: 'question',
  concern: 'concern',
  approval: 'approval',
  gate_finding: 'gate_finding',
  retry_approval: 'approval',
};

const DEFAULTS: Record<CardVariant, CardOption[]> = {
  plan_approval: [
    opt('approve', 'Approve', 'primary', 'The worker starts implementing the plan.'),
    opt('revise', 'Revise…', 'default', 'Send the plan back with a note; the composer opens pre-scoped to it.'),
    opt('reject', 'Reject', 'default', 'Drop the plan; the ticket goes back to the conductor.'),
  ],
  action_approval: [
    opt('approve', 'Approve', 'primary', 'The worker runs the stated action.'),
    opt('revise', 'Revise…', 'default', 'Send the action back with a note; the composer opens pre-scoped to it.'),
    opt('reject', 'Reject', 'default', 'Cancel the ticket; the action does not run.'),
  ],
  merge_approval: [
    opt('approve', 'Approve merge', 'primary', 'Merge the pull request and archive the change.'),
    opt('changes', 'Request changes', 'default', 'Send it back to the worker.'),
  ],
  hire_approval: [
    opt('approve', 'Hire', 'primary', 'Create the role and let it pick up tickets.'),
    opt('reject', 'Reject', 'default', 'Do not create the role.'),
  ],
  discard_approval: [
    opt('approve', 'Discard', 'danger', 'Destroys the worktree and any uncommitted work.'),
    opt('reject', 'Keep', 'default', 'Leave the worktree alone.'),
  ],
  approval: [opt('approve', 'Approve', 'primary', null), opt('reject', 'Reject', 'default', null)],
  gate_finding: [opt('acknowledge', 'Acknowledge', 'primary', null), opt('ignore', 'Ignore', 'default', null)],
  question: [],
  concern: [],
};

function opt(key: string, label: string, tone: CardOption['tone'], consequence: string | null): CardOption {
  return { key, label, description: null, recommended: false, tone, consequence };
}

export function decisionToCard(decision: Decision, ctx: DecisionCardContext = {}): CardModel {
  const d = decision ?? ({} as Decision);
  const variant = VARIANTS[d.kind as string] ?? 'approval';
  const target = (d.target ?? {}) as Record<string, unknown>;
  const provided: RawOption[] = Array.isArray(d.options) ? d.options.filter((o) => o && typeof o.key === 'string') : [];

  const freeform = variant === 'question' || variant === 'concern';
  const options = freeform ? questionOptions(provided) : mergeOptions(DEFAULTS[variant], provided, variant);
  const destructive = variant === 'discard_approval';
  const allowFreeText = typeof d.allowFreeText === 'boolean' ? d.allowFreeText : freeform || variant === 'plan_approval' || variant === 'action_approval';

  const identifier = ctx.ticketIdentifier ?? tstr(target, 'ticketIdentifier', 'identifier') ?? d.ticketId ?? null;
  // Always a project chunk (VS-92): a card with no label reads as one whose project is unknown, and
  // the two mean very different things when four projects are asking at once.
  const project = ctx.projectName ?? tstr(target, 'projectName', 'project') ?? WORKSPACE_LABEL;
  const subtitle = joinMeta(identifier, project) || null;
  // A card asking for values is not answerable here: no channel can take a secret without putting
  // it in a message, and none has a control for a multi-select.
  const answerElsewhere = Array.isArray(d.inputs) && d.inputs.length > 0 && d.status === 'open';

  const card: CardModel = {
    id: d.id ?? '',
    kind: d.kind,
    variant,
    header: d.owner === 'conductor' ? 'Conductor decides' : 'Needs you',
    title: oneLine(redact(d.title ?? ''), 160) || 'Decision',
    subtitle,
    rationale: rationale(d),
    body: body(variant, d, target),
    options,
    allowFreeText,
    freeTextLabel: allowFreeText ? (freeform ? 'Something else…' : 'Add a note…') : null,
    confirm: destructive
      ? { expect: identifier ?? d.ticketId ?? d.id, prompt: `Type ${identifier ?? d.ticketId ?? d.id} to confirm` }
      : null,
    destructive,
    status: d.status,
    uiStatus: decisionUiStatus(d.status),
    ticketId: d.ticketId ?? null,
    createdAt: d.createdAt ?? '',
    age: formatAge(d.createdAt, ctx.now ?? new Date()),
    answer: d.status === 'answered' ? { key: d.answerKey ?? null, text: d.answerText ? redact(d.answerText) : null, at: d.answeredAt ?? null } : null,
    answerElsewhere,
  };
  if (answerElsewhere) {
    // No options either: offering buttons that cannot carry the values would answer the decision
    // with half of what it asked for.
    card.options = [];
    card.allowFreeText = false;
    card.freeTextLabel = null;
    card.body = [...card.body, { label: null, value: `Answer this in the web app: it asks for ${d.inputs.length} value${d.inputs.length === 1 ? '' : 's'}.`, format: 'text' }];
  }
  return card;
}

/** Recommended first, everything else in the order the agent gave it, free text last (rendered separately). */
function questionOptions(provided: RawOption[]): CardOption[] {
  const mapped = provided.map((o, i) => ({
    key: o.key,
    label: oneLine(redact(o.label ?? o.key), 80) || o.key,
    description: o.description ? oneLine(redact(o.description), 120) : null,
    recommended: o.recommended === true,
    tone: (o.recommended === true ? 'primary' : 'default') as CardOption['tone'],
    consequence: o.description ? oneLine(redact(o.description), 120) : null,
    _i: i,
  }));
  mapped.sort((a, b) => (a.recommended === b.recommended ? a._i - b._i : a.recommended ? -1 : 1));
  return mapped.map(({ _i, ...rest }) => rest);
}

/** Variant defaults win on order and tone; server-provided labels/descriptions win on wording. */
function mergeOptions(defaults: CardOption[], provided: RawOption[], variant: CardVariant): CardOption[] {
  const byKey = new Map(provided.map((o) => [o.key, o]));
  const out: CardOption[] = defaults.map((def) => {
    const p = byKey.get(def.key);
    byKey.delete(def.key);
    if (!p) return { ...def };
    return {
      ...def,
      label: oneLine(redact(p.label ?? def.label), 80) || def.label,
      description: p.description ? oneLine(redact(p.description), 120) : def.description,
      recommended: p.recommended === true,
    };
  });
  for (const extra of byKey.values()) {
    out.push({
      key: extra.key,
      label: oneLine(redact(extra.label ?? extra.key), 80) || extra.key,
      description: extra.description ? oneLine(redact(extra.description), 120) : null,
      recommended: extra.recommended === true,
      // `Switch runtime` on a hire card is an alternative, never the primary action.
      tone: variant === 'discard_approval' ? 'default' : 'default',
      consequence: extra.description ? oneLine(redact(extra.description), 120) : null,
    });
  }
  return out;
}

function rationale(d: Decision): string | null {
  const rec = d.recommendation ? `Recommended: ${oneLine(redact(d.recommendation), 140)}` : null;
  if (rec) return rec;
  const ctx = d.context ? oneLine(redact(d.context), 140) : null;
  return ctx;
}

function body(variant: CardVariant, d: Decision, target: Record<string, unknown>): CardBodyLine[] {
  const lines: CardBodyLine[] = [];
  const push = (label: string | null, value: string | null | undefined, format: CardBodyLine['format'] = 'text') => {
    if (value === null || value === undefined || value === '') return;
    lines.push({ label, value, format });
  };

  switch (variant) {
    case 'merge_approval': {
      push('PR', tstr(target, 'prUrl', 'url', 'pullRequestUrl'), 'link');
      const passed = tnum(target, 'ciPassed', 'checksPassed');
      const total = tnum(target, 'ciTotal', 'checksTotal');
      if (passed !== null || total !== null) push('CI', `${passed ?? 0}/${total ?? passed ?? 0}`, 'mono');
      else push('CI', tstr(target, 'ciState', 'ci'), 'mono');
      const stat = formatDiffStat(tnum(target, 'additions'), tnum(target, 'deletions'));
      push('Diff', stat, 'diff');
      const files = tnum(target, 'files', 'filesChanged');
      push('Files', files !== null ? `${files} file${files === 1 ? '' : 's'}` : null, 'mono');
      push('Branch', tstr(target, 'branch'), 'mono');
      break;
    }
    case 'hire_approval': {
      push(null, joinMeta(tstr(target, 'roleName', 'name'), tstr(target, 'projectName', 'project')) || null);
      push('Charter', tstr(target, 'charterSummary', 'charter') ? oneLine(redact(tstr(target, 'charterSummary', 'charter')!), 200) : null);
      push('Runtime', joinMeta(tstr(target, 'runtime', 'runtimeId'), tstr(target, 'model')) || null, 'mono');
      break;
    }
    case 'plan_approval': {
      push('Change', tstr(target, 'changeName', 'change'), 'mono');
      const tasks = tnum(target, 'taskCount', 'tasks');
      push('Tasks', tasks !== null ? String(tasks) : null, 'mono');
      const plan = tstr(target, 'plan', 'summary');
      if (plan) push(null, oneLine(redact(plan), 400));
      break;
    }
    case 'action_approval': {
      push('Document', tstr(target, 'documentId'), 'mono');
      const revision = tnum(target, 'revision');
      push('Revision', revision !== null ? String(revision) : null, 'mono');
      break;
    }
    case 'discard_approval': {
      push('Worktree', tstr(target, 'worktreePath', 'path'), 'mono');
      push('Uncommitted', tstr(target, 'dirtyFiles') ?? (tnum(target, 'dirtyFiles') !== null ? String(tnum(target, 'dirtyFiles')) : null), 'mono');
      push('Branch', tstr(target, 'branch'), 'mono');
      push(null, 'This destroys the worktree and any uncommitted work.');
      break;
    }
    default:
      break;
  }

  if (d.context && !lines.some((l) => l.value === oneLine(redact(d.context), 140))) {
    const ctx = redact(d.context).trim();
    // 1200, not 600: now that core no longer pre-cuts a failure message at 400 chars (VS-201), this
    // cap is the binding one for the TUI — raised enough that it isn't the tightest link in the
    // chain, while staying a static, non-paging card. oneLine's own ellipsis remains the marker.
    if (ctx && ctx !== rationale(d)) push(null, oneLine(ctx, 1200));
  }

  const review = conductorReviewCopy(d);
  if (review) {
    push('Review', review.line);
    if (review.note) push(null, review.note);
  }
  return lines;
}

function tstr(o: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}
function tnum(o: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}
