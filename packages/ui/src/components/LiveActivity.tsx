/**
 * The live activity row and the partial output of a run that is still going (VS-595).
 *
 * A running turn must never read as a bare "working": the row says whether the worker is writing,
 * thinking, running a named tool, or waiting for the model, with the seconds it has been in that
 * state, the turn's length, the tool-call count and the time since anything last arrived — enough to
 * tell a long investigation from a hung run. It ticks on the page's own one-second clock; nothing is
 * polled. A runtime that cannot stream says so in words instead of leaving the row to look broken.
 */
import { useEffect, useState } from 'react';
import type { RunEvent } from '@weave-ai/shared';
import { RUNTIME_PARTIAL_OUTPUT } from '@weave-ai/shared';
import { clock, liveTurn } from '@weave-ai/render';
import type { PartialText } from '../lib/livePartials';
import { Markdown } from './Markdown';
import { cx } from '../lib/cx';

/** One shared clock per component that asks for it; stops when `active` is false. */
export function useNow(active: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [active, everyMs]);
  return now;
}

export interface LiveRunProps {
  events: readonly RunEvent[];
  partials?: readonly PartialText[];
  lastPartialAt?: number | null;
  partialSince?: number | null;
  /** The run's runtime, which decides whether the page can say more than "whole steps only". */
  runtimeId?: string | null;
}

export function LiveActivity({ events, partials = [], lastPartialAt, partialSince, runtimeId }: LiveRunProps): React.ReactElement {
  const now = useNow(true);
  const partialOutput = runtimeId ? RUNTIME_PARTIAL_OUTPUT[runtimeId] ?? 'none' : 'none';
  const t = liveTurn(events, partials, now, { partialOutput, lastPartialAt, partialSince });
  return (
    <div
      role="status"
      data-live-activity
      data-live-state={t.state}
      className="ac-mono flex flex-col gap-1 rounded-r4 border border-line-1 bg-bg-2 px-2.5 py-1.5 text-micro"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className="size-1.5 flex-none rounded-pill bg-working motion-safe:animate-[ac-pulse_1.6s_ease-in-out_infinite]" />
        <span className={cx('ac-truncate min-w-0 flex-1', t.state === 'waiting' ? 'text-text-2' : 'text-text-1')}>{t.label}</span>
        <span className="flex-none text-text-2">{clock(t.stateMs)}</span>
      </div>
      <div className="flex flex-wrap gap-x-2 text-nano text-text-3">
        <span>{t.toolCount} tool {t.toolCount === 1 ? 'call' : 'calls'}</span>
        <span>· turn {clock(t.turnMs)}</span>
        {t.sinceLastMs > 0 ? <span>· last event {clock(t.sinceLastMs)} ago</span> : null}
      </div>
      {t.wholeStepsOnly ? (
        <p data-live-whole-steps className="text-nano text-text-3">
          This runtime reports whole steps only, so the page updates when a step finishes.
        </p>
      ) : null}
    </div>
  );
}

/** The text and reasoning still being generated, after the last completed block. */
export function LivePartials({ partials = [], onTicket }: { partials?: readonly PartialText[]; onTicket?: (id: string) => void }): React.ReactElement | null {
  const text = partials.filter((p) => p.kind === 'text' && p.text);
  const thinking = partials.filter((p) => p.kind === 'thinking' && p.text);
  // VS-601: a running tool's output so far (a Codex command's stdout), the last few lines of it.
  const output = partials.filter((p) => p.kind === 'tool_input' && p.text);
  if (text.length === 0 && thinking.length === 0 && output.length === 0) return null;
  return (
    <div data-live-partials className="flex flex-col gap-3 px-3.5 pb-1">
      {thinking.map((p) => (
        <p key={p.partId} data-live-thinking className="ac-mono text-micro italic text-text-3">
          {p.text.length > 240 ? `…${p.text.slice(-240)}` : p.text}
        </p>
      ))}
      {output.map((p) => (
        <pre key={p.partId} data-live-tool-output className="ac-mono max-h-24 overflow-hidden whitespace-pre-wrap break-all rounded-r4 bg-bg-2 px-2 py-1 text-nano text-text-2">
          {p.text.trimEnd().split('\n').slice(-4).join('\n')}
        </pre>
      ))}
      {text.map((p) => (
        <Markdown key={p.partId} source={p.text} onTicket={onTicket} breaks className="text-body leading-relaxed text-text-body" />
      ))}
    </div>
  );
}
