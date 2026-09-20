/**
 * The generic controls for a field declared by a JSON-Schema property (VS-348, VS-635). One module
 * maps a schema type to an input, so the runtime-options editor and the provider models editor render
 * the same way and a schema change reaches both. Object fields are edited as JSON text.
 */
import { useEffect, useState } from 'react';
import type { RuntimeOptionProperty } from '@weave-ai/shared';
import { cx } from '../../lib/cx';

export const inputCx = 'h-8 w-full rounded-r4 border border-line-2 bg-bg-input px-2 text-micro text-text-1 outline-none';

/** A JSON object field: local text state, parsed on blur, with the parse error shown at the field. */
export function ObjectControl({ value, onChange, ariaLabel, className }: {
  value: unknown; onChange: (v: Record<string, unknown> | undefined) => void; ariaLabel?: string; className?: string;
}): React.ReactElement {
  const asText = (v: unknown): string => (v && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v, null, 2) : '');
  const [text, setText] = useState(() => asText(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setText(asText(value)); setError(null); }, [value]);
  const commit = (): void => {
    const trimmed = text.trim();
    if (!trimmed) { setError(null); onChange(undefined); return; }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { setError('must be a JSON object.'); return; }
      setError(null);
      onChange(parsed as Record<string, unknown>);
    } catch (e) {
      setError(`is not valid JSON: ${e instanceof Error ? e.message : 'parse error'}`);
    }
  };
  return (
    <>
      <textarea
        aria-label={ariaLabel}
        className={className ?? cx(inputCx, 'ac-mono h-16 py-1.5')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
      />
      {error ? <span role="alert" className="text-nano text-failed">{error}</span> : null}
    </>
  );
}

/** One generated control for a schema property. `onChange` is called with the typed value or `undefined` to unset. */
export function OptionControl({ prop, value, onChange, ariaLabel }: {
  prop: RuntimeOptionProperty; value: unknown; onChange: (v: unknown) => void; ariaLabel?: string;
}): React.ReactElement {
  const empty = value === undefined || value === null || value === '';
  if (prop.type === 'object') {
    return <ObjectControl value={value} onChange={onChange} ariaLabel={ariaLabel ?? prop.description} />;
  }
  if (prop.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-micro text-text-2">
        <input type="checkbox" aria-label={ariaLabel ?? prop.description ?? 'option'} checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        {prop.default !== undefined ? <span className="text-text-3">default {String(prop.default)}</span> : null}
      </label>
    );
  }
  if (prop.enum && prop.enum.length > 0) {
    return (
      <select aria-label={ariaLabel} className={cx(inputCx, 'ac-mono')} value={empty ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}>
        <option value="">default{prop.default !== undefined ? ` (${String(prop.default)})` : ''}</option>
        {prop.enum.map((v) => <option key={String(v)} value={String(v)}>{String(v)}</option>)}
      </select>
    );
  }
  if (prop.type === 'integer' || prop.type === 'number') {
    return (
      <input type="number" aria-label={ariaLabel} className={cx(inputCx, 'ac-mono')} value={empty ? '' : String(value)}
        placeholder={prop.default !== undefined ? String(prop.default) : ''} min={prop.minimum} max={prop.maximum}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
    );
  }
  if (prop.type === 'array') {
    const lines = Array.isArray(value) ? value.join('\n') : '';
    return (
      <textarea aria-label={ariaLabel} className={cx(inputCx, 'ac-mono h-16 py-1.5')} value={lines} placeholder="one per line"
        onChange={(e) => onChange(e.target.value.split('\n').map((l) => l.trim()).filter(Boolean))} />
    );
  }
  return (
    <input aria-label={ariaLabel} className={cx(inputCx, 'ac-mono')} value={empty ? '' : String(value)}
      placeholder={prop.default !== undefined ? String(prop.default) : ''}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)} />
  );
}
