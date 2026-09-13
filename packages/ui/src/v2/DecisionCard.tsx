/**
 * The V2 decision card (web-v2/decision-card).
 *
 * One decision, rendered complete and answerable in place: its context, the plan or document its
 * target names, its options and inputs, its work-product artifact, and — when the weaver is holding
 * it — the objection, the revision row with its Watch feed, and the reason-required Override. It is
 * the card Needs you renders and the chat pane mirrors; the narrow variant (VS-345) carries a
 * work-product link and `Ask the worker`.
 *
 * It reuses V1's data plumbing and shared helpers (`weaverReviewCopy`, `documentTarget`,
 * `NAMED_CARD_OPTION_KEYS`, `PlanPreview`, `DocumentPreview`) and its own V2 markup; V1's
 * `DecisionCard` is not touched (design.md).
 */
import { useMemo, useState } from 'react';
import {
  NAMED_CARD_OPTION_KEYS,
  documentTarget,
  weaverReviewCopy,
  type Decision,
  type DecisionAnswerInputs,
  type DecisionInput,
  type NamedCardKind,
} from '@weave-ai/shared';
import { A } from '../app/link';
import { DocumentPreview } from '../components/DocumentPreview';
import { Markdown } from '../components/Markdown';
import { PlanPreview } from '../components/PlanPreview';
import { useTicketWorkProducts } from '../api/hooks';
import { ago } from '../lib/format';
import { cx } from '../lib/cx';
import { WorkerFeed } from './WorkerFeed';

export interface V2Answer {
  key?: string;
  text?: string;
  inputs?: DecisionAnswerInputs;
  overrideHold?: boolean;
  overrideReason?: string;
}

export interface V2DecisionCardProps {
  decision: Decision;
  ticketIdentifier?: string | null;
  projectLabel?: string | null;
  projectSlug?: string | null;
  ws?: string | null;
  /** The agent that asked — the worker whose feed Watch follows. */
  askedBy?: string | null;
  asker?: 'weaver' | 'worker';
  busy?: boolean;
  /** The plan under approval, rendered above the actions on a `plan_approval`. */
  plan?: React.ReactNode;
  onAnswer: (a: V2Answer) => void;
  /** The chat pane's narrow-pane variant. */
  narrow?: boolean;
  className?: string;
}

/** Named kinds whose actions are purpose-built rather than the option list. */
const NAMED: NamedCardKind[] = ['plan_approval', 'merge_approval', 'hire_approval', 'discard_approval', 'action_approval'];

/** The header phrase, neutral text — no status glyph (HANDOFF §6). */
function headerLabel(d: Decision, asker?: 'weaver' | 'worker'): string {
  if (d.kind === 'question') return asker === 'weaver' ? 'Weaver asks' : asker === 'worker' ? 'Worker question' : 'Needs you';
  if (d.kind === 'concern') return 'Worker needs help';
  if (d.kind === 'gate_finding') return 'Gate finding';
  if (d.kind === 'retry_approval') return 'Worker stopped';
  if (d.kind === 'plan_approval' || d.kind === 'action_approval' || d.kind === 'hire_approval') return 'Needs you';
  if (d.kind === 'merge_approval') return 'Merge approval';
  if (d.kind === 'discard_approval') return 'Discard worktree';
  return 'Needs you';
}

const isEmpty = (v: string | string[] | undefined): boolean =>
  v === undefined || (typeof v === 'string' ? v.trim() === '' : v.length === 0);

/** A card's starting values (VS-342): an input's default, and a single-choice's recommendation. */
function initialInputValues(inputs: DecisionInput[]): DecisionAnswerInputs {
  const out: DecisionAnswerInputs = {};
  for (const i of inputs) {
    if (i.type === 'secret') continue;
    if (i.type === 'single_choice') {
      const recommended = (i.choices ?? []).find((c) => c.recommended === true)?.key;
      const v = typeof i.default === 'string' ? i.default : recommended;
      if (v) out[i.key] = v;
    } else if (i.type === 'multiselect') {
      if (Array.isArray(i.default) && i.default.length) out[i.key] = [...i.default];
    } else if (typeof i.default === 'string' && i.default !== '') {
      out[i.key] = i.default;
    }
  }
  return out;
}

