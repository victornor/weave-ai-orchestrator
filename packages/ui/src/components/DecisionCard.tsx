import { useState } from 'react';
import { NAMED_CARD_OPTION_KEYS, weaverReviewCopy, documentTarget } from '@agent-conductor/shared';
import type { Decision, DecisionAnswerInputs, DecisionInput, UiStatus } from '@agent-conductor/shared';
import { A } from '../app/link';
import { Button } from './Button';
import { Composer } from './Composer';
import { DocumentPreview } from './DocumentPreview';
import { HandoverCommand } from './HandoverCommand';
import { Markdown } from './Markdown';
import { StatusGlyph } from './StatusGlyph';
import { useHandoverCommandFor, useStartHandoverFor } from '../api/hooks';
import { useToast } from './Toast';
import { clock } from '../lib/format';
import { cx } from '../lib/cx';

export interface DecisionCardProps {
  decision: Decision;
  ticketIdentifier?: string | null;
  projectSlug?: string | null;
  /** The workspace slug — needed to link a merge-approval card to its ticket's conversation (VS-106) and to its pull request's diff (VS-107). */
  ws?: string | null;
  askedBy?: string | null;
  /** Who raised a question: the weaver asking the human reads differently from a worker asking. */
  asker?: 'weaver' | 'worker';
  busy?: boolean;
  queued?: boolean;
  /** The plan under approval, rendered above the buttons on a `plan_approval` card. */
  plan?: React.ReactNode;
  /**
   * YOLO mode will grant this decision, so it is not the human's to approve: the card says so and
   * offers no approve action. Only ever true for a plan or merge approval (see lib/yolo.ts).
   */
  autoApproving?: boolean;
  /**
   * Take this card off the surface it is pinned to without answering it (VS-72). Only the
   * conductor chat passes one; a card that is a record rather than a prompt never offers it.
   */
  onHide?: () => void;
  /** VS-146: the ticket was filed by the conductor, not the human. Chat only. */
  ticketFiledByConductor?: boolean;
  /** VS-146: one-line why, shown on plan_approval cards when the ticket has one. Chat only. */
  ticketSummary?: string | null;
  /** VS-146: tighter padding and button chrome. Chat only; Needs you stays at the default. */
  compact?: boolean;
  onAnswer: (answer: { key?: string; text?: string; remember?: boolean; inputs?: DecisionAnswerInputs; overrideHold?: boolean; overrideReason?: string }) => void;
  className?: string;
}

interface Target {
  tasks?: Array<{ text: string; files?: string }>;
  summary?: string;
  prUrl?: string;
  prNumber?: number;
  ci?: { passed: number; total: number; state?: string };
  additions?: number;
  deletions?: number;
  files?: number;
  runtime?: string;
  model?: string;
  roleName?: string;
  scope?: string;
  worktreePath?: string;
  confirm?: string;
  /** The document a decision target can point at (VS-224); typed for reference — rendering goes through `documentTarget`. */
  documentId?: string;
  revision?: number;
}

/** Decisions with a purpose-built body and buttons; everything else takes the option-list path. */
const NAMED_VARIANTS = ['plan_approval', 'merge_approval', 'hire_approval', 'discard_approval', 'action_approval'];

const HEAD: Record<string, { label: string; status: UiStatus }> = {
  plan_approval: { label: 'Plan approval', status: 'needs-you' },
  action_approval: { label: 'Action approval', status: 'needs-you' },
  merge_approval: { label: 'Merge approval', status: 'merging' },
  hire_approval: { label: 'Hire approval', status: 'needs-you' },
  discard_approval: { label: 'Discard worktree', status: 'failed' },
  question: { label: 'Worker question', status: 'blocked' },
  concern: { label: 'Worker needs help', status: 'blocked' },
  gate_finding: { label: 'Gate finding', status: 'blocked' },
  approval: { label: 'Needs you', status: 'needs-you' },
  retry_approval: { label: 'Worker stopped', status: 'failed' },
};

const HEAD_TEXT: Partial<Record<UiStatus, string>> = {
  'needs-you': 'text-needs-you',
  merging: 'text-merging',
  failed: 'text-failed',
  blocked: 'text-blocked',
  done: 'text-done',
};

