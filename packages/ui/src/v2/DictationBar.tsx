/**
 * The floating dictation bar (VS-450), shown by `DictationSessionProvider` on every V2 page except
 * the target chat while the session is listening or transcribing. It carries the same voice meter
 * the composer shows (or the VS-441 transcribing animation), an elapsed timer, Stop, Send and a way
 * back to the chat the session belongs to.
 *
 * It clears the phone tab bar and the safe area, sits above the page rather than over a primary
 * action, is keyboard reachable, and follows reduced motion through the transcribing indicator.
 */
import { useState } from 'react';
import { A } from '../app/link';
import { cx } from '../lib/cx';
import { usePrefersReducedMotion } from '../lib/streamReveal';
import { VoiceMeter } from '../components/VoiceMeter';
import { TranscribingIndicator } from '../components/TranscribingIndicator';
import type { DictationSessionValue } from './DictationSession';

const BUTTON = 'flex size-7 flex-none items-center justify-center rounded-[6px] border border-line-2 bg-bg-2 text-text-2 hover:bg-bg-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-55';

function MicGlyph(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
      <rect x="5.6" y="1.4" width="4.8" height="8.2" rx="2.4" fill="currentColor" />
      <path d="M3.4 7.4a4.6 4.6 0 0 0 9.2 0M8 12v2.6" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function StopGlyph(): React.ReactElement {
  return (
    <svg viewBox="0 0 12 12" className="size-3.5" aria-hidden>
      <rect x="2.5" y="2.5" width="7" height="7" rx="1.4" fill="currentColor" />
    </svg>
  );
}

function SendGlyph(): React.ReactElement {
  return (
    <svg viewBox="0 0 12 12" className="size-3.5" aria-hidden>
      <path d="M0 0 L12 6 L0 12 L2.6 6 Z" fill="currentColor" />
    </svg>
  );
}

function elapsedLabel(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function DictationBar({ session }: { session: DictationSessionValue }): React.ReactElement | null {
  const reducedMotion = usePrefersReducedMotion();
  const [warned, setWarned] = useState(false);
  const { dictation, target } = session;
  if (!target) return null;

  const dropped = session.attachmentsDropped;
  const onSend = (): void => {
    if (dropped > 0 && !warned) {
      setWarned(true);
      return;
    }
    session.requestSend();
  };
  const message = dictation.error ?? session.pendingNotice ?? session.notice;

  return (
    <div
      role="region"
      aria-label="Dictation running"
      data-testid="v2-dictation-bar"
      className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] z-30 flex justify-center px-3 md:bottom-4"
    >
      <div
        className={cx(
          'flex w-full max-w-[560px] flex-col gap-1.5 rounded-r6 border bg-bg-1 px-2.5 py-2 shadow-sheet',
          dictation.listening || dictation.transcribing ? 'border-accent-edge' : 'border-line-2',
        )}
      >
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 flex-none items-center justify-center rounded-[6px] border border-line-2 bg-bg-2 text-accent-link" aria-hidden>
            <MicGlyph />
          </span>
          {dictation.transcribing ? (
            <TranscribingIndicator reducedMotion={reducedMotion} className="h-6 min-w-0 flex-1" />
          ) : dictation.metered ? (
            <VoiceMeter analyser={dictation.analyser} active className="h-6 min-w-0 flex-1" />
          ) : (
            <span className="flex h-6 min-w-0 flex-1 items-center gap-2 text-micro text-text-3">
              <span className="size-1.5 flex-none animate-pulse rounded-full bg-accent-link" aria-hidden />
              Listening…
            </span>
          )}
          <span className="ac-mono flex-none text-nano tabular-nums text-text-3" data-testid="v2-dictation-timer">
            {elapsedLabel(dictation.elapsed)}
          </span>
          <button
            type="button"
            aria-label="Stop dictation"
            onClick={() => session.stop()}
            disabled={dictation.transcribing}
            className={cx(BUTTON, dictation.listening && 'border-accent text-accent-link')}
          >
            <StopGlyph />
          </button>
          <button
            type="button"
            aria-label={session.pendingSend ? 'Send queued' : 'Send to the weaver'}
            onClick={onSend}
            disabled={session.pendingSend}
            className={cx(BUTTON, session.pendingSend && 'border-accent text-accent-link')}
          >
            {session.pendingSend ? (
              <span className="size-3.5 animate-spin rounded-pill border border-current border-t-transparent" aria-hidden />
            ) : (
              <SendGlyph />
            )}
          </button>
          <A
            to="/w/$ws/chat"
            params={{ ws: target.ws }}
            className="flex-none whitespace-nowrap rounded-r4 border border-line-2 px-2 py-1 text-micro text-text-2 hover:bg-bg-2 hover:text-text-1"
          >
            Back to chat
          </A>
        </div>

        {dropped > 0 && warned ? (
          <p role="status" className="px-1 text-micro text-text-3" data-testid="v2-dictation-attach-warning">
            {dropped === 1 ? '1 attachment was' : `${dropped} attachments were`} dropped when you left the chat. Send
            again to post the text without {dropped === 1 ? 'it' : 'them'}, or go back to reattach.
          </p>
        ) : null}
        {message ? (
          <p role="status" className="px-1 text-micro text-text-3" data-testid="v2-dictation-notice">
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}