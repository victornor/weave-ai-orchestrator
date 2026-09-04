import { useCallback, useEffect, useRef, useState } from 'react';
import { useDictation } from '../lib/dictation';
import { cx } from '../lib/cx';
import { StatusGlyph } from './StatusGlyph';
import { VoiceMeter } from './VoiceMeter';

export type ComposerState = 'idle' | 'queued';

export interface ComposerProps {
  placeholder?: string;
  /** "Conductor is replying — your message is queued" when the agent is mid-turn. */
  queuedReason?: string | null;
  queuedCount?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  value?: string;
  onChange?: (v: string) => void;
  onSubmit: (text: string) => void | Promise<void>;
  /** rendered above the input; used by "Revise…" to show what it is scoped to. */
  scope?: React.ReactNode;
  rows?: number;
  submitLabel?: string;
  className?: string;
}

function MicIcon({ slashed }: { slashed?: boolean }): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
      <rect x="5.6" y="1.4" width="4.8" height="8.2" rx="2.4" fill="currentColor" />
      <path d="M3.4 7.4a4.6 4.6 0 0 0 9.2 0M8 12v2.6" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      {slashed ? <path d="M2.2 2.2 13.8 13.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /> : null}
    </svg>
  );
}

function SendIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden>
      <path d="M0 0 L12 6 L0 12 L2.6 6 Z" fill="currentColor" />
    </svg>
  );
}

/**
 * The one composer: chat, ticket comments, decision notes, revise-plan notes.
 * Mic is tap-to-toggle on touch and push-to-talk on ⌘⇧M at a desk — "a desk
 * user never leaves a hot mic open".
 */