/** VS-223: three states, three visible renderings. Quiet means dimmer type, not missing type. */
export function ConductorReviewLine({ decision }: { decision: Decision }): React.ReactElement | null {
  const copy = weaverReviewCopy(decision);
  if (!copy) return null;
  const toneClass = copy.tone === 'looked' || copy.tone === 'after' ? 'text-text-3' : 'text-blocked';
  return (
    <div className="mb-2" data-weaver-review={copy.tone}>
      <p className={cx('text-micro', copy.tone === 'concerns' ? 'font-medium' : null, toneClass)}>{copy.line}</p>
      {copy.note ? <p className="mt-1 whitespace-pre-wrap text-meta text-text-1">{copy.note}</p> : null}
      {/* VS-266: in addition to the concern line and note, not a replacement for either. */}
      {copy.held ? <p className="mt-1 text-micro font-medium text-blocked">Approval is held until this is revised, or you override it.</p> : null}
    </div>
  );
}

function statusLabel(status: Decision['status']): string {
  return status === 'withdrawn' ? 'Withdrawn' : status === 'expired' ? 'Expired' : status === 'superseded' ? 'Superseded' : 'Closed';
}

const isEmpty = (v: string | string[] | undefined): boolean => v === undefined || (typeof v === 'string' ? v.trim() === '' : v.length === 0);

/**
 * One control per input (VS-92), in the order the asker gave them. A `secret` is a password field:
 * its value is never rendered back, is submitted straight to the daemon, and is registered under
 * the asker's `secretName` rather than becoming the answer.
 */
