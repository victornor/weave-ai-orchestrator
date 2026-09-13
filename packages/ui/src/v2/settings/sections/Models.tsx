/**
 * The redesigned Models editor (VS-348, HANDOFF §9): runtime/model/thinking in one row per agent,
 * Weaver and Workers as two cards, worker options as collapsed rows, and the workspace overrides
 * with their tag, diff footer and reset.
 */
import { useEffect, useState } from 'react';
import { DEFAULT_MODEL_SETTING, WorkerModelOptionSchema, WorkerOptionsArraySchema } from '@weave-ai/shared';
import { useDaemonModels, useModels, useRuntimeModels, useRuntimes, useSetDaemonModels, useSetModels } from '../../../api/hooks';
import type * as T from '../../../api/types';
import { Button } from '../../../components/Button';
import { SkeletonRows } from '../../../components/Skeleton';
import { cx } from '../../../lib/cx';
import { isRuntimeAvailable, modelOptionLabel, runtimeStatusLabel } from '../../../lib/runtime';
import { effortModeFor, effortsForModel, isCustomModel, settingAfterModelChange } from '../model';
import { baselineAgent, countOverrides, diffOption, diffSetting, agentOverrideState, optionOverrideState } from '../override';

const inputCx = 'h-8 w-full rounded-r4 border border-line-2 bg-bg-input px-2 text-micro text-text-1 outline-none';

/** A text control that writes on blur or Enter, so a custom model id is not saved per keystroke. */
function CommitInput({ value, ariaLabel, placeholder, className, onCommit }: {
  value: string; ariaLabel: string; placeholder?: string; className?: string; onCommit: (v: string) => void;
}): React.ReactElement {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      aria-label={ariaLabel}
      className={className ?? inputCx}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onCommit(draft); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

/** One agent's runtime / model / thinking, side by side in one row. */
function ModelControls({ label, setting, runtimes, recessed, onChange }: {
  label: string; setting: T.ModelSetting; runtimes: T.RuntimeInfo[]; recessed?: boolean; onChange: (next: T.ModelSetting) => void;
}): React.ReactElement {
  const models = useRuntimeModels(setting.runtime);
  const known = models.data ?? [];
  const [freeText, setFreeText] = useState(false);
  const custom = freeText || isCustomModel(setting.model, known);
  const effmode = effortModeFor(effortsForModel(setting.model, known, custom), setting.effort);
  const ctl = cx(inputCx, 'ac-mono', recessed && 'bg-bg-2 text-text-2');
  const col = 'flex flex-col gap-1';
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <div className={col}>
        <span className="ac-label">runtime</span>
        <select aria-label={`${label} runtime`} className={ctl} value={setting.runtime}
          onChange={(e) => { setFreeText(false); onChange({ ...setting, runtime: e.target.value, effort: undefined }); }}>
          {runtimes.map((r) => (
            <option key={r.id} value={r.id} disabled={!isRuntimeAvailable(r)}>
              {r.displayName}{isRuntimeAvailable(r) ? '' : ` (${runtimeStatusLabel(r)})`}
            </option>
          ))}
          {runtimes.some((r) => r.id === setting.runtime) ? null : <option value={setting.runtime}>{setting.runtime} (not installed)</option>}
        </select>
      </div>
      <div className={col}>
        <span className="ac-label">model</span>
        <select aria-label={`${label} model`} className={ctl} value={custom ? '__other' : setting.model ?? ''}
          onChange={(e) => {
            if (e.target.value === '__other') { setFreeText(true); return; }
            setFreeText(false);
            onChange(settingAfterModelChange(setting, e.target.value === '' ? null : e.target.value, known));
          }}>
          <option value="">default (the runtime chooses)</option>
          {known.map((m) => <option key={m.id} value={m.id}>{modelOptionLabel(m)}</option>)}
          <option value="__other">something else…</option>
        </select>
        {custom ? (
          <CommitInput ariaLabel={`${label} model id`} placeholder="model id" value={setting.model ?? ''}
            onCommit={(v) => onChange(settingAfterModelChange(setting, v.trim() || null, known))} />
        ) : null}
      </div>
      <div className={col}>
        <span className="ac-label">thinking</span>
        {effmode === 'picker' ? (
          <select aria-label={`${label} thinking level`} className={ctl} value={setting.effort ?? ''}
            onChange={(e) => onChange({ ...setting, effort: e.target.value === '' ? undefined : e.target.value })}>
            <option value="">default (unset)</option>
            {effortsForModel(setting.model, known, custom)!.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        ) : effmode === 'freetext' ? (
          <CommitInput ariaLabel={`${label} thinking level`} placeholder="effort" value={setting.effort ?? ''}
            onCommit={(v) => onChange({ ...setting, effort: v.trim() || undefined })} />
        ) : (
          <span className="text-micro text-text-3">not configurable</span>
        )}
      </div>
    </div>
  );
}

function OverrideTag({ state }: { state: 'inherited' | 'overridden' }): React.ReactElement {
  return <span className="v2-tag" style={{ color: state === 'overridden' ? 'var(--accent-link)' : 'var(--text-3)' }}>{state}</span>;
}

/* ------------------------------------------------------------------ daemon */

export function DaemonModelsSection(): React.ReactElement {
  const overlays = useDaemonModels();
  const save = useSetDaemonModels();
  const runtimes = useRuntimes();
  if (overlays.isLoading) return <SkeletonRows rows={4} />;
  const current = overlays.data;
  const list = runtimes.data ?? [];
  const filled = (k: 'weaver' | 'workers'): boolean => current?.[k] != null;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-micro leading-relaxed text-text-3">
        The default for every workspace. A workspace that sets its own models overrides this. An empty
        control falls back to the built-in default (claude, no model chosen).
      </p>
      {(['weaver', 'workers'] as const).map((k) => {
        const setting = current?.[k] ?? DEFAULT_MODEL_SETTING;
        return (
          <div key={k} className="v2-card flex flex-col gap-2 p-3.5">
            <div className="flex items-baseline gap-2">
              <span className="text-meta font-medium text-text-1">{k === 'weaver' ? 'Weaver' : 'Workers'}</span>
              <span className="min-w-0 flex-1 text-micro text-text-3">
                {k === 'weaver' ? 'One per workspace. Reads every approval before you do.' : 'The default a ticket runs on when it names no option.'}
              </span>
              {filled(k) ? (
                <button type="button" className="v2-link text-micro" onClick={() => save.mutate({ [k]: null })}>Reset</button>
              ) : null}
            </div>
            <ModelControls label={k} setting={setting} runtimes={list} recessed={!filled(k)} onChange={(next) => save.mutate({ [k]: next })} />
          </div>
        );
      })}
      <WorkerOptionsEditor options={current?.workerOptions ?? []} runtimes={list}
        onSave={(next) => save.mutate({ workerOptions: next.length > 0 ? next : null })} />
    </div>
  );
}

