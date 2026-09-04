import { useState } from 'react';
import type { Decision } from '@openconductor/shared';
import { Button } from './Button';
import { Composer } from './Composer';
import { StatusGlyph } from './StatusGlyph';
import { cx } from '../lib/cx';

export interface DecisionCardProps {
  decision: Decision;
  ticketIdentifier?: string | null;
  projectSlug?: string | null;
  askedBy?: string | null;
  busy?: boolean;
  queued?: boolean;
  onAnswer: (answer: { key?: string; text?: string; remember?: boolean }) => void;
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
}

const HEAD: Record<string, { label: string; status: 'needs-you' | 'merging' | 'blocked' | 'failed' }> = {
  plan_approval: { label: 'Plan approval', status: 'needs-you' },
  merge_approval: { label: 'Merge approval', status: 'merging' },
  hire_approval: { label: 'Hire approval', status: 'needs-you' },
  discard_approval: { label: 'Discard worktree', status: 'failed' },
  question: { label: 'Worker question', status: 'blocked' },
  gate_finding: { label: 'Gate finding', status: 'blocked' },
  approval: { label: 'Needs you', status: 'needs-you' },
};

/**
 * One decision per card. Header says what it is, the body is per variant, the
 * primary action sits bottom-left inside a 44 px thumb band.
 */