export function Composer({
  placeholder = 'Tell the conductor what you need…',
  queuedReason,
  queuedCount = 0,
  disabled,
  autoFocus,
  value,
  onChange,
  onSubmit,
  scope,
  rows = 1,
  submitLabel = 'Send',
  className,
}: ComposerProps): React.ReactElement {
  const [internal, setInternal] = useState('');
  const text = value ?? internal;
  const set = useCallback((v: string) => (onChange ? onChange(v) : setInternal(v)), [onChange]);
  const ta = useRef<HTMLTextAreaElement>(null);
  const base = useRef('');
  const [explain, setExplain] = useState(false);
  const startedByKey = useRef(false);

  const dictation = useDictation(
    (chunk, final) => {
      const piece = chunk.trim();
      if (!piece) return;
      const next = `${base.current}${base.current && !base.current.endsWith(' ') ? ' ' : ''}${piece}`;
      set(next);
      if (final) base.current = next;
    },
  );

  const isTouch = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

  const startMic = useCallback(() => {
    if (dictation.mode === 'unavailable') {
      setExplain(true);
      return;
    }
    base.current = text;
    dictation.start();
  }, [dictation, text]);

  // Push-to-talk on ⌘⇧M / Ctrl⇧M at a desk; tap-to-toggle on touch.
  useEffect(() => {
    if (isTouch) return;
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyM' && !dictation.listening) {
        e.preventDefault();
        startedByKey.current = true;
        startMic();
      }
    };
    // Releasing the chord ends push-to-talk; a mic started by click is only stopped by click.
    const up = (e: KeyboardEvent) => {
      if (!startedByKey.current || !dictation.listening) return;
      if (e.code === 'KeyM' || e.key === 'Meta' || e.key === 'Control' || e.key === 'Shift') { startedByKey.current = false; dictation.stop(); }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [isTouch, dictation, startMic]);

  useEffect(() => {
    if (autoFocus) ta.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const send = useCallback(() => {
    const t = text.trim();
    if (!t || disabled) return;
    void onSubmit(t);
    set('');
    base.current = '';
  }, [text, disabled, onSubmit, set]);

  const dictating = dictation.listening;

  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      {queuedReason ? (
        <div className="flex items-center gap-2 rounded-t-r8 border border-line-2 border-b-0 bg-bg-2 px-3 py-2">
          <StatusGlyph status="working" size="xs" />
          <span className="text-micro text-text-2">{queuedReason}</span>
          {queuedCount > 0 ? <span className="ac-mono ml-auto rounded-r4 bg-bg-3 px-1.5 py-0.5 text-micro text-text-3">{queuedCount} queued</span> : null}
        </div>
      ) : null}
      {scope ? <div className="text-micro text-text-3">{scope}</div> : null}

      <div
        className={cx(
          'rounded-r8 border bg-bg-1 transition-colors duration-(--dur-fast) ease-ac',
          queuedReason && 'rounded-t-none',
          // No focus ring: the caret says it all. The border only changes while the mic is open.
          dictating ? 'border-accent' : 'border-line-2',
        )}
      >
        <div className="flex items-end gap-2.5 p-2 pl-3.5">
          <textarea
            ref={ta}
            rows={rows}
            value={text}
            disabled={disabled}
            placeholder={placeholder}
            aria-label={placeholder}
            onChange={(e) => set(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            className="max-h-48 flex-1 resize-none bg-transparent py-1.5 text-body text-text-1 outline-none placeholder:text-text-4 focus-visible:[box-shadow:none]"
          />
          <button
            type="button"
            aria-label={dictation.mode === 'unavailable' ? 'Dictation unavailable' : dictating ? 'Stop dictation' : 'Dictate'}
            aria-pressed={dictating}
            onClick={() => { startedByKey.current = false; dictating ? dictation.stop() : startMic(); }}
            className={cx(
              'inline-flex size-8 flex-none items-center justify-center rounded-r6 border transition-colors duration-(--dur-fast) ease-ac',
              dictating
                ? 'border-accent bg-accent-tint-strong text-accent-link'
                : dictation.mode === 'unavailable'
                  ? 'border-line-2 text-text-4'
                  : 'border-line-2 text-text-2 hover:bg-bg-3 hover:text-text-1',
            )}
          >
            <MicIcon slashed={dictation.mode === 'unavailable'} />
          </button>
          <button
            type="button"
            aria-label={submitLabel}
            disabled={!text.trim() || disabled}
            onClick={send}
            className={cx(
              'inline-flex size-8 flex-none items-center justify-center rounded-r6 transition-colors duration-(--dur-fast) ease-ac',
              text.trim() && !disabled ? 'bg-accent text-accent-on' : 'bg-bg-3 text-text-4',
            )}
          >
            <SendIcon />
          </button>
        </div>

        {dictating ? (
          <div className="flex h-12 items-center gap-3 border-t border-line-1 px-3.5">
            {/* fixed-height row: the waveform moves, the box never does */}
            <VoiceMeter analyser={dictation.analyser} active={dictating} className="h-8 min-w-0 flex-1" />
            <span className="ac-mono text-micro tabular-nums text-text-3">
              {Math.floor(dictation.elapsed / 60)}:{String(dictation.elapsed % 60).padStart(2, '0')}
            </span>
            <span className="hidden text-micro text-text-4 sm:inline">{isTouch ? 'tap the mic to stop' : startedByKey.current ? 'release ⌘⇧M to stop' : 'click the mic to stop'}</span>
          </div>
        ) : null}
      </div>

      {dictation.error ? (
        <p className="rounded-r6 border border-blocked/35 bg-blocked/8 px-3 py-2 text-micro leading-relaxed text-text-1" role="alert">
          {dictation.error}
        </p>
      ) : null}
      {explain && dictation.mode === 'unavailable' ? (
        <p className="text-micro leading-relaxed text-text-3">
          Dictation is unavailable: this browser has no Web Speech API and the daemon has no transcription provider.{' '}
          <span className="text-accent-link">Set a provider in Settings → Conductor</span>, or type instead.
        </p>
      ) : null}
    </div>
  );
}