/* --------------------------------------------------------------- workspace */

export function WorkspaceModelsSection(): React.ReactElement {
  const models = useModels();
  const daemon = useDaemonModels();
  const save = useSetModels();
  const runtimes = useRuntimes();
  if (models.isLoading) return <SkeletonRows rows={4} />;
  const effective = models.data;
  if (!effective) return <p className="text-micro text-text-3">The workspace's model settings could not be read.</p>;
  const list = runtimes.data ?? [];
  const counts = countOverrides(effective, daemon.data);
  const total = counts.agents + counts.options;
  return (
    <div className="flex flex-col gap-4">
      <div className="v2-recessed flex items-center gap-2 rounded-r4 border border-line-1 px-3 py-2">
        <span className="size-1.5 flex-none rounded-pill bg-text-3" aria-hidden />
        <p className="text-micro text-text-2">
          {total === 0
            ? 'All models inherit the daemon.'
            : `Overridden here: ${counts.agents} agent${counts.agents === 1 ? '' : 's'}, ${counts.options} worker option${counts.options === 1 ? '' : 's'}.`}
        </p>
      </div>
      {(['weaver', 'workers'] as const).map((k) => {
        const setting = effective[k];
        const baseline = baselineAgent(daemon.data, k);
        const state = agentOverrideState(setting, baseline);
        const diff = diffSetting(setting, baseline);
        return (
          <div key={k} className={cx('v2-card flex flex-col gap-2 p-3.5', state === 'overridden' && 'border-accent-edge')}>
            <div className="flex items-baseline gap-2">
              <span className="text-meta font-medium text-text-1">{k === 'weaver' ? 'Weaver' : 'Workers'}</span>
              <OverrideTag state={state} />
              <span className="min-w-0 flex-1 text-micro text-text-3">
                {k === 'weaver' ? 'One per workspace. Reads every approval before you do.' : 'The default a ticket runs on when it names no option.'}
              </span>
              {state === 'overridden' ? (
                <button type="button" className="v2-link text-micro" onClick={() => save.mutate({ ...effective, [k]: baseline })}>Reset to daemon</button>
              ) : null}
            </div>
            <ModelControls label={k} setting={setting} runtimes={list} recessed={state === 'inherited'}
              onChange={(next) => save.mutate({ ...effective, [k]: next })} />
            <p className="text-micro text-text-3">{state === 'overridden' ? `Overrides ${diff.join(', ')}.` : 'Inherited from the daemon.'}</p>
          </div>
        );
      })}
      <WorkspaceOptions effective={effective} daemon={daemon.data} runtimes={list}
        onSave={(next) => save.mutate({ ...effective, workerOptions: next })} />
    </div>
  );
}

