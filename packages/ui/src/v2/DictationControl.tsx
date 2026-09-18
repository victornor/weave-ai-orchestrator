/**
 * The shared V2 dictation control (VS-552).
 *
 * The mic control, its in-progress states (listening meter / transcribing indicator) and its
 * error/notice lines, extracted from `ChatComposer` so the chat composer and the decision card's
 * free-text surfaces use one implementation instead of two that drift. `useFieldDictation` gives a
 * plain text field a local session with no send, which is what a card input needs.
 */
import type { Dictation } from '../lib/dictation';
import { useDictationController, type DictationController } from '../lib/dictationController';
import { VoiceMeter } from '../components/VoiceMeter';
import { TranscribingIndicator } from '../components/TranscribingIndicator';
import { cx } from '../lib/cx';

const BUTTON =
  'flex size-7 flex-none items-center justify-center rounded-[6px] border border-line-2 bg-bg-2 text-text-2 hover:bg-bg-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-55';

function MicIcon({ slashed }: { slashed?: boolean }): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
      <rect x="5.6" y="1.4" width="4.8" height="8.2" rx="2.4" fill="currentColor" />
      <path d="M3.4 7.4a4.6 4.6 0 0 0 9.2 0M8 12v2.6" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      {slashed ? <path d="M2.2 2.2 13.8 13.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /> : null}
    </svg>
  );
}

function StopIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 12 12" className="size-3.5" aria-hidden>
      <rect x="2.5" y="2.5" width="7" height="7" rx="1.4" fill="currentColor" />
    </svg>
  );
}

function elapsedLabel(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export interface DictationButtonProps {
  dictation: Dictation;
  listening: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  /** A stable handle for a surface with more than one dictation control, e.g. a card. */
  testId?: string;
}

/** The one mic control: start, stop, unavailable, and the V2 pressed/recording treatment. */
export function DictationButton({ dictation, listening, disabled, onClick, className, testId }: DictationButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      data-testid={testId}
      className={cx(BUTTON, listening && 'border-accent text-accent-link', className)}
      aria-label={dictation.mode === 'unavailable' ? 'Dictation unavailable' : listening ? 'Stop dictation' : 'Dictate'}
      aria-pressed={listening}
      disabled={disabled}
      onClick={onClick}
    >
      {listening ? <StopIcon /> : <MicIcon slashed={dictation.mode === 'unavailable'} />}
    </button>
  );
}

export interface DictationProgressProps {
  dictation: Dictation;
  listening: boolean;
  transcribing: boolean;
  reducedMotion?: boolean;
  className?: string;
  /** Prefix for the listening/transcribing test ids; the composer passes `v2-composer`. */
  testId?: string;
}

/** What the field shows in place of itself while listening or waiting on a transcript. */
export function DictationProgress({
  dictation,
  listening,
  transcribing,
  reducedMotion = false,
  className,
  testId,
}: DictationProgressProps): React.ReactElement | null {
  if (listening) {
    return (
      <div data-testid={testId ? `${testId}-listening` : undefined} className={cx('flex min-w-0 flex-1 items-center gap-2.5 py-1', className)}>
        {dictation.metered ? (
          <VoiceMeter analyser={dictation.analyser} active className="h-6 min-w-0 flex-1" />
        ) : (
          <span className="flex h-6 min-w-0 flex-1 items-center gap-2 text-micro text-text-3">
            <span className="size-1.5 flex-none animate-pulse rounded-full bg-accent-link" aria-hidden />
            Listening…
          </span>
        )}
        <span className="ac-mono flex-none text-nano tabular-nums text-text-3">{elapsedLabel(dictation.elapsed)}</span>
      </div>
    );
  }
  if (transcribing) {
    return (
      <div data-testid={testId ? `${testId}-transcribing` : undefined} className={cx('flex min-w-0 flex-1 items-center py-1', className)}>
        <TranscribingIndicator reducedMotion={reducedMotion} className="h-6 min-w-0 flex-1" />
      </div>
    );
  }
  return null;
}

export interface DictationAlertsProps {
  dictation: Dictation;
  /** A pending or transient notice, shown only when there is no error to report instead. */
  notice?: string | null;
  className?: string;
}

/** The failure alert, or the notice, never both. */
export function DictationAlerts({ dictation, notice, className }: DictationAlertsProps): React.ReactElement | null {
  if (dictation.error) {
    return <p role="alert" className={cx('rounded-r4 border border-blocked/35 px-3 py-2 text-micro text-text-1', className)}>{dictation.error}</p>;
  }
  if (notice) {
    return <p role="status" className={cx('rounded-r4 border border-line-1 px-3 py-2 text-micro text-text-3', className)}>{notice}</p>;
  }
  return null;
}

/**
 * A local dictation session for a plain text field: the transcript is written into the field and a
 * too-short result restores it, but there is no send and no attachments. The decision card uses one
 * per free-text surface, as the Plan modal already uses a local session (VS-450).
 */
export function useFieldDictation(opts: { value: string; writeValue: (text: string) => void }): DictationController {
  return useDictationController({
    value: opts.value,
    writeValue: opts.writeValue,
    submit: () => undefined,
    canSubmit: () => false,
    hasFiles: () => false,
  });
}
