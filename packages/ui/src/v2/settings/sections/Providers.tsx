/**
 * Settings → Providers (VS-610): the `weave` runtime's provider profiles for the selected workspace —
 * list, add from a preset, edit, a masked key input that never renders a stored value back, and a
 * Test connection action whose per-capability results can be applied to the profile's `compat`.
 *
 * The key is written through the provider's own secret route, never through config; nothing here
 * ever holds a stored key, only the one being typed.
 */
import { useEffect, useState } from 'react';
import { useClearProviderSecret, useDeleteProvider, useProviders, useSaveProvider, useSetProviderSecret, useTestProvider } from '../../../api/hooks';
import type * as T from '../../../api/types';
import { Button } from '../../../components/Button';
import { SkeletonRows } from '../../../components/Skeleton';
import { cx } from '../../../lib/cx';

const inputCx = 'h-8 w-full rounded-r4 border border-line-2 bg-bg-input px-2 text-micro text-text-1 outline-none';

/**
 * A convenience hint only: presets carry compat flags and a description, not an endpoint. A preset
 * with no entry here leaves the base URL for the user to fill.
 */
const PRESET_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  deepseek: 'https://api.deepseek.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  together: 'https://api.together.xyz/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  mistral: 'https://api.mistral.ai/v1',
  zai: 'https://api.z.ai/api/coding/paas/v4',
  ollama: 'http://127.0.0.1:11434/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
  vllm: 'http://127.0.0.1:8000/v1',
  llamacpp: 'http://127.0.0.1:8080/v1',
  litellm: 'http://127.0.0.1:4000/v1',
};

const secretNameFor = (id: string): string => `WEAVE_LLM_${id.replace(/[^a-z0-9]+/gi, '_').toUpperCase()}_KEY`;

function linesToRecord(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const at = trimmed.indexOf(':');
    if (at <= 0) continue;
    out[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim();
  }
  return out;
}
function recordToLines(record: Record<string, string> | undefined): string {
  return Object.entries(record ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n');
}
/** Parse a JSON object field; an empty string is "unset", anything else must be a plain object. */
function parseObject(text: string, label: string): { value?: Record<string, unknown>; error?: string } {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: `${label} must be a JSON object.` };
    return { value: parsed as Record<string, unknown> };
  } catch (e) {
    return { error: `${label} is not valid JSON: ${e instanceof Error ? e.message : 'parse error'}` };
  }
}
function mergeCompat(base: Record<string, unknown> | undefined, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    const prev = out[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && prev && typeof prev === 'object' && !Array.isArray(prev)
      ? { ...(prev as Record<string, unknown>), ...(v as Record<string, unknown>) }
      : v;
  }
  return out;
}