/* ---------------------------------------------------------- worker options */

function optionSummary(o: T.WorkerModelOption): string {
  return o.description;
}

function modelTag(o: T.WorkerModelOption): string {
  return o.model ?? (o.runtime ? `${o.runtime} default` : 'not chosen');
}

function WorkerOptionsEditor({ options, runtimes, onSave }: {
  options: T.WorkerModelOption[]; runtimes: T.RuntimeInfo[]; onSave: (next: T.WorkerModelOption[]) => void;
}): React.ReactElement {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState(false);
  const toggle = (id: string): void => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="ac-label text-text-1">Worker options</span>
        <div className="flex-1" />
        <button type="button" className="v2-link text-micro" onClick={() => setAdding((v) => !v)}>+ Add option</button>
      </div>
      <p className="text-micro text-text-3">The weaver picks one per ticket by reading these descriptions. Workers above is the default when none matches.</p>
      {options.length === 0 && !adding ? <p className="text-micro text-text-3">None yet.</p> : null}
      {options.map((o) => (
        <OptionRow key={o.id} option={o} runtimes={runtimes} open={open.has(o.id)} onToggle={() => toggle(o.id)}
          onSave={(next) => onSave(options.map((x) => (x.id === o.id ? next : x)))}
          onRemove={() => onSave(options.filter((x) => x.id !== o.id))} />
      ))}
      {adding ? (
        <NewOption runtimes={runtimes} existing={options}
          onAdd={(opt) => { onSave([...options, opt]); setAdding(false); }}
          onCancel={() => setAdding(false)} />
      ) : null}
    </div>
  );
}