function InputControl({ input, value, disabled, onChange }: {
  input: DecisionInput; value: string | string[] | undefined; disabled?: boolean; onChange: (v: string | string[]) => void;
}): React.ReactElement {
  const id = `dc-input-${input.key}`;
  const field = 'w-full rounded-r6 border border-line-2 bg-bg-input px-3 text-meta text-text-1 outline-none placeholder:text-text-4 focus:border-accent-edge';
  const chosen = Array.isArray(value) ? value : [];
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={input.type === 'multiselect' ? undefined : id} className="text-micro font-medium text-text-2">
        {input.label}
        {input.required ? <span className="ml-1 text-needs-you" aria-hidden>*</span> : null}
      </label>
      {input.type === 'multiline' ? (
        <textarea
          id={id} rows={3} disabled={disabled} value={typeof value === 'string' ? value : ''}
          placeholder={input.placeholder} aria-required={input.required}
          onChange={(e) => onChange(e.target.value)} className={cx(field, 'resize-y py-2')}
        />
      ) : input.type === 'multiselect' ? (
        <div role="group" aria-label={input.label} className="flex flex-wrap gap-1.5">
          {(input.choices ?? []).map((c) => {
            const on = chosen.includes(c.key);
            return (
              <button
                key={c.key} type="button" role="checkbox" aria-checked={on} disabled={disabled}
                title={c.description}
                onClick={() => onChange(on ? chosen.filter((k) => k !== c.key) : [...chosen, c.key])}
                className={cx(
                  'rounded-pill border px-3 py-1.5 text-micro transition-colors duration-(--dur-fast) ease-ac',
                  on ? 'border-accent bg-accent-tint text-text-strong' : 'border-line-2 text-text-2 hover:bg-bg-2',
                )}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      ) : (
        <input
          id={id} type={input.type === 'secret' ? 'password' : 'text'} disabled={disabled}
          value={typeof value === 'string' ? value : ''} placeholder={input.placeholder} aria-required={input.required}
          autoComplete={input.type === 'secret' ? 'off' : undefined}
          onChange={(e) => onChange(e.target.value)} className={cx(field, 'h-9')}
        />
      )}
      {input.type === 'secret' ? (
        <p className="text-nano text-text-4">
          Stored as <span className="ac-mono">{input.secretName}</span> and never shown again — it does not go into the chat or the ticket.
        </p>
      ) : null}
    </div>
  );
}

/** What an answered card shows in place of its controls: a secret is the name it was stored under. */
function answeredInputs(decision: Decision): Array<{ label: string; value: string }> {
  const given = decision.answerInputs ?? {};
  return (decision.inputs ?? [])
    .filter((i) => given[i.key] !== undefined)
    .map((i) => {
      const v = given[i.key]!;
      if (i.type === 'multiselect') {
        const labels = (Array.isArray(v) ? v : [v]).map((k) => i.choices?.find((c) => c.key === k)?.label ?? k);
        return { label: i.label, value: labels.join(', ') };
      }
      // Never the value: what was recorded for a secret is the name it went into.
      if (i.type === 'secret') return { label: i.label, value: `stored as ${String(v)}` };
      return { label: i.label, value: String(v) };
    });
}

/** What was answered, in the words the human would recognise: the option's label, else its key. */
function answerLine(decision: Decision): string | null {
  const chosen = decision.answerKey ? (decision.options.find((o) => o.key === decision.answerKey)?.label ?? decision.answerKey) : null;
  const text = decision.answerText?.trim() || null;
  if (chosen && text) return `${chosen} — ${text}`;
  return chosen ?? text;
}

/** Above this, a decision's context collapses behind a "Show full text" control (VS-201). */
const CONTEXT_PREVIEW_CHARS = 500;

/**
 * One decision per card. Header says what it is, the body is per variant, the
 * primary action sits bottom-left inside a 44 px thumb band. A decision that has
 * been answered renders the same card as an inert record of what was decided.
 */
export function DecisionCard({ decision, ticketIdentifier, projectSlug, ws, askedBy, asker, busy, queued, plan, autoApproving, onHide, ticketFiledByConductor, ticketSummary, compact, onAnswer, className }: DecisionCardProps): React.ReactElement {
  const [revising, setRevising] = useState(false);
  const [overriding, setOverriding] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [freeText, setFreeText] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [values, setValues] = useState<DecisionAnswerInputs>({});
  // A long context (a failure's full runtime message, say) stays bounded until asked for in full
  // (VS-201) — never clipped by CSS, which can cut mid-word with no way to tell from outside.
  const [contextExpanded, setContextExpanded] = useState(false);
  // VS-249: "I need to do this myself" — offered on any open card raised for a worker agent, so a
  // human deciding this from the card does not have to navigate to the worker first. Fetched only
  // once asked for, not eagerly on every rendered card.
  const [sessionOpen, setSessionOpen] = useState(false);
  const toast = useToast();
  const handoverCommand = useHandoverCommandFor(ws ?? '', askedBy ?? '', sessionOpen);
  const startHandover = useStartHandoverFor();
  const target = (decision.target ?? {}) as Target;
  // The document a decision target points at (VS-224), parsed from the untyped record: the
  // rendering is driven by this, never by the decision's kind.
  const docTarget = documentTarget(decision);
  const inputs = decision.inputs ?? [];
  const destructive = decision.kind === 'discard_approval';
  // A decision belonging to no project is the workspace's, and says so: an absent label and one that
  // simply could not be resolved must not look the same when four projects are asking at once (VS-92).
  const meta = [ticketIdentifier, projectSlug ?? 'Workspace', askedBy].filter(Boolean).join(' · ');
  // A decision that is no longer open cannot be answered again; it is a record, not a prompt.
  const answered = decision.status === 'answered';
  const inert = decision.status !== 'open';
  const optionList = !NAMED_VARIANTS.includes(decision.kind) && decision.options.length > 0;
  const auto = !inert && autoApproving === true && (decision.kind === 'plan_approval' || decision.kind === 'merge_approval');
  const head = inert
    ? { label: answered ? 'Answered' : statusLabel(decision.status), status: (answered ? 'done' : 'blocked') as UiStatus }
    : decision.kind === 'question' && asker === 'weaver'
      ? { label: 'Weaver asks', status: 'needs-you' as UiStatus }
      : (HEAD[decision.kind] ?? HEAD['approval']!);

  // Every required input filled is what unlocks the send; the card names the first one still missing
  // rather than leaving a disabled button with no explanation.
  const missing = inputs.filter((i) => i.required && isEmpty(values[i.key]));
  const collected = (): DecisionAnswerInputs => {
    const out: DecisionAnswerInputs = {};
    // An optional input left empty is absent, never present and empty — the same rule the daemon applies.
    for (const i of inputs) if (!isEmpty(values[i.key])) out[i.key] = values[i.key]!;
    return out;
  };
  const withInputs = (a: { key?: string; text?: string }): { key?: string; text?: string; inputs?: DecisionAnswerInputs } =>
    inputs.length ? { ...a, inputs: collected() } : a;

  const answer = (key: string, text?: string): void => onAnswer(withInputs(text === undefined ? { key } : { key, text }));
  // VS-266: the weaver has concerns on this open decision — its approving option is refused
  // server-side without a deliberate override, so the button reflects the rule rather than being it.
  const held = weaverReviewCopy(decision)?.held ?? false;
  const why = decision.kind === 'plan_approval' ? ticketSummary?.trim() : '';
  const section = compact ? 'mb-2' : 'mb-3';
  // The plan itself, so nothing is approved unread. Doubles as the document-preview suppression
  // (VS-224): plan approvals carry a document target too, and their plan is already on screen
  // here — a document never renders twice on one card. The general preview consults this slot
  // rather than the kind, so the next purpose-built slot suppresses it the same way.
  const planSlot = decision.kind === 'plan_approval' && !inert ? plan : null;

  return (
    <article
      className={cx('overflow-hidden rounded-r8 border bg-bg-1', destructive ? 'border-failed/35' : 'border-line-2', className)}
      aria-label={`${head.label}: ${decision.title}`}
    >
      <div className={cx('flex items-center gap-2 border-b border-line-1', compact ? 'px-3 py-2' : 'px-3.5 py-2.5')}>
        <StatusGlyph status={head.status} size="sm" />
        <span className={cx('text-meta font-medium', HEAD_TEXT[head.status] ?? 'text-blocked')}>
          {!inert && decision.kind === 'plan_approval' ? 'Needs you' : head.label}
        </span>
        <div className="flex-1" />
        {/* Both, not one or the other: the PR link used to take the meta line's place, which hid the
            project on a merge approval — the card where knowing the repository matters most. */}
        {target.prUrl ? (
          <a className="ac-mono text-micro" href={target.prUrl} target="_blank" rel="noreferrer">
            PR {target.prNumber ? `#${target.prNumber}` : ''} ↗
          </a>
        ) : null}
        {/* The explorer, in place, rather than the forge (VS-107) — absent when there is no pull
            request to show, or nowhere to route it to. */}
        {decision.kind === 'merge_approval' && target.prNumber != null && ws && projectSlug ? (
          <A to="/w/$ws/p/$project" params={{ ws, project: projectSlug }} search={{ pr: target.prNumber }} className="ac-mono text-micro text-accent-link">
            Show PR
          </A>
        ) : null}
        {ticketFiledByConductor ? (
          <span className="ac-mono rounded-r4 border border-line-2 px-1.5 py-0.5 text-nano tracking-micro text-text-3">
            Filed by conductor
          </span>
        ) : null}
        {meta ? <span className="ac-mono text-micro text-text-3">{meta}</span> : null}
      </div>

      <div className={compact ? 'p-3' : 'p-3.5'}>
        <h3 className={cx(compact ? 'mb-1' : 'mb-1.5', 'text-head font-semibold leading-snug tracking-head text-text-strong')}>{decision.title}</h3>
        {why ? <p className={cx(section, 'text-meta leading-snug text-text-2')}>{why}</p> : null}
        {decision.context && decision.context.length > CONTEXT_PREVIEW_CHARS ? (
          <div className={section}>
            <Markdown
              source={contextExpanded ? decision.context : `${decision.context.slice(0, CONTEXT_PREVIEW_CHARS)}…`}
              className="text-meta leading-relaxed text-text-2"
            />
            <button
              type="button"
              aria-expanded={contextExpanded}
              onClick={() => setContextExpanded((v) => !v)}
              className="ac-mono mt-1.5 text-micro text-accent-link"
            >
              {contextExpanded ? 'Show less' : 'Show full text'}
            </button>
          </div>
        ) : decision.context ? (
          <Markdown source={decision.context} className={cx(section, 'text-meta leading-relaxed text-text-2')} />
        ) : null}

        {/* plan approval — the proposal's task list */}
        {target.tasks?.length ? (
          <ul className={cx(section, 'flex flex-col gap-1.5 rounded-r6 border border-line-1 bg-bg-2 p-3')}>
            {target.tasks.map((t, i) => (
              <li key={i} className={cx('flex items-start', compact ? 'gap-2' : 'gap-2.5')}>
                <span className="mt-0.5 size-3 flex-none rounded-r4 border border-line-3" aria-hidden />
                <span className="flex-1 text-meta leading-snug text-text-soft">{t.text}</span>
                {t.files ? <span className="ac-mono text-micro text-text-4">{t.files}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}

        {/* plan approval — the plan itself, so nothing is approved unread */}
        {planSlot}

        {/* the document a decision target points at (VS-224) — any kind whose card does not already
            render it through a purpose-built slot */}
        {docTarget && !planSlot ? <DocumentPreview decision={decision} /> : null}

        {/* merge approval — CI and diff stats */}
        {decision.kind === 'merge_approval' ? (
          <div className={cx('ac-mono flex flex-wrap items-center gap-3.5 text-micro', section)}>
            {target.ci ? (
              <span className={cx('flex items-center gap-1.5', target.ci.passed === target.ci.total ? 'text-done' : 'text-working')}>
                <span className="size-2 rounded-pill bg-current" />
                CI {target.ci.passed === target.ci.total ? 'green' : target.ci.state ?? 'pending'} {target.ci.passed}/{target.ci.total}
              </span>
            ) : null}
            {target.additions != null ? <span className="text-done">+{target.additions}</span> : null}
            {target.deletions != null ? <span className="text-failed">−{target.deletions}</span> : null}
            {target.files != null ? <span className="text-text-3">{target.files} files</span> : null}
          </div>
        ) : null}

        {/* hire approval — runtime and model */}
        {decision.kind === 'hire_approval' && (target.runtime || target.model) ? (
          <div className={cx(section, 'flex items-center gap-2 rounded-r6 border border-line-1 bg-bg-2 px-3 py-2')}>
            <span className="ac-mono text-micro text-text-soft">
              {target.runtime}
              {target.model ? ` · ${target.model}` : ''}
            </span>
            <div className="flex-1" />
            {inert ? null : (
              <button type="button" className="text-micro font-medium text-accent-link" onClick={() => setFreeText(true)}>
                Switch runtime
              </button>
            )}
          </div>
        ) : null}

        {/* options — picking one selects it; the send action below commits it */}
        {optionList && !inert ? (
          <div className={cx(section, 'flex flex-col gap-2')} role="radiogroup" aria-label="Options">
            {decision.options.map((o) => {
              const picked = o.recommended || o.key === decision.recommendation;
              const chosen = selected === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  disabled={busy}
                  onClick={() => {
                    setSelected(o.key);
                    setFreeText(false);
                  }}
                  className={cx(
                    'rounded-r6 border p-3 text-left transition-colors duration-(--dur-fast) ease-ac',
                    chosen ? 'border-accent bg-accent-tint' : picked ? 'border-accent-edge' : 'border-line-2 hover:bg-bg-2',
                  )}
                >
                  <span className="mb-0.5 flex items-center gap-2">
                    <span className="text-ui font-medium text-text-strong">{o.label}</span>
                    {picked ? (
                      <span className="ac-mono rounded-r4 border border-accent-edge px-1.5 py-0.5 text-nano tracking-micro text-accent-link">PICKED</span>
                    ) : null}
                  </span>
                  {o.description ? <span className="block text-micro leading-snug text-text-3">{o.description}</span> : null}
                </button>
              );
            })}
            {decision.allowFreeText ? (
              <button
                type="button"
                aria-expanded={freeText}
                onClick={() => {
                  setSelected(null);
                  setFreeText((v) => !v);
                }}
                className="rounded-r6 border border-dashed border-line-2 p-3 text-left text-meta text-text-4 hover:text-text-2"
              >
                Write your own…
              </button>
            ) : null}
          </div>
        ) : null}

        {/* the values this card collects, in the order the asker asked for them */}
        {inputs.length && !inert ? (
          <div className={cx(section, 'flex flex-col gap-3 rounded-r6 border border-line-1 bg-bg-2 p-3')}>
            {inputs.map((i) => (
              <InputControl
                key={i.key}
                input={i}
                value={values[i.key]}
                disabled={busy}
                onChange={(v) => setValues((prev) => ({ ...prev, [i.key]: v }))}
              />
            ))}
          </div>
        ) : null}

        {/* answered — the record of what was decided */}
        {answered ? (
          <div className={cx(section, 'rounded-r6 border border-line-1 bg-bg-2 p-3')} aria-label="The answer given">
            {answerLine(decision) || !answeredInputs(decision).length ? (
              <p className="text-meta leading-relaxed text-text-1">{answerLine(decision) ?? 'No answer recorded.'}</p>
            ) : null}
            {answeredInputs(decision).map((r) => (
              <p key={r.label} className="text-meta leading-relaxed text-text-1">
                <span className="text-text-3">{r.label}: </span>
                {r.value}
              </p>
            ))}
            {decision.answeredAt ? <p className="ac-mono mt-1 text-micro text-text-4">{clock(decision.answeredAt)}</p> : null}
          </div>
        ) : null}

        {/* discard worktree — type the ticket id to confirm */}
        {destructive && !inert ? (
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={`type ${target.confirm ?? ticketIdentifier ?? 'the ticket id'} to confirm`}
            aria-label="Type the ticket identifier to confirm"
            className="ac-mono mb-2.5 h-9 w-full rounded-r6 border border-line-2 bg-bg-input px-3 text-meta text-text-1 outline-none placeholder:text-text-4"
          />
        ) : null}

        {freeText && !inert ? (
          <Composer
            className={section}
            rows={2}
            placeholder="Answer in your own words…"
            submitLabel="Send answer"
            onSubmit={(t) => {
              onAnswer(withInputs({ text: t }));
              setFreeText(false);
            }}
          />
        ) : null}

        {revising && !inert ? (
          <Composer
            className={section}
            rows={3}
            autoFocus
            scope={<span>Revising the {decision.kind === 'action_approval' ? 'action' : 'plan'} for {ticketIdentifier ?? 'this ticket'} — say what to change.</span>}
            placeholder="What should change?"
            submitLabel="Send revision"
            onSubmit={(t) => {
              onAnswer({ key: decision.kind === 'action_approval' ? NAMED_CARD_OPTION_KEYS.action_approval.revise : NAMED_CARD_OPTION_KEYS.plan_approval.revise, text: t });
              setRevising(false);
            }}
          />
        ) : null}

        {overriding && !inert ? (
          <Composer
            className={section}
            rows={2}
            autoFocus
            scope={<span>Overriding the hold on {ticketIdentifier ?? 'this ticket'} — say why this approves without a revision.</span>}
            placeholder="Why override the hold?"
            submitLabel="Override & approve"
            onSubmit={(t) => {
              onAnswer({
                key: decision.kind === 'merge_approval' ? NAMED_CARD_OPTION_KEYS.merge_approval.approve : decision.kind === 'action_approval' ? NAMED_CARD_OPTION_KEYS.action_approval.approve : NAMED_CARD_OPTION_KEYS.plan_approval.approve,
                overrideHold: true, overrideReason: t,
              });
              setOverriding(false);
            }}
          />
        ) : null}

        {missing.length && !inert ? (
          <p className="mb-2 text-micro text-text-3" role="status">
            {missing[0]!.label} is needed before this can be sent.
          </p>
        ) : null}

        {queued ? <p className="mb-2 text-micro text-working">Queued — this answer is sent and re-validated when the connection returns.</p> : null}

        <ConductorReviewLine decision={decision} />

        {/* primary action band, 44px, primary bottom-left. An answered card has none. */}
        <div className={cx('flex items-center gap-2', !inert && !auto && 'min-h-thumb')}>
          {auto ? (
            <p className="text-meta text-text-2" aria-label="Auto-approved by YOLO mode">
              <span className="font-medium text-needs-you">Auto-approved by YOLO mode</span>
              {decision.kind === 'merge_approval' ? ' — merging as soon as the PR\u2019s checks are green.' : ' — the worker is already implementing it.'}
            </p>
          ) : inert ? null : decision.kind === 'plan_approval' || decision.kind === 'action_approval' ? (
            <>
              <Button variant="primary" size="thumb" compact={compact} className="flex-1" disabled={busy || missing.length > 0 || held} onClick={() => answer(decision.kind === 'action_approval' ? NAMED_CARD_OPTION_KEYS.action_approval.approve : NAMED_CARD_OPTION_KEYS.plan_approval.approve)} kbd="⏎">
                Approve
              </Button>
              <Button variant="secondary" size="thumb" compact={compact} className="flex-1" disabled={busy} onClick={() => setRevising((v) => !v)}>
                Revise…
              </Button>
              <Button variant="ghost" size="thumb" compact={compact} className="w-12 border border-line-2" aria-label="Reject" disabled={busy} onClick={() => answer(decision.kind === 'action_approval' ? NAMED_CARD_OPTION_KEYS.action_approval.reject : NAMED_CARD_OPTION_KEYS.plan_approval.reject)}>
                ✕
              </Button>
              {held ? (
                <Button variant="ghost" size="thumb" compact={compact} className="flex-1 border border-line-2" disabled={busy} onClick={() => setOverriding((v) => !v)}>
                  Override & approve…
                </Button>
              ) : null}
            </>
          ) : decision.kind === 'merge_approval' ? (
            <>
              {/* No Hold: hiding the card (VS-72) already covers "not now" without answering, and a
                  merge approval has only `approve`/`changes` to answer with (VS-111). */}
              <Button variant="primary" size="thumb" compact={compact} className="flex-1" disabled={busy || missing.length > 0 || held} onClick={() => answer(NAMED_CARD_OPTION_KEYS.merge_approval.approve)}>
                Approve merge
              </Button>
              {held ? (
                <Button variant="ghost" size="thumb" compact={compact} className="flex-1 border border-line-2" disabled={busy} onClick={() => setOverriding((v) => !v)}>
                  Override & approve…
                </Button>
              ) : null}
              {ws && decision.ticketId ? (
                <A
                  to="/w/$ws/tickets/$ticketId"
                  params={{ ws, ticketId: decision.ticketId }}
                  search={{ tab: 'activity' }}
                  className="text-micro text-accent-link hover:underline"
                >
                  Ask the worker
                </A>
              ) : null}
            </>
          ) : decision.kind === 'hire_approval' ? (
            <>
              <Button variant="primary" size="thumb" compact={compact} className="flex-1" disabled={busy || missing.length > 0} onClick={() => answer(NAMED_CARD_OPTION_KEYS.hire_approval.approve)}>
                Hire
              </Button>
              <Button variant="secondary" size="thumb" compact={compact} className="w-24" disabled={busy} onClick={() => answer(NAMED_CARD_OPTION_KEYS.hire_approval.reject)}>
                Reject
              </Button>
            </>
          ) : destructive ? (
            <Button
              variant="danger"
              size="thumb"
              compact={compact}
              full
              disabled={busy || confirm.trim() !== (target.confirm ?? ticketIdentifier ?? '')}
              onClick={() => answer(NAMED_CARD_OPTION_KEYS.discard_approval.approve)}
            >
              Discard
            </Button>
          ) : optionList ? (
            <Button variant="primary" size="thumb" compact={compact} className="flex-1" disabled={busy || selected === null || missing.length > 0} onClick={() => answer(selected!)}>
              Send answer
            </Button>
          ) : inputs.length ? (
            // Nothing to choose, only values to give: filling them in is the whole answer.
            <Button variant="primary" size="thumb" compact={compact} className="flex-1" disabled={busy || missing.length > 0} onClick={() => onAnswer({ inputs: collected() })}>
              Send answer
            </Button>
          ) : null}
        </div>

        {/* "I need to do this myself" (VS-249): take the asking worker's session for a human's own
            terminal. Only when the card names who asked and which workspace it belongs to — a
            decision with neither cannot be resolved to a specific worker. */}
        {askedBy && ws && !inert ? (
          <div className="mt-2 border-t border-line-1 pt-2">
            {sessionOpen ? (
              <div className="flex flex-col gap-2">
                {handoverCommand.isLoading ? null : handoverCommand.data ? <HandoverCommand result={handoverCommand.data} /> : null}
                {handoverCommand.data?.resumable ? (
                  <Button
                    variant="secondary"
                    size="thumb"
                    compact={compact}
                    onClick={() => {
                      startHandover.mutate({ ws, id: askedBy }, {
                        onSuccess: () => toast.push({ title: 'Session taken', detail: 'Paste the command into a terminal on the daemon host.', status: 'done', ttl: 6000 }),
                        onError: (e) => toast.push({ title: 'Could not take the session', detail: e.message, status: 'failed' }),
                      });
                    }}
                  >
                    Take this session
                  </Button>
                ) : null}
              </div>
            ) : (
              <Button variant="ghost" size="thumb" compact={compact} full className="justify-start px-3 text-meta" onClick={() => setSessionOpen(true)}>
                I need to do this myself
                <span className="text-micro text-text-4">— take the session</span>
              </Button>
            )}
          </div>
        ) : null}

        {/* Hide from the surface, not from the decision. A full-width 44 px band of its own rather
            than an icon in the corner: on a phone this sits under the thumb that just decided not
            to answer yet, and nothing about it is reachable by a mis-tap on the approve action. */}
        {onHide && !inert ? (
          <div className="mt-2 border-t border-line-1 pt-2">
            <Button variant="ghost" size="thumb" compact={compact} full className="justify-start px-3 text-meta" onClick={onHide}>
              Hide from chat
              <span className="text-micro text-text-4">— stays in Needs you</span>
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