interface Draft {
  baseUrl: string; preset: string; apiKeySecret: string; auth: string;
  headersText: string; queryText: string; discover: boolean; maxConcurrentRuns: string;
  connectMs: string; idleMs: string; requestMs: string; compatText: string; paramsText: string;
}
function draftOf(profile: T.ProviderProfile): Draft {
  return {
    baseUrl: profile.baseUrl,
    preset: profile.preset ?? '',
    apiKeySecret: profile.apiKeySecret ?? '',
    auth: profile.auth,
    headersText: recordToLines(profile.headers),
    queryText: recordToLines(profile.query),
    discover: profile.discover ?? true,
    maxConcurrentRuns: profile.maxConcurrentRuns != null ? String(profile.maxConcurrentRuns) : '',
    connectMs: profile.timeouts?.connectMs != null ? String(profile.timeouts.connectMs) : '',
    idleMs: profile.timeouts?.idleMs != null ? String(profile.timeouts.idleMs) : '',
    requestMs: profile.timeouts?.requestMs != null ? String(profile.timeouts.requestMs) : '',
    compatText: profile.compat ? JSON.stringify(profile.compat, null, 2) : '',
    paramsText: profile.params ? JSON.stringify(profile.params, null, 2) : '',
  };
}
/** Build a profile from the editor; returns an error string when a JSON field cannot be parsed. */
function profileOf(draft: Draft, models: Record<string, T.ProviderModelEntry>): { profile?: T.ProviderProfile; error?: string } {
  const headers = linesToRecord(draft.headersText);
  const query = linesToRecord(draft.queryText);
  const compat = parseObject(draft.compatText, 'compat');
  if (compat.error) return { error: compat.error };
  const params = parseObject(draft.paramsText, 'params');
  if (params.error) return { error: params.error };
  const int = (v: string): number | undefined => { const n = Number(v); return v.trim() && Number.isFinite(n) ? Math.floor(n) : undefined; };
  const timeouts = { connectMs: int(draft.connectMs), idleMs: int(draft.idleMs), requestMs: int(draft.requestMs) };
  const hasTimeout = timeouts.connectMs !== undefined || timeouts.idleMs !== undefined || timeouts.requestMs !== undefined;
  const maxConcurrentRuns = int(draft.maxConcurrentRuns);
  return {
    profile: {
      ...(draft.preset.trim() ? { preset: draft.preset.trim() } : {}),
      baseUrl: draft.baseUrl.trim(),
      ...(draft.apiKeySecret.trim() ? { apiKeySecret: draft.apiKeySecret.trim() } : {}),
      auth: draft.auth,
      headers,
      ...(Object.keys(query).length > 0 ? { query } : {}),
      discover: draft.discover,
      ...(maxConcurrentRuns !== undefined ? { maxConcurrentRuns } : {}),
      ...(hasTimeout ? { timeouts } : {}),
      ...(compat.value ? { compat: compat.value } : {}),
      ...(params.value ? { params: params.value } : {}),
      models,
    },
  };
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <label className="flex flex-col gap-1">
      <span className="ac-label">{label}</span>
      {children}
      {hint ? <span className="text-nano text-text-3">{hint}</span> : null}
    </label>
  );
}