function OptionRow({ option, runtimes, open, onToggle, onSave, onRemove }: {
  option: T.WorkerModelOption; runtimes: T.RuntimeInfo[]; open: boolean; onToggle: () => void;
  onSave: (next: T.WorkerModelOption) => void; onRemove: () => void;
}): React.ReactElement {
  const configured = option.runtime != null;
  const [draft, setDraft] = useState(option.description);
  useEffect(() => setDraft(option.description), [option.description]);
  const max = WorkerModelOptionSchema.shape.description.maxLength;
  const over = max != null && draft.trim().length > max;
  const patch = (next: T.WorkerModelOption): void => onSave(next);
  return (
    <div className="v2-card flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open} onClick={onToggle}>
          <span className="ac-mono text-meta text-text-1">{option.id}</span>
          <span className="v2-tag text-text-2">{modelTag(option)}</span>
          <span className="truncate text-micro text-text-3">{optionSummary(option)}</span>
          <span className="ml-auto text-text-3" aria-hidden>{open ? '▾' : '▸'}</span>
        </button>
      </div>
      {open ? (
        <div className="flex flex-col gap-3 border-t border-line-1 p-3">
          <div className="flex flex-col gap-1">
            <span className="ac-label">When the weaver should pick this</span>
            <textarea aria-label={`${option.id} description`} className={cx(inputCx, 'h-16 py-1.5')} value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => { const next = draft.trim(); if (next && next !== option.description && !over) patch({ ...option, description: next }); }}
            />
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 text-micro text-text-3">Write it as a rule, not a mood. The weaver reads this and nothing else.</span>
              <span className={cx('ac-mono text-nano', over ? 'text-failed' : 'text-text-3')}>{draft.trim().length} / {max ?? 200}</span>
            </div>
          </div>
          <ModelControls label={option.id} setting={{ runtime: option.runtime ?? runtimes[0]?.id ?? 'claude', model: option.model, ...(option.effort !== undefined ? { effort: option.effort } : {}) }}
            runtimes={runtimes} recessed={!configured}
            onChange={(next) => patch({ ...option, runtime: next.runtime, model: next.model, effort: next.effort })} />
          <div className="flex justify-end">
            <Button size="sm" variant="danger" onClick={onRemove}>Remove</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NewOption({ runtimes, existing, onAdd, onCancel }: {
  runtimes: T.RuntimeInfo[]; existing: T.WorkerModelOption[]; onAdd: (o: T.WorkerModelOption) => void; onCancel: () => void;
}): React.ReactElement {
  const [id, setId] = useState('');
  const [description, setDescription] = useState('');
  const [setting, setSetting] = useState<T.ModelSetting>({ runtime: runtimes[0]?.id ?? 'claude', model: null });
  const candidate = { id: id.trim(), description: description.trim(), runtime: setting.runtime, model: setting.model, ...(setting.effort ? { effort: setting.effort } : {}) };
  const field = WorkerModelOptionSchema.safeParse(candidate);
  const list = WorkerOptionsArraySchema.safeParse([...existing, candidate]);
  const valid = field.success && list.success;
  return (
    <div className="v2-card flex flex-col gap-3 p-3">
      <span className="ac-label">New option</span>
      <label className="flex flex-col gap-1">
        <span className="text-micro text-text-2">id (kebab-case)</span>
        <input aria-label="New option id" className={cx(inputCx, 'ac-mono')} value={id} onChange={(e) => setId(e.target.value)} placeholder="quick" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-micro text-text-2">When to use</span>
        <textarea aria-label="New option description" className={cx(inputCx, 'h-16 py-1.5')} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <ModelControls label="new option" setting={setting} runtimes={runtimes} onChange={setSetting} />
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!valid} onClick={() => onAdd(candidate as T.WorkerModelOption)}>Add</Button>
      </div>
    </div>
  );
}

function WorkspaceOptions({ effective, daemon, runtimes, onSave }: {
  effective: T.WorkspaceModels; daemon: T.DaemonModels | undefined; runtimes: T.RuntimeInfo[]; onSave: (next: T.WorkerModelOption[]) => void;
}): React.ReactElement {
  const daemonOptions = daemon?.workerOptions ?? [];
  const wsOptions = effective.workerOptions ?? [];
  const list = daemonOptions.length > 0 ? daemonOptions : wsOptions;
  const overridden = list.filter((o) => optionOverrideState(wsOptions.find((w) => w.id === o.id) ?? o, daemonOptions.length ? o : undefined) === 'overridden').length;
  if (list.length === 0) return <p className="text-micro text-text-3">No worker options are configured on the daemon.</p>;
  const edit = (base: T.WorkerModelOption, next: T.ModelSetting): void => {
    onSave(list.map((o) => {
      const existing = wsOptions.find((w) => w.id === o.id) ?? o;
      return o.id === base.id ? { ...o, runtime: next.runtime, model: next.model, effort: next.effort } : existing;
    }));
  };
  const reset = (base: T.WorkerModelOption): void => {
    onSave(list.map((o) => (o.id === base.id ? o : (wsOptions.find((w) => w.id === o.id) ?? o))));
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="ac-label text-text-1">Worker options</span>
        <div className="flex-1" />
        <span className="ac-mono text-micro text-text-3">{overridden} of {list.length} overridden</span>
      </div>
      <p className="text-micro text-text-3">The list is the daemon's. A workspace can change which model an option runs on — not what the option means, since the weaver picks by description.</p>
      {list.map((base) => {
        const current = wsOptions.find((w) => w.id === base.id) ?? base;
        const state = optionOverrideState(current, daemonOptions.length ? base : undefined);
        const diff = diffOption(current, daemonOptions.length ? base : undefined);
        return (
          <div key={base.id} className={cx('v2-card flex flex-col gap-2 p-3', state === 'overridden' && 'border-accent-edge')}>
            <div className="flex items-baseline gap-2">
              <span className="ac-mono text-meta text-text-1">{base.id}</span>
              <OverrideTag state={state} />
              <span className="min-w-0 flex-1 text-micro text-text-3">{base.description}</span>
              {state === 'overridden' ? (
                <button type="button" className="v2-link text-micro" onClick={() => reset(base)}>Reset to daemon</button>
              ) : null}
            </div>
            <ModelControls label={base.id} setting={{ runtime: current.runtime ?? base.runtime ?? runtimes[0]?.id ?? 'claude', model: current.model, ...(current.effort !== undefined ? { effort: current.effort } : {}) }}
              runtimes={runtimes} recessed={state === 'inherited'}
              onChange={(next) => edit(base, next)} />
            <p className="text-micro text-text-3">{state === 'overridden' ? `Overrides ${diff.join(', ')}.` : 'Inherited from the daemon.'}</p>
          </div>
        );
      })}
    </div>
  );
}