export function DecisionCard({ decision, ticketIdentifier, projectSlug, askedBy, busy, queued, onAnswer, className }: DecisionCardProps): React.ReactElement {
  const [revising, setRevising] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [freeText, setFreeText] = useState(false);
  const head = HEAD[decision.kind] ?? HEAD['approval']!;
  const target = (decision.target ?? {}) as Target;
  const destructive = decision.kind === 'discard_approval';
  const meta = [ticketIdentifier, projectSlug, askedBy].filter(Boolean).join(' · ');

  const answer = (key: string, text?: string): void => onAnswer(text === undefined ? { key } : { key, text });

  return (
    <article
      className={cx('overflow-hidden rounded-r8 border bg-bg-1', destructive ? 'border-failed/35' : 'border-line-2', className)}
      aria-label={`${head.label}: ${decision.title}`}
    >
      <div className="flex items-center gap-2 border-b border-line-1 px-3.5 py-2.5">
        <StatusGlyph status={head.status} size="sm" />
        <span className={cx('text-meta font-medium', head.status === 'merging' ? 'text-merging' : head.status === 'needs-you' ? 'text-needs-you' : head.status === 'failed' ? 'text-failed' : 'text-blocked')}>
          {decision.kind === 'plan_approval' ? 'Needs you' : head.label}
        </span>
        <div className="flex-1" />
        {target.prUrl ? (
          <a className="oc-mono text-micro" href={target.prUrl} target="_blank" rel="noreferrer">
            PR {target.prNumber ? `#${target.prNumber}` : ''} ↗
          </a>
        ) : meta ? (
          <span className="oc-mono text-micro text-text-3">{meta}</span>
        ) : null}
      </div>

      <div className="p-3.5">
        <h3 className="mb-1.5 text-head font-semibold leading-snug tracking-head text-text-strong">{decision.title}</h3>
        {decision.context ? <p className="mb-3 text-meta leading-relaxed text-text-2">{decision.context}</p> : null}

        {/* plan approval — the proposal's task list */}
        {target.tasks?.length ? (
          <ul className="mb-3 flex flex-col gap-1.5 rounded-r6 border border-line-1 bg-bg-2 p-3">
            {target.tasks.map((t, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="mt-0.5 size-3 flex-none rounded-r4 border border-line-3" aria-hidden />
                <span className="flex-1 text-meta leading-snug text-text-soft">{t.text}</span>
                {t.files ? <span className="oc-mono text-micro text-text-4">{t.files}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}

        {/* merge approval — CI and diff stats */}
        {decision.kind === 'merge_approval' ? (
          <div className="oc-mono mb-3 flex flex-wrap items-center gap-3.5 text-micro">
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
          <div className="mb-3 flex items-center gap-2 rounded-r6 border border-line-1 bg-bg-2 px-3 py-2">
            <span className="oc-mono text-micro text-text-soft">
              {target.runtime}
              {target.model ? ` · ${target.model}` : ''}
            </span>
            <div className="flex-1" />
            <button type="button" className="text-micro font-medium text-accent-link" onClick={() => setFreeText(true)}>
              Switch runtime
            </button>
          </div>
        ) : null}

        {/* question — options with the picked recommendation */}
        {decision.kind === 'question' || decision.kind === 'gate_finding' || (decision.options.length > 2 && decision.kind === 'approval') ? (
          <div className="mb-3 flex flex-col gap-2">
            {decision.options.map((o) => {
              const picked = o.recommended || o.key === decision.recommendation;
              return (
                <button
                  key={o.key}
                  type="button"
                  disabled={busy}
                  onClick={() => answer(o.key)}
                  className={cx(
                    'rounded-r6 border p-3 text-left transition-colors duration-(--dur-fast) ease-oc',
                    picked ? 'border-accent bg-accent-tint' : 'border-line-2 hover:bg-bg-2',
                  )}
                >
                  <span className="mb-0.5 flex items-center gap-2">
                    <span className="text-ui font-medium text-text-strong">{o.label}</span>
                    {picked ? (
                      <span className="oc-mono rounded-r4 border border-accent-edge px-1.5 py-0.5 text-nano tracking-micro text-accent-link">PICKED</span>
                    ) : null}
                  </span>
                  {o.description ? <span className="block text-micro leading-snug text-text-3">{o.description}</span> : null}
                </button>
              );
            })}
            {decision.allowFreeText ? (
              <button
                type="button"
                onClick={() => setFreeText((v) => !v)}
                className="rounded-r6 border border-dashed border-line-2 p-3 text-left text-meta text-text-4 hover:text-text-2"
              >
                Something else…
              </button>
            ) : null}
          </div>
        ) : null}

        {/* discard worktree — type the ticket id to confirm */}
        {destructive ? (
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={`type ${target.confirm ?? ticketIdentifier ?? 'the ticket id'} to confirm`}
            aria-label="Type the ticket identifier to confirm"
            className="oc-mono mb-2.5 h-9 w-full rounded-r6 border border-line-2 bg-bg-input px-3 text-meta text-text-1 outline-none placeholder:text-text-4"
          />
        ) : null}

        {freeText ? (
          <Composer
            className="mb-3"
            rows={2}
            placeholder="Answer in your own words…"
            submitLabel="Send answer"
            onSubmit={(t) => {
              onAnswer({ text: t });
              setFreeText(false);
            }}
          />
        ) : null}

        {revising ? (
          <Composer
            className="mb-3"
            rows={3}
            autoFocus
            scope={<span>Revising the plan for {ticketIdentifier ?? 'this ticket'} — say what to change.</span>}
            placeholder="What should change?"
            submitLabel="Send revision"
            onSubmit={(t) => {
              onAnswer({ key: 'revise', text: t });
              setRevising(false);
            }}
          />
        ) : null}

        {queued ? <p className="mb-2 text-micro text-working">Queued — this answer is sent and re-validated when the connection returns.</p> : null}

        {/* primary action band, 44px, primary bottom-left */}
        <div className="flex min-h-thumb items-center gap-2">
          {decision.kind === 'plan_approval' ? (
            <>
              <Button variant="primary" size="thumb" className="flex-1" disabled={busy} onClick={() => answer('approve')} kbd="⏎">
                Approve
              </Button>
              <Button variant="secondary" size="thumb" className="flex-1" disabled={busy} onClick={() => setRevising((v) => !v)}>
                Revise…
              </Button>
              <Button variant="ghost" size="thumb" className="w-12 border border-line-2" aria-label="Reject" disabled={busy} onClick={() => answer('reject')}>
                ✕
              </Button>
            </>
          ) : decision.kind === 'merge_approval' ? (
            <>
              <Button variant="primary" size="thumb" className="flex-1" disabled={busy} onClick={() => answer('approve')}>
                Approve merge
              </Button>
              <Button variant="secondary" size="thumb" className="w-24" disabled={busy} onClick={() => answer('hold')}>
                Hold
              </Button>
            </>
          ) : decision.kind === 'hire_approval' ? (
            <>
              <Button variant="primary" size="thumb" className="flex-1" disabled={busy} onClick={() => answer('approve')}>
                Hire
              </Button>
              <Button variant="secondary" size="thumb" className="w-24" disabled={busy} onClick={() => answer('reject')}>
                Reject
              </Button>
            </>
          ) : destructive ? (
            <Button
              variant="danger"
              size="thumb"
              full
              disabled={busy || confirm.trim() !== (target.confirm ?? ticketIdentifier ?? '')}
              onClick={() => answer('discard')}
            >
              Discard
            </Button>
          ) : decision.options.length <= 2 && decision.options.length > 0 ? (
            decision.options.map((o, i) => (
              <Button key={o.key} variant={i === 0 ? 'primary' : 'secondary'} size="thumb" className="flex-1" disabled={busy} onClick={() => answer(o.key)}>
                {o.label}
              </Button>
            ))
          ) : null}
        </div>
      </div>
    </article>
  );
}