/** The masked key input plus its status; a stored value is never read into the field. */
function SecretRow({ id, secretName, configured, onSet, onClear, pending }: {
  id: string; secretName: string | undefined; configured: boolean;
  onSet: (value: string) => void; onClear: () => void; pending: boolean;
}): React.ReactElement {
  const [draft, setDraft] = useState('');
  return (
    <div className="v2-recessed flex flex-col gap-1 rounded-r4 border border-line-1 px-3 py-2">
      <div className="flex items-baseline gap-2">
        <span className="ac-label">API key</span>
        <span className="min-w-0 flex-1 truncate text-micro text-text-3">{secretName ?? 'no secret name set on this profile'}</span>
        <span className={cx('v2-tag', configured ? 'text-text-2' : 'text-text-3')}>{configured ? 'key set' : 'no key'}</span>
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          aria-label={`${id} API key`}
          className={cx(inputCx, 'ac-mono')}
          autoComplete="off"
          placeholder={configured ? 'Replace the key…' : 'Paste the API key…'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button size="sm" variant="primary" disabled={!draft || pending || !secretName} onClick={() => { onSet(draft); setDraft(''); }}>Save key</Button>
        <Button size="sm" variant="danger" disabled={!configured || pending} onClick={onClear}>Clear</Button>
      </div>
      <span className="text-nano text-text-3">Held only in the workspace secret store. Never shown here again once saved.</span>
    </div>
  );
}

function TestResult({ report, onApply, hideApply }: {
  report: T.ProviderTestReport; onApply?: () => void; hideApply?: boolean;
}): React.ReactElement {
  const detected = Object.keys(report.detected ?? {}).length > 0;
  return (
    <div className="v2-recessed flex flex-col gap-1 rounded-r4 border border-line-1 px-3 py-2">
      <div className="grid gap-1 sm:grid-cols-2">
        {report.checks.map((c) => (
          <div key={c.name} className="flex items-baseline gap-2">
            <span className={cx('ac-mono text-nano', c.ok ? 'text-text-2' : 'text-failed')}>{c.ok ? 'PASS' : 'FAIL'}</span>
            <span className="text-micro text-text-1">{c.name}</span>
            <span className="min-w-0 flex-1 truncate text-nano text-text-3" title={c.detail}>{c.detail}</span>
          </div>
        ))}
      </div>
      {detected && !hideApply && onApply ? (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-nano text-text-3">The probe measured flags that differ from this profile: <code className="ac-mono">{Object.keys(report.detected).join(', ')}</code></span>
          <Button size="sm" onClick={onApply}>Apply detected flags</Button>
        </div>
      ) : null}
      {!detected ? <span className="text-nano text-text-3">No flag differences detected.</span> : null}
    </div>
  );
}

function ProviderRow({ view, onSave, onRemove }: {
  view: T.ProviderView; onSave: (profile: T.ProviderProfile) => Promise<void>; onRemove: () => void;
}): React.ReactElement {
  const { id, profile, secretConfigured, models } = view;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(profile));
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<T.ProviderTestReport | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const set = useSetProviderSecret();
  const clear = useClearProviderSecret();
  const test = useTestProvider();
  useEffect(() => { setDraft(draftOf(profile)); }, [profile]);

  const save = (): void => {
    const built = profileOf(draft, profile.models);
    if (built.error || !built.profile) { setError(built.error ?? 'Could not build the profile.'); return; }
    setError(null);
    void onSave(built.profile);
  };
  const applyDetected = (): void => {
    if (!report) return;
    setError(null);
    void onSave({ ...profile, compat: mergeCompat(profile.compat, report.detected) });
  };

  return (
    <div className="v2-card flex flex-col">
      <div className="flex items-baseline gap-2 px-3 py-2">
        <button type="button" className="flex min-w-0 flex-1 items-baseline gap-2 text-left" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span className="ac-mono text-meta text-text-1">{id}</span>
          <span className="v2-tag text-text-2">{profile.preset ?? 'custom'}</span>
          <span className="truncate text-micro text-text-3">{profile.baseUrl}</span>
          <span className="text-nano text-text-3">{models.length} model{models.length === 1 ? '' : 's'}</span>
          <span className="text-nano text-text-3">{secretConfigured ? 'key set' : 'no key'}</span>
          <span className="ml-auto text-text-3" aria-hidden>{open ? '▾' : '▸'}</span>
        </button>
      </div>
      {open ? (
        <div className="v2-anim-fade flex flex-col gap-3 border-t border-line-1 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="base URL">
              <input aria-label={`${id} base URL`} className={cx(inputCx, 'ac-mono')} value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} />
            </Field>
            <Field label="preset" hint="Base compat flags; leave empty for the generic OpenAI-compatible set.">
              <input aria-label={`${id} preset`} className={cx(inputCx, 'ac-mono')} value={draft.preset} onChange={(e) => setDraft({ ...draft, preset: e.target.value })} />
            </Field>
            <Field label="secret name" hint="The workspace secret the key is stored under.">
              <input aria-label={`${id} secret name`} className={cx(inputCx, 'ac-mono')} value={draft.apiKeySecret} onChange={(e) => setDraft({ ...draft, apiKeySecret: e.target.value })} />
            </Field>
            <Field label="auth">
              <select aria-label={`${id} auth`} className={cx(inputCx, 'ac-mono')} value={draft.auth} onChange={(e) => setDraft({ ...draft, auth: e.target.value })}>
                <option value="bearer">bearer</option>
                <option value="none">none</option>
                <option value="header:api-key">header:api-key</option>
              </select>
            </Field>
            <Field label="headers" hint="One Name: value per line.">
              <textarea aria-label={`${id} headers`} className={cx(inputCx, 'ac-mono h-16 py-1.5')} value={draft.headersText} onChange={(e) => setDraft({ ...draft, headersText: e.target.value })} />
            </Field>
            <Field label="query" hint="One name: value per line (Azure's api-version).">
              <textarea aria-label={`${id} query`} className={cx(inputCx, 'ac-mono h-16 py-1.5')} value={draft.queryText} onChange={(e) => setDraft({ ...draft, queryText: e.target.value })} />
            </Field>
            <Field label="compat" hint="JSON object, merged over the preset.">
              <textarea aria-label={`${id} compat`} className={cx(inputCx, 'ac-mono h-20 py-1.5')} value={draft.compatText} onChange={(e) => setDraft({ ...draft, compatText: e.target.value })} />
            </Field>
            <Field label="params" hint="JSON object of provider-default parameters.">
              <textarea aria-label={`${id} params`} className={cx(inputCx, 'ac-mono h-20 py-1.5')} value={draft.paramsText} onChange={(e) => setDraft({ ...draft, paramsText: e.target.value })} />
            </Field>
            <Field label="concurrency limit">
              <input aria-label={`${id} concurrency`} type="number" min={1} className={cx(inputCx, 'ac-mono')} value={draft.maxConcurrentRuns} onChange={(e) => setDraft({ ...draft, maxConcurrentRuns: e.target.value })} />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="connect ms">
                <input aria-label={`${id} connect timeout`} type="number" min={1} className={cx(inputCx, 'ac-mono')} value={draft.connectMs} onChange={(e) => setDraft({ ...draft, connectMs: e.target.value })} />
              </Field>
              <Field label="idle ms">
                <input aria-label={`${id} idle timeout`} type="number" min={1} className={cx(inputCx, 'ac-mono')} value={draft.idleMs} onChange={(e) => setDraft({ ...draft, idleMs: e.target.value })} />
              </Field>
              <Field label="request ms">
                <input aria-label={`${id} request timeout`} type="number" min={1} className={cx(inputCx, 'ac-mono')} value={draft.requestMs} onChange={(e) => setDraft({ ...draft, requestMs: e.target.value })} />
              </Field>
            </div>
          </div>
          <label className="flex items-center gap-2 text-micro text-text-2">
            <input type="checkbox" aria-label={`${id} discover models`} checked={draft.discover} onChange={(e) => setDraft({ ...draft, discover: e.target.checked })} />
            Discover models from the endpoint
          </label>
          <SecretRow id={id} secretName={profile.apiKeySecret} configured={secretConfigured} pending={set.isPending || clear.isPending}
            onSet={(value) => set.mutate({ id, value })} onClear={() => clear.mutate(id)} />
          {error ? <span role="alert" className="text-micro text-failed">{error}</span> : null}
          {test.isError ? <span role="alert" className="text-micro text-failed">{test.error.message}</span> : null}
          {report ? <TestResult report={report} onApply={applyDetected} /> : null}
          <div className="flex justify-end gap-2">
            <Button size="sm" disabled={test.isPending} onClick={() => test.mutate({ id }, { onSuccess: (r) => setReport(r) })}>{test.isPending ? 'Testing…' : 'Test connection'}</Button>
            <Button size="sm" variant="primary" onClick={save}>Save</Button>
            {confirmRemove ? (
              <>
                <Button size="sm" variant="danger" onClick={onRemove}>Confirm remove</Button>
                <Button size="sm" onClick={() => setConfirmRemove(false)}>Cancel</Button>
              </>
            ) : <Button size="sm" variant="danger" onClick={() => setConfirmRemove(true)}>Remove</Button>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AddProvider({ presets, onAdd, onCancel }: {
  presets: T.PresetSummary[]; onAdd: (id: string, profile: T.ProviderProfile) => void; onCancel: () => void;
}): React.ReactElement {
  const [id, setId] = useState('');
  const [preset, setPreset] = useState(presets[0]?.id ?? 'openai-compatible');
  const [baseUrl, setBaseUrl] = useState(PRESET_BASE_URLS[presets[0]?.id ?? ''] ?? '');
  const choosePreset = (next: string): void => {
    setPreset(next);
    if (!baseUrl.trim()) setBaseUrl(PRESET_BASE_URLS[next] ?? '');
  };
  const valid = /^[a-z][a-z0-9-]*$/.test(id.trim()) && baseUrl.trim().length > 0;
  const add = (): void => {
    onAdd(id.trim(), {
      ...(preset ? { preset } : {}),
      baseUrl: baseUrl.trim(),
      apiKeySecret: secretNameFor(id.trim()),
      auth: 'bearer',
      headers: {},
      discover: true,
      models: {},
    });
  };
  return (
    <div className="v2-card flex flex-col gap-3 p-3">
      <span className="ac-label">Add a provider</span>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="id" hint="Lower-case kebab-case; the providers: key.">
          <input aria-label="New provider id" className={cx(inputCx, 'ac-mono')} value={id} placeholder="openrouter" onChange={(e) => setId(e.target.value)} />
        </Field>
        <Field label="preset">
          <select aria-label="New provider preset" className={cx(inputCx, 'ac-mono')} value={preset} onChange={(e) => choosePreset(e.target.value)}>
            {presets.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
          </select>
        </Field>
        <Field label="base URL">
          <input aria-label="New provider base URL" className={cx(inputCx, 'ac-mono')} value={baseUrl} placeholder="https://…/v1" onChange={(e) => setBaseUrl(e.target.value)} />
        </Field>
      </div>
      <p className="text-micro text-text-3">
        {presets.find((p) => p.id === preset)?.description ?? 'Base compat flags are filled from the preset.'}
        {' '}The key is taken under <code className="ac-mono">{secretNameFor(id.trim() || 'provider')}</code>; set it after saving.
      </p>
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!valid} onClick={add}>Add provider</Button>
      </div>
    </div>
  );
}

export function ProvidersSection(): React.ReactElement {
  const providers = useProviders();
  const save = useSaveProvider();
  const remove = useDeleteProvider();
  const [adding, setAdding] = useState(false);
  if (providers.isLoading) return <SkeletonRows rows={3} />;
  if (providers.isError) return <p className="text-micro text-text-3">The workspace's providers could not be read: {providers.error.message}</p>;
  const list = providers.data?.providers ?? [];
  const presets = providers.data?.presets ?? [];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-micro leading-relaxed text-text-3">
        Providers for the built-in <span className="ac-mono">weave</span> runtime. Repository content is sent to
        whichever endpoint you configure here; no default provider ships, so nothing leaves this machine until
        you add one and point a model at it.
      </p>
      <div className="flex items-baseline gap-2">
        <span className="ac-label text-text-1">Providers</span>
        <div className="flex-1" />
        <button type="button" className="v2-link text-micro" onClick={() => setAdding((v) => !v)}>+ Add from a preset</button>
      </div>
      {list.length === 0 && !adding ? <p className="text-micro text-text-3">None configured.</p> : null}
      {list.map((p) => (
        <ProviderRow key={p.id} view={p}
          onSave={async (profile) => { await save.mutateAsync({ id: p.id, profile }); }}
          onRemove={() => remove.mutate(p.id)} />
      ))}
      {adding && presets.length > 0 ? (
        <AddProvider presets={presets} onCancel={() => setAdding(false)}
          onAdd={(id, profile) => void save.mutateAsync({ id, profile }).then(() => setAdding(false))} />
      ) : null}
      {adding && presets.length === 0 ? <p className="text-micro text-text-3">No preset catalogue is available from the daemon.</p> : null}
      {save.isError ? <span role="alert" className="text-micro text-failed">{save.error.message}</span> : null}
    </div>
  );
}
