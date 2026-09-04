import { useEffect, useRef, useState } from 'react';
import { cx } from '../lib/cx';

/**
 * Six boxes, 52 px tall; paste fills all six; the caret box carries the focus
 * ring. Submits automatically on the sixth digit.
 */
export function TOTPInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  autoFocus = true,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
}): React.ReactElement {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const [focus, setFocus] = useState(autoFocus ? 0 : -1);
  const digits = value.padEnd(6, ' ').slice(0, 6).split('');

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  const set = (next: string): void => {
    const clean = next.replace(/\D/g, '').slice(0, 6);
    onChange(clean);
    if (clean.length === 6) onComplete?.(clean);
  };

  return (
    <div className="flex gap-2" role="group" aria-label="Six-digit authentication code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
          aria-invalid={invalid || undefined}
          value={d.trim()}
          onFocus={() => setFocus(i)}
          onBlur={() => setFocus(-1)}
          onPaste={(e) => {
            e.preventDefault();
            set(e.clipboardData.getData('text'));
            refs.current[5]?.focus();
          }}
          onChange={(e) => {
            const c = e.target.value.replace(/\D/g, '').slice(-1);
            if (!c) return;
            const arr = value.padEnd(6, ' ').split('');
            arr[i] = c;
            set(arr.join('').trimEnd());
            if (i < 5) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace') {
              e.preventDefault();
              const arr = value.padEnd(6, ' ').split('');
              if (arr[i]?.trim()) arr[i] = ' ';
              else if (i > 0) {
                arr[i - 1] = ' ';
                refs.current[i - 1]?.focus();
              }
              onChange(arr.join('').replace(/\s+$/, ''));
            }
            if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
            if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
          }}
          className={cx(
            'ac-mono h-13 w-11 rounded-r6 border text-center text-title outline-none transition-colors duration-(--dur-fast) ease-ac',
            invalid ? 'border-failed bg-bg-1 text-failed' : focus === i ? 'border-accent bg-bg-1 ac-focus-ring' : 'border-line-2 bg-bg-input',
            'text-text-1 placeholder:text-text-4',
          )}
        />
      ))}
    </div>
  );
}