function answeredInputs(decision: Decision): Array<{ label: string; value: string }> {
  const given = decision.answerInputs ?? {};
  return (decision.inputs ?? [])
    .filter((i) => given[i.key] !== undefined)
    .map((i) => {
      const v = given[i.key]!;
      if (i.type === 'single_choice') return { label: i.label, value: i.choices?.find((c) => c.key === v)?.label ?? String(v) };
      if (i.type === 'multiselect') {
        const labels = (Array.isArray(v) ? v : [v]).map((k) => i.choices?.find((c) => c.key === k)?.label ?? k);
        return { label: i.label, value: labels.join(', ') };
      }
      if (i.type === 'secret') return { label: i.label, value: `stored as ${String(v)}` };
      return { label: i.label, value: String(v) };
    });
}

function answerLine(decision: Decision): string | null {
  const chosen = decision.answerKey ? decision.options.find((o) => o.key === decision.answerKey)?.label ?? decision.answerKey : null;
  const text = decision.answerText?.trim() || null;
  if (chosen && text) return `${chosen} — ${text}`;
  return chosen ?? text;
}

function InputControl({ input, value, disabled, onChange }: {
  input: DecisionInput;
  value: string | string[] | undefined;
  disabled?: boolean;
  onChange: (v: string | string[]) => void;
}): React.ReactElement {
  const id = `v2-dc-input-${input.key}`;
  const field =
    'w-full rounded-r4 border border-line-2 bg-bg-input px-2.5 text-meta text-text-1 outline-none placeholder:text-text-4 focus:border-accent-edge';
  const chosen = Array.isArray(value) ? value : [];
  const chosenOne = typeof value === 'string' ? value : '';
  const choiceKeys = (input.choices ?? []).map((c) => c.key);
  const [otherActive, setOtherActive] = useState(false);
  const other = input.type === 'single_choice' && input.allowOther === true;
  const otherSelected = other && (otherActive || (chosenOne !== '' && !choiceKeys.includes(chosenOne)));
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={input.type === 'single_choice' || input.type === 'multiselect' ? undefined : id} className="text-micro font-medium text-text-2">
        {input.label}
        {input.required ? <span className="ml-1 text-needs-you" aria-hidden>*</span> : null}
      </label>
      {input.description ? <p className="-mt-0.5 text-nano leading-snug text-text-3">{input.description}</p> : null}
      {input.type === 'multiline' ? (
        <textarea
          id={id} rows={3} disabled={disabled} value={typeof value === 'string' ? value : ''}
          placeholder={input.placeholder} aria-required={input.required}
          onChange={(e) => onChange(e.target.value)} className={cx(field, 'resize-y py-2')}
        />
      ) : input.type === 'single_choice' ? (
        <div role="radiogroup" aria-label={input.label} className="flex flex-col gap-1.5">
          {(input.choices ?? []).map((c) => {
            const on = !otherSelected && chosenOne === c.key;
            return (
              <button
                key={c.key} type="button" role="radio" aria-checked={on} disabled={disabled}
                onClick={() => { setOtherActive(false); onChange(c.key); }}
                className={cx('rounded-r4 border p-2 text-left', on ? 'border-accent-edge bg-accent-tint' : 'border-line-2 hover:bg-bg-2')}
              >
                <span className="flex items-center gap-2">
                  <span className="text-meta font-medium text-text-strong">{c.label}</span>
                  {c.recommended ? <span className="v2-tag text-accent-link">RECOMMENDED</span> : null}
                </span>
                {c.description ? <span className="mt-0.5 block text-micro leading-snug text-text-3">{c.description}</span> : null}
              </button>
            );
          })}
          {other ? (
            <button
              type="button" role="radio" aria-checked={otherSelected} disabled={disabled}
              onClick={() => { setOtherActive(true); onChange(''); }}
              className={cx('rounded-r4 border border-dashed p-2 text-left text-meta', otherSelected ? 'border-accent-edge bg-accent-tint text-text-strong' : 'border-line-2 text-text-4 hover:text-text-2')}
            >
              Write your own…
            </button>
          ) : null}
          {otherSelected ? (
            <input
              type="text" disabled={disabled} value={chosenOne} placeholder={input.placeholder}
              aria-label={`${input.label} — your own answer`}
              onChange={(e) => onChange(e.target.value)} className={cx(field, 'h-9')}
            />
          ) : null}
        </div>
      ) : input.type === 'multiselect' ? (
        <div role="group" aria-label={input.label} className="flex flex-wrap gap-1.5">
          {(input.choices ?? []).map((c) => {
            const on = chosen.includes(c.key);
            return (
              <button
                key={c.key} type="button" role="checkbox" aria-checked={on} disabled={disabled} title={c.description}
                onClick={() => onChange(on ? chosen.filter((k) => k !== c.key) : [...chosen, c.key])}
                className={cx('rounded-r4 border px-2.5 py-1 text-micro', on ? 'border-accent-edge bg-accent-tint text-text-strong' : 'border-line-2 text-text-2 hover:bg-bg-2')}
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
          Stored as <span className="ac-mono">{input.secretName}</span> and never shown again.
        </p>
      ) : null}
    </div>
  );
}

/**
 * One decision, complete. The `inert` states (answered / superseded / withdrawn / expired) render a
 * record with no actions; every other state is answerable in the card.
 */
export function V2DecisionCard({
  decision,
  ticketIdentifier,
  projectLabel,
  projectSlug,
  ws,
  askedBy,
  asker,
  busy,
  plan,
  onAnswer,
  narrow = false,
  className,
}: V2DecisionCardProps): React.ReactElement {
  const [watchOpen, setWatchOpen] = useState(false);
  const [overriding, setOverriding] = useState(false);
  const [reason, setReason] = useState('');
  const [revising, setRevising] = useState(false);
  const [revision, setRevision] = useState('');
  const [requestingChanges, setRequestingChanges] = useState(false);
  const [changeText, setChangeText] = useState('');
  const [freeText, setFreeText] = useState(false);
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [confirm, setConfirm] = useState('');
  const [values, setValues] = useState<DecisionAnswerInputs>(() => initialInputValues(decision.inputs ?? []));

  const review = weaverReviewCopy(decision);
  // Two distinct holds (VS-266 / VS-281): the weaver's stated concerns, and the weaver not having
  // reviewed yet. Only the concerns hold has a revision in flight and the "blocked until a revision
  // lands" copy; the unreviewed card instead says so and offers the same escape hatch V1 does.
  const concerns = review?.held === true;
  const awaitsReview = review?.awaitsReview === true;
  const blocked = concerns || awaitsReview;
  const inert = decision.status !== 'open';
  const answered = decision.status === 'answered';
  const named = (NAMED as string[]).includes(decision.kind);
  const namedKind = named ? (decision.kind as NamedCardKind) : null;
  const optionList = !named && decision.options.length > 0;
  // A question with nothing to choose and nothing to fill in is answered only in words.
  const openEnded = !named && decision.options.length === 0 && (decision.inputs ?? []).length === 0 && decision.allowFreeText;
  const inputs = decision.inputs ?? [];
  const missing = inputs.filter((i) => i.required && isEmpty(values[i.key]));
  const destructive = decision.kind === 'discard_approval';
  const docTarget = documentTarget(decision);
  const meta = [ticketIdentifier, projectLabel ?? projectSlug ?? 'Workspace', askedBy].filter(Boolean).join(' · ');
  const head = headerLabel(decision, asker);
  const label = inert ? (answered ? 'Answered' : 'Closed') : head;
  const title = decision.title;
  const reasonRequired = reason.trim() === '';

  const collected = (): DecisionAnswerInputs => {
    const out: DecisionAnswerInputs = {};
    for (const i of inputs) if (!isEmpty(values[i.key])) out[i.key] = values[i.key]!;
    return out;
  };
  const withInputs = (a: V2Answer): V2Answer => (inputs.length ? { ...a, inputs: collected() } : a);
  const answer = (key: string, extra?: Partial<V2Answer>): void => onAnswer(withInputs({ key, ...(extra ?? {}) }));

  const products = useTicketWorkProducts(decision.ticketId ?? '', ws ?? undefined);
  const artifact = useMemo(
    () => (products.data ?? []).find((p) => p.type === 'artifact' && p.externalId),
    [products.data],
  );
  const artifactHref =
    artifact && ws && decision.ticketId
      ? `/v2/w/${encodeURIComponent(ws)}/tickets/${encodeURIComponent(decision.ticketId)}/artifacts/${encodeURIComponent(artifact.externalId!)}`
      : null;

  const approveKey = namedKind ? NAMED_CARD_OPTION_KEYS[namedKind].approve : 'approve';
  const reviseKey = namedKind === 'plan_approval' || namedKind === 'action_approval' ? NAMED_CARD_OPTION_KEYS[namedKind].revise : 'revise';
  const rejectKey = namedKind === 'plan_approval' || namedKind === 'action_approval' ? NAMED_CARD_OPTION_KEYS[namedKind].reject : 'reject';

  const reviewTone = review?.tone;
  const objection = review?.note ?? null;

  return (
    <article
      className={cx('v2-card overflow-hidden', destructive ? 'border-blocked/35' : null, className)}
      aria-label={`${label}: ${title}`}
    >
      <div className={cx('flex items-center gap-2 border-b border-line-1', narrow ? 'px-3 py-2' : 'px-3.5 py-2.5')}>
        <span className="text-meta font-medium text-text-1">{label}</span>
        <div className="flex-1" />
        {artifactHref ? (
          <A to={artifactHref} className="v2-tag text-accent-link">
            Artifact
          </A>
        ) : null}
        {meta ? <span className="ac-mono truncate text-micro text-text-3">{meta}</span> : null}
      </div>

      <div className={narrow ? 'p-3' : 'p-3.5'}>
        <h3 className="mb-1.5 text-head font-semibold leading-snug tracking-head text-text-strong">{title}</h3>
        {decision.context ? <Markdown source={decision.context} className="mb-3 text-meta leading-relaxed text-text-2" /> : null}

        {docTarget && decision.kind !== 'plan_approval' ? <DocumentPreview decision={decision} ws={ws ?? undefined} /> : null}
        {decision.kind === 'plan_approval' && !inert ? (plan ?? <PlanPreview decision={decision} ws={ws ?? undefined} />) : null}

        {review ? (
          <div className="mb-2" data-weaver-review={reviewTone}>
            <p className={cx('text-micro', reviewTone === 'concerns' ? 'font-medium text-blocked' : 'text-text-3')}>{review.line}</p>
            {objection ? <p className="mt-1 whitespace-pre-wrap text-meta text-text-1">{objection}</p> : null}
          </div>
        ) : null}

        {artifact ? (
          <div className="mb-3 flex items-center gap-2">
            <span className="v2-tag text-text-3">Artifact</span>
            {artifactHref ? (
              <A to={artifactHref} className="v2-link min-w-0 truncate text-meta">
                {artifact.title ?? artifact.externalId}
              </A>
            ) : null}
          </div>
        ) : null}

        {concerns && !inert ? (
          <>
            <div className="flex items-center gap-2 rounded-r4 border border-line-1 bg-bg-2 px-2.5 py-2" data-revision-row>
              <span className="size-1.5 flex-none animate-pulse rounded-pill bg-working" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-micro text-text-2">
                Revision in progress{decision.weaverReviewedAt ? ` · ${ago(decision.weaverReviewedAt)}` : ''}
              </span>
              <button
                type="button"
                aria-expanded={watchOpen}
                onClick={() => setWatchOpen((v) => !v)}
                className="v2-tag flex-none text-text-2"
              >
                {watchOpen ? 'Hide' : 'Watch'}
              </button>
            </div>
            {watchOpen ? (
              <div className="mb-3">
                <WorkerFeed agentId={askedBy} runId={decision.askedInRunId} ws={ws ?? undefined} compact label={`Live feed for ${ticketIdentifier ?? 'the worker'}`} />
              </div>
            ) : null}
          </>
        ) : null}

        {optionList && !inert ? (
          <div className="mb-3 flex flex-col gap-2" role="radiogroup" aria-label="Options">
            {decision.options.map((o) => {
              const picked = o.recommended || o.key === decision.recommendation;
              const chosen = selected === o.key;
              return (
                <button
                  key={o.key} type="button" role="radio" aria-checked={chosen} disabled={busy}
                  onClick={() => { setSelected(o.key); setFreeText(false); }}
                  className={cx('rounded-r4 border p-2.5 text-left', chosen ? 'border-accent-edge bg-accent-tint' : 'border-line-2 hover:bg-bg-2')}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-meta font-medium text-text-strong">{o.label}</span>
                    {picked ? <span className="v2-tag text-accent-link">RECOMMENDED</span> : null}
                  </span>
                  {o.description ? <span className="mt-0.5 block text-micro leading-snug text-text-3">{o.description}</span> : null}
                </button>
              );
            })}
            {decision.allowFreeText ? (
              <button
                type="button" aria-expanded={freeText}
                onClick={() => { setSelected(null); setFreeText((v) => !v); }}
                className="rounded-r4 border border-dashed border-line-2 p-2.5 text-left text-meta text-text-4 hover:text-text-2"
              >
                Write your own…
              </button>
            ) : null}
          </div>
        ) : null}

        {inputs.length && !inert ? (
          <div className="mb-3 flex flex-col gap-3 rounded-r4 border border-line-1 bg-bg-2 p-3">
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

        {(freeText || (openEnded && !inert)) && !inert ? (
          <textarea
            autoFocus rows={2} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Answer in your own words…" aria-label="Answer in your own words"
            className="mb-3 w-full rounded-r4 border border-line-2 bg-bg-input px-3 py-2 text-meta text-text-1 outline-none placeholder:text-text-4"
          />
        ) : null}

        {destructive && !inert ? (
          <input
            value={confirm} onChange={(e) => setConfirm(e.target.value)}
            placeholder={`type ${ticketIdentifier ?? 'the ticket id'} to confirm`}
            aria-label="Type the ticket identifier to confirm"
            className="ac-mono mb-2.5 h-9 w-full rounded-r4 border border-line-2 bg-bg-input px-3 text-meta text-text-1 outline-none placeholder:text-text-4"
          />
        ) : null}

        {answered ? (
          <div className="mb-3 rounded-r4 border border-line-1 bg-bg-2 p-3" aria-label="The answer given">
            {answerLine(decision) || !answeredInputs(decision).length ? (
              <p className="text-meta leading-relaxed text-text-1">{answerLine(decision) ?? 'No answer recorded.'}</p>
            ) : null}
            {answeredInputs(decision).map((r) => (
              <p key={r.label} className="text-meta leading-relaxed text-text-1">
                <span className="text-text-3">{r.label}: </span>
                {r.value}
              </p>
            ))}
            {decision.relayedFromMessageId ? (
              <p className="mt-1 text-micro leading-relaxed text-text-3">The human's words, recorded by the weaver from their message.</p>
            ) : null}
          </div>
        ) : null}

        {missing.length && !inert ? (
          <p className="mb-2 text-micro text-text-3" role="status">
            {missing[0]!.label} is needed before this can be sent.
          </p>
        ) : null}

        {overriding && !inert ? (
          <div className="mb-3 rounded-r4 border border-line-2 bg-bg-2 p-3">
            <p className="mb-3 text-micro leading-snug text-text-1">
              {concerns
                ? `Overriding records your reason on ${ticketIdentifier ?? 'the ticket'} and tells the weaver to stand down on this decision.`
                : `Overriding records your reason on ${ticketIdentifier ?? 'the ticket'} and approves without waiting for the weaver's review.`}
            </p>
            <textarea
              autoFocus rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Why override the hold?" aria-label="Why override the hold?"
              className="mb-2.5 w-full rounded-r4 border border-accent-edge bg-bg-input px-3 py-2 text-meta text-text-1 outline-none placeholder:text-text-4"
            />
            <div className="flex items-center gap-2">
              <button
                type="button" disabled={busy || reasonRequired}
                onClick={() => { answer(approveKey, { overrideHold: true, overrideReason: reason }); setOverriding(false); }}
                className="h-9 flex-1 rounded-r4 border-0 bg-text-1 text-meta font-medium text-bg-0 disabled:cursor-not-allowed disabled:opacity-55"
              >
                Override and approve
              </button>
              <button type="button" onClick={() => setOverriding(false)} className="h-9 rounded-r4 border border-line-2 px-3 text-meta text-text-2">
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {revising && !inert ? (
          <div className="mb-3 rounded-r4 border border-line-2 bg-bg-2 p-3">
            <textarea
              autoFocus rows={3} value={revision} onChange={(e) => setRevision(e.target.value)}
              placeholder="What should change?" aria-label="What should change?"
              className="mb-2.5 w-full rounded-r4 border border-line-2 bg-bg-input px-3 py-2 text-meta text-text-1 outline-none placeholder:text-text-4"
            />
            <div className="flex items-center gap-2">
              <button
                type="button" disabled={busy || revision.trim() === ''}
                onClick={() => { onAnswer(withInputs({ key: reviseKey, text: revision })); setRevising(false); }}
                className="h-9 rounded-r4 border-0 bg-accent px-3 text-meta font-medium text-white disabled:cursor-not-allowed disabled:opacity-55"
              >
                Send revision
              </button>
              <button type="button" onClick={() => setRevising(false)} className="h-9 rounded-r4 border border-line-2 px-3 text-meta text-text-2">
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {requestingChanges && !inert ? (
          <div className="mb-3 rounded-r4 border border-line-2 bg-bg-2 p-3">
            <textarea
              autoFocus rows={3} value={changeText} onChange={(e) => setChangeText(e.target.value)}
              placeholder="What should change before this merges?" aria-label="What should change before this merges?"
              className="mb-2.5 w-full rounded-r4 border border-line-2 bg-bg-input px-3 py-2 text-meta text-text-1 outline-none placeholder:text-text-4"
            />
            <div className="flex items-center gap-2">
              <button
                type="button" disabled={busy || changeText.trim() === ''}
                onClick={() => { onAnswer(withInputs({ key: 'changes', text: changeText })); setRequestingChanges(false); }}
                className="h-9 rounded-r4 border-0 bg-accent px-3 text-meta font-medium text-white disabled:cursor-not-allowed disabled:opacity-55"
              >
                Send request
              </button>
              <button type="button" onClick={() => setRequestingChanges(false)} className="h-9 rounded-r4 border border-line-2 px-3 text-meta text-text-2">
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <div className={cx('flex flex-wrap items-center gap-2', !inert && !blocked ? 'min-h-[34px]' : null)}>
          {inert ? null : destructive ? (
            <button
              type="button" disabled={busy || confirm.trim() !== (ticketIdentifier ?? '')}
              onClick={() => answer(approveKey)}
              className="h-9 rounded-r4 border-0 bg-blocked px-3 text-meta font-medium text-white disabled:cursor-not-allowed disabled:opacity-55"
            >
              Discard
            </button>
          ) : namedKind === 'plan_approval' || namedKind === 'action_approval' ? (
            <>
              <button
                type="button" disabled={busy || blocked || missing.length > 0}
                onClick={() => answer(approveKey)}
                className="h-9 flex-1 rounded-r4 border-0 bg-accent px-3 text-meta font-medium text-white disabled:cursor-not-allowed disabled:opacity-55"
              >
                Approve
              </button>
              <button
                type="button" disabled={busy}
                onClick={() => { setRevising((v) => !v); setOverriding(false); }}
                className="h-9 rounded-r4 border border-line-2 px-3 text-meta text-text-1"
              >
                Revise…
              </button>
              <button
                type="button" disabled={busy} aria-label="Reject"
                onClick={() => answer(rejectKey)}
                className="h-9 w-9 rounded-r4 border border-line-2 text-text-3"
              >
                ✕
              </button>
            </>
          ) : namedKind === 'merge_approval' ? (
            <>
              <button
                type="button" disabled={busy || blocked || missing.length > 0}
                onClick={() => answer(approveKey)}
                className="h-9 flex-1 rounded-r4 border-0 bg-accent px-3 text-meta font-medium text-white disabled:cursor-not-allowed disabled:opacity-55"
              >
                Approve merge
              </button>
              <button
                type="button" disabled={busy}
                onClick={() => { setRequestingChanges((v) => !v); setOverriding(false); }}
                className="h-9 rounded-r4 border border-line-2 px-3 text-meta text-text-1"
              >
                Request changes…
              </button>
            </>
          ) : namedKind === 'hire_approval' ? (
            <>
              <button
                type="button" disabled={busy || blocked}
                onClick={() => answer(approveKey)}
                className="h-9 flex-1 rounded-r4 border-0 bg-accent px-3 text-meta font-medium text-white disabled:cursor-not-allowed disabled:opacity-55"
              >
                Approve
              </button>
              <button type="button" disabled={busy} onClick={() => answer(rejectKey)} className="h-9 rounded-r4 border border-line-2 px-3 text-meta text-text-2">
                Reject
              </button>
            </>
          ) : optionList ? (
            <button
              type="button"
              disabled={busy || missing.length > 0 || (freeText ? text.trim() === '' : selected === null)}
              onClick={() => (freeText ? onAnswer(withInputs({ text })) : answer(selected!))}
              className="h-9 flex-1 rounded-r4 border-0 bg-accent px-3 text-meta font-medium text-white disabled:cursor-not-allowed disabled:opacity-55"
            >
              Send answer
            </button>
          ) : openEnded ? (
            <button
              type="button" disabled={busy || missing.length > 0 || text.trim() === ''}
              onClick={() => onAnswer(withInputs({ text }))}
              className="h-9 flex-1 rounded-r4 border-0 bg-accent px-3 text-meta font-medium text-white disabled:cursor-not-allowed disabled:opacity-55"
            >
              Send answer
            </button>
          ) : inputs.length ? (
            <button
              type="button" disabled={busy || missing.length > 0}
              onClick={() => onAnswer({ inputs: collected() })}
              className="h-9 flex-1 rounded-r4 border-0 bg-accent px-3 text-meta font-medium text-white disabled:cursor-not-allowed disabled:opacity-55"
            >
              Send answer
            </button>
          ) : null}

          {blocked && !inert ? (
            <button
              type="button" disabled={busy}
              onClick={() => setOverriding((v) => !v)}
              className="h-9 flex-1 rounded-r4 border border-line-3 px-3 text-meta text-text-1"
            >
              {concerns ? 'Override…' : 'Override & approve…'}
            </button>
          ) : null}
        </div>

        {concerns && !inert ? (
          <p className="mt-2 text-micro text-text-3">Approval is blocked until a revision lands.</p>
        ) : null}
        {awaitsReview && !inert ? (
          <p className="mt-2 text-micro text-text-3">Approval waits on the weaver's review — you can override it.</p>
        ) : null}

        {narrow && ws && decision.ticketId ? (
          <div className="mt-2 border-t border-line-1 pt-2">
            <A to={`/v2/w/${encodeURIComponent(ws)}/tickets/${encodeURIComponent(decision.ticketId)}`} className="v2-link text-micro">
              Ask the worker
            </A>
          </div>
        ) : null}
      </div>
    </article>
  );
}
