import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Page, PageBody, PageHeader } from '../components/Page';
import { Segmented, Tabs } from '../components/Tabs';
import { Button } from '../components/Button';
import { Badge } from '../components/StatusGlyph';
import { DeviceRow } from '../components/DeviceRow';
import { QR } from '../components/QR';
import { TOTPInput } from '../components/TOTPInput';
import { SkeletonRows } from '../components/Skeleton';
import { ErrorState, EmptyState } from '../components/States';
import { useToast } from '../components/Toast';
import {
  useAddProject,
  useAuthSessions,
  useCancelUpgrade,
  useDaemonUpdate,
  useDaemonUpgrade,
  useMe,
  useModels,
  usePatchConfig,
  usePatchProject,
  usePresentation,
  usePresentationSurfaces,
  useProjects,
  usePutPresentation,
  useRefreshDaemonUpdate,
  useRequestUpgrade,
  useRuntimeModels,
  useRuntimes,
  useSetModels,
  useWorkspaceSummary,
  useWorkspaces,
} from '../api/hooks';
import { api, setToken } from '../api/client';
import { qk } from '../api/keys';
import type { PresentationBlock } from '@agent-conductor/shared';
import type * as T from '../api/types';
import type { TotpSetup } from '../api/types';
import { useWs } from '../api/context';
import { useGo, useSearchParams } from '../app/link';
import { useTheme } from '../lib/theme';
import { readShowSilentTurns, writeShowSilentTurns } from '../lib/chatPrefs';
import { useDictationDiagnosticsEnabled, writeDictationDiagnosticsEnabled } from '../lib/dictationDiagnostics';
import { isRuntimeAvailable, runtimeStatusLabel } from '../lib/runtime';
import { UPGRADE_STAGE_LABEL, inFlight, isCancellableUpgrade, isRestarting, shortSha, updateEntry, updateEntryLabel } from '../lib/upgrade';
import { cx } from '../lib/cx';
import { workspaceYolo } from '../lib/yolo';
import { SETTINGS_AREAS, firstSectionOf, resolveSettingsLocation, sectionsOfArea } from '../lib/settings';
import { disablePush, enablePush, subscriptionId } from '../lib/push';

/**
 * Settings is two areas: what belongs to this workspace, and what belongs to this daemon and so
 * reads the same from every workspace. The area and the section are both in the URL, and a link
 * naming only a section resolves its own area — see `resolveSettingsLocation`, which is what keeps
 * the rail's `?section=updates` entry working without naming an area.
 */
export function SettingsRoute(): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const search = useSearchParams();
  // The URL is the entry point and the tabs write back to it, but the tab click stays local state so
  // the section switches on the click rather than a router round-trip. Same shape as the board filters.
  // The area always follows the section, so one piece of state carries both.
  const [section, setSection] = useState<string>(() => resolveSettingsLocation({ area: search['area'], section: search['section'] }).section);
  useEffect(() => {
    setSection(resolveSettingsLocation({ area: search['area'], section: search['section'] }).section);
  }, [search['area'], search['section']]);
  const area = resolveSettingsLocation({ section }).area;

  // `replace`, so clicking through six sections leaves one history entry rather than six.
  const choose = (key: string): void => {
    const next = resolveSettingsLocation({ section: key });
    setSection(next.section);
    go('/w/$ws/settings', { params: { ws }, search: { ...search, area: next.area, section: next.section }, replace: true });
  };

  const update = useDaemonUpdate();
  const upgrade = useDaemonUpgrade();
  const entry = updateEntry(update.data, upgrade.data?.upgrade ?? null);

  return (
    <Page>
      <PageHeader
        title="Settings"
        actions={
          <Segmented
            ariaLabel="Settings area"
            options={SETTINGS_AREAS.map((a) => ({ value: a.key, label: a.label }))}
            value={area}
            onChange={(next) => choose(firstSectionOf(next))}
          />
        }
        tabs={<Tabs items={sectionsOfArea(area)} active={section} onChange={choose} className="px-3 md:px-4" />}
      />
      <PageBody className="p-4 md:p-5">
        <div className="mx-auto max-w-3xl">
          {/* Phone only: the rail block carries this on desktop, and one fact gets one entry. */}
          {entry && section !== 'updates' ? (
            <button
              type="button"
              onClick={() => choose('updates')}
              aria-label={updateEntryLabel(entry)}
              className="mb-4 flex w-full items-center gap-2.5 rounded-r6 border border-accent-edge bg-accent-tint px-3.5 py-2.5 text-left md:hidden"
            >
              <span className={cx('size-1.5 flex-none rounded-pill', entry.state === 'upgrading' ? 'bg-merging' : 'bg-needs-you')} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-meta font-medium text-text-1">{entry.title}</span>
                <span className="ac-mono block truncate text-nano text-text-3">{entry.detail}</span>
              </span>
              <span className="flex-none text-micro font-medium text-accent-link">Open Updates</span>
            </button>
          ) : null}
          {section === 'workspace' ? <WorkspaceSection /> : null}
          {section === 'projects' ? <ProjectsSection /> : null}
          {section === 'models' ? <ModelsSection /> : null}
          {section === 'channels' ? <ChannelsSection /> : null}
          {section === 'presentation' ? <PresentationSection /> : null}
          {section === 'security' ? <SecuritySection /> : null}
          {section === 'device' ? <DeviceSection /> : null}
          {section === 'updates' ? <UpdatesSection /> : null}
        </div>
      </PageBody>
    </Page>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <label className="flex flex-col gap-1.5 py-2.5">
      <span className="ac-label">{label}</span>
      {children}
      {hint ? <span className="text-micro text-text-3">{hint}</span> : null}
    </label>
  );
}

const inputCx = 'h-9 w-full rounded-r6 border border-line-2 bg-bg-input px-3 text-body text-text-1 outline-none';

/** A project's YOLO override as the select's value: unset means it follows the workspace. */
function yoloOverrideOf(policies: Record<string, unknown> | undefined): 'inherit' | 'on' | 'off' {
  const raw = policies?.['yolo'];
  return raw === true ? 'on' : raw === false ? 'off' : 'inherit';
}

/** The project's policies with the override set, or with the key gone when it goes back to inherit. */
function withYolo(policies: Record<string, unknown> | undefined, choice: string): Record<string, unknown> {
  const { yolo: _dropped, ...rest } = policies ?? {};
  return choice === 'inherit' ? rest : { ...rest, yolo: choice === 'on' };
}

function WorkspaceSection(): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const summary = useWorkspaceSummary();
  const workspaces = useWorkspaces();
  const patch = usePatchConfig();
  const [name, setName] = useState('');
  /** The daemon answers `/w/:ws` with the workspace's canonical id, whichever form the URL used. */
  const activeId = summary.data?.workspace.id ?? ws;

  if (summary.isLoading) return <SkeletonRows rows={4} />;

  return (
    <div className="flex flex-col gap-5">
      {/* First on the page: on a phone the bottom bar has no room for a workspace list, so More —
          which opens Settings — is where the other workspaces are reached. */}
      <section>
        <div className="ac-label mb-2">Workspaces</div>
        <div className="ac-card divide-y divide-line-1">
          {(workspaces.data ?? []).map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => go(`/w/${w.id}/needs`)}
              className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-bg-2"
            >
              <span className="flex-1 text-meta text-text-1">{w.name}</span>
              {w.needsYou > 0 ? (
                <span className="ac-mono text-nano text-needs-you" aria-label={`${w.needsYou} waiting for you`}>{w.needsYou}</span>
              ) : null}
              <span className="ac-mono text-micro text-text-3">{w.ticketPrefix}</span>
              {w.id === activeId && <Badge tone="accent">current</Badge>}
            </button>
          ))}
        </div>
      </section>

      <section>
        <Field label="Name">
          <input
            className={inputCx}
            defaultValue={summary.data?.workspace.name ?? ''}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name && patch.mutate({ name })}
          />
        </Field>
        <Field label="Ticket prefix" hint="Used for every identifier in this workspace.">
          <input className={cx(inputCx, 'ac-mono')} defaultValue={summary.data?.workspace.ticketPrefix ?? ''} readOnly />
        </Field>
      </section>

      <YoloSection config={summary.data?.config ?? {}} />

      <KnowledgeBudgetsSection config={summary.data?.config ?? {}} />

    </div>
  );
}

/**
 * YOLO mode: the daemon grants plan and merge approvals itself (PLAN §15). Off by default, and
 * deliberate to turn on, so the copy says plainly what stops happening and what does not.
 */
function YoloSection({ config }: { config: Record<string, unknown> }): React.ReactElement {
  const patch = usePatchConfig();
  const toast = useToast();
  const on = workspaceYolo(config);

  return (
    <section>
      <div className="ac-label mb-2">YOLO mode</div>
      <div className={cx('ac-card flex items-start gap-3 p-3.5', on && 'border-needs-you/40')}>
        <div className="flex-1">
          <p className="text-meta text-text-1">
            Plan approvals and merge approvals are granted by the daemon instead of by you: the plan as soon as it validates,
            the merge as soon as the PR&apos;s checks are green. Each is recorded as answered by the system.
          </p>
          <p className="mt-1.5 text-micro text-text-3">
            Hires, discards, retries and questions still come to you. Nothing skips CI, the merge queue or the landing check.
            A project can override this either way in Projects.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="YOLO mode"
          onClick={() =>
            patch.mutate(
              { defaults: { yolo: !on } },
              { onError: (e) => toast.push({ title: 'Could not change YOLO mode', detail: e.message, status: 'failed' }) },
            )
          }
          className={cx(
            'mt-0.5 h-7 shrink-0 rounded-r6 border px-3 text-meta font-medium',
            on ? 'border-needs-you/50 bg-needs-you/15 text-needs-you' : 'border-line-2 text-text-3',
          )}
        >
          {on ? 'On' : 'Off'}
        </button>
      </div>
    </section>
  );
}

/** The knowledge budgets, in tokens. A budget is what curation is triggered at, so the human owns it. */
const BUDGET_FIELDS = [
  { key: 'project', label: 'Project knowledge base', hint: 'Each PROJECT.md. Injected in full into every worker of that project.' },
  { key: 'document', label: 'Linked document', hint: 'Each [[slug]] page. Read on demand, never injected.' },
  { key: 'workspace', label: 'Workspace knowledge base', hint: 'WORKSPACE.md. Conductor only.' },
  { key: 'shared', label: 'Shared conventions', hint: 'SHARED.md. Read by every agent, so it costs the most per token.' },
  { key: 'decisions', label: 'Decision log', hint: 'decisions.md. Appended by the daemon; only its last 30 lines reach a digest.' },
] as const;

function KnowledgeBudgetsSection({ config }: { config: Record<string, unknown> }): React.ReactElement {
  const patch = usePatchConfig();
  const toast = useToast();
  const defaults = (config['defaults'] ?? {}) as Record<string, unknown>;
  const budgets = (defaults['knowledgeBudgetTokens'] ?? {}) as Record<string, number | undefined>;

  const save = (body: Record<string, unknown>, current: number | undefined, next: number): void => {
    if (!Number.isInteger(next) || next < 500 || next === current) return;
    patch.mutate(body, { onError: (e) => toast.push({ title: 'Could not save the budget', detail: e.message, status: 'failed' }) });
  };

  return (
    <section>
      <div className="ac-label mb-2">Knowledge budgets</div>
      <p className="mb-1 text-micro text-text-3">
        In tokens. A file over 80 % of its budget schedules a curation run; a write that would cross it is rejected.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {BUDGET_FIELDS.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            <input
              type="number"
              min={500}
              step={500}
              aria-label={f.label}
              className={cx(inputCx, 'ac-mono')}
              defaultValue={budgets[f.key] ?? ''}
              onBlur={(e) => save({ defaults: { knowledgeBudgetTokens: { [f.key]: Number(e.target.value) } } }, budgets[f.key], Number(e.target.value))}
            />
          </Field>
        ))}
        <Field label="Bootstrap digest" hint="The knowledge injected on an agent's first turn. Keep it above shared + project.">
          <input
            type="number"
            min={500}
            step={1000}
            aria-label="Bootstrap digest"
            className={cx(inputCx, 'ac-mono')}
            defaultValue={(defaults['bootstrapBudgetTokens'] as number | undefined) ?? ''}
            onBlur={(e) => save({ defaults: { bootstrapBudgetTokens: Number(e.target.value) } }, defaults['bootstrapBudgetTokens'] as number | undefined, Number(e.target.value))}
          />
        </Field>
      </div>
    </section>
  );
}

function ProjectsSection(): React.ReactElement {
  const projects = useProjects();
  const add = useAddProject();
  const patch = usePatchProject();
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [maxWorkers, setMaxWorkers] = useState(2);
  const [setupCommand, setSetupCommand] = useState('');
  const [autoMerge, setAutoMerge] = useState(false);
  const workspaceOn = workspaceYolo(useWorkspaceSummary().data?.config ?? {});

  return (
    <div className="flex flex-col gap-5">
      <section className="ac-card p-3.5">
        <div className="ac-label mb-2">Add a project</div>
        <Field label="Git URL" hint="Cloned into projects/<id>; nobody works in that clone.">
          <input className={cx(inputCx, 'ac-mono')} placeholder="git@github.com:acme/api.git" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Max workers">
            <input type="number" min={1} max={16} className={cx(inputCx, 'ac-mono')} value={maxWorkers} onChange={(e) => setMaxWorkers(Number(e.target.value))} />
          </Field>
          <Field label="Auto-merge default">
            <select className={cx(inputCx, 'ac-mono')} value={autoMerge ? 'on' : 'off'} onChange={(e) => setAutoMerge(e.target.value === 'on')}>
              <option value="off">off</option>
              <option value="on">on</option>
            </select>
          </Field>
        </div>
        <Field label="Setup command" hint="Run once per worktree before the first turn.">
          <input className={cx(inputCx, 'ac-mono')} placeholder="pnpm install" value={setupCommand} onChange={(e) => setSetupCommand(e.target.value)} />
        </Field>
        <Button
          variant="primary"
          disabled={!url || add.isPending}
          onClick={() =>
            add.mutate(
              { url, maxWorkers, ...(setupCommand ? { setupCommand } : {}), autoMerge },
              {
                onSuccess: () => {
                  toast.push({ title: 'Cloning…', detail: url, status: 'working' });
                  setUrl('');
                },
                onError: (e) => toast.push({ title: 'Could not add the project', detail: e.message, status: 'failed' }),
              },
            )
          }
        >
          Add project
        </Button>
      </section>

      {projects.isLoading ? (
        <SkeletonRows rows={3} />
      ) : (projects.data?.length ?? 0) === 0 ? (
        <EmptyState title="No projects yet." detail="Paste a git URL above, or ask the conductor to add one." />
      ) : (
        <div className="ac-card divide-y divide-line-1">
          {(projects.data ?? []).map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 px-3.5 py-3">
              <span className="ac-mono text-meta text-text-1">{p.slug}</span>
              <Badge>{p.status}</Badge>
              <span className="ac-mono ac-truncate flex-1 text-micro text-text-3">{p.gitUrl}</span>
              <label className="flex items-center gap-1.5">
                <span className="ac-label">workers</span>
                <input
                  type="number"
                  min={1}
                  defaultValue={p.maxWorkers}
                  onBlur={(e) => patch.mutate({ id: p.id, patch: { maxWorkers: Number(e.target.value) } })}
                  className="ac-mono h-7 w-14 rounded-r4 border border-line-2 bg-bg-input px-2 text-micro"
                />
              </label>
              <label className="flex items-center gap-1.5">
                <span className="ac-label">yolo</span>
                <select
                  aria-label={`YOLO mode for ${p.slug}`}
                  className="ac-mono h-7 rounded-r4 border border-line-2 bg-bg-input px-2 text-micro"
                  value={yoloOverrideOf(p.policies)}
                  onChange={(e) =>
                    // `policies` is replaced wholesale, so dropping the key is what clears the
                    // override and puts the project back on the workspace setting.
                    patch.mutate({ id: p.id, patch: { policies: withYolo(p.policies, e.target.value) } })
                  }
                >
                  <option value="inherit">{workspaceOn ? 'inherit (on)' : 'inherit (off)'}</option>
                  <option value="on">on</option>
                  <option value="off">off</option>
                </select>
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The whole of model selection (VS-77): two settings, each a runtime and a model. Nothing else in
 * the app offers a runtime or a model to choose, so this section is where an operator comes.
 */
function ModelsSection(): React.ReactElement {
  const models = useModels();
  const runtimes = useRuntimes();
  const save = useSetModels();

  if (models.isLoading) return <SkeletonRows rows={4} />;
  if (!models.data) return <ErrorState code="MODELS_UNREACHABLE" message="The workspace's model settings could not be read." />;

  const current = models.data;
  const set = (kind: 'conductor' | 'workers', next: T.ModelSetting): void => save.mutate({ ...current, [kind]: next });

  return (
    <div className="flex flex-col gap-5">
      <ModelSettingFields
        label="Conductor"
        hint="The agent you talk to. One per workspace."
        setting={current.conductor}
        runtimes={runtimes.data ?? []}
        onChange={(next) => set('conductor', next)}
      />
      <ModelSettingFields
        label="Workers"
        hint="Every worker in this workspace, whatever its role or project."
        setting={current.workers}
        runtimes={runtimes.data ?? []}
        onChange={(next) => set('workers', next)}
      />
      {save.error ? <ErrorState code="MODELS_NOT_SAVED" message={save.error.message} /> : null}
      <p className="text-micro leading-relaxed text-text-3">
        A change applies to the next turn each agent takes; a turn already running is not interrupted. Changing a runtime starts that agent on a
        new session, because a session belongs to the CLI that issued it.
      </p>
    </div>
  );
}

function ModelSettingFields({ label, hint, setting, runtimes, onChange }: {
  label: string;
  hint: string;
  setting: T.ModelSetting;
  runtimes: T.RuntimeInfo[];
  onChange: (next: T.ModelSetting) => void;
}): React.ReactElement {
  const models = useRuntimeModels(setting.runtime);
  const known = models.data ?? [];
  // A model the adapter does not list is still valid — several runtimes list nothing useful — so the
  // picker carries a "something else" entry that reveals a text box rather than losing the value.
  const [freeText, setFreeText] = useState(false);
  const custom = freeText || (setting.model !== null && known.length > 0 && !known.some((m) => m.id === setting.model));

  return (
    <div className="flex flex-col gap-1">
      <h3 className="ac-label text-text-1">{label}</h3>
      <p className="text-micro text-text-3">{hint}</p>
      <Field label="Runtime">
        <select
          className={cx(inputCx, 'ac-mono')}
          aria-label={`${label} runtime`}
          value={setting.runtime}
          onChange={(e) => onChange({ ...setting, runtime: e.target.value })}
        >
          {runtimes.map((r) => (
            <option key={r.id} value={r.id} disabled={!isRuntimeAvailable(r)}>
              {r.displayName}
              {isRuntimeAvailable(r) ? '' : ` (${runtimeStatusLabel(r)})`}
            </option>
          ))}
          {runtimes.some((r) => r.id === setting.runtime) ? null : <option value={setting.runtime}>{setting.runtime} (not installed)</option>}
        </select>
      </Field>
      <Field label="Model">
        <select
          className={cx(inputCx, 'ac-mono')}
          aria-label={`${label} model`}
          value={custom ? '__other' : setting.model ?? ''}
          onChange={(e) => {
            if (e.target.value === '__other') { setFreeText(true); return; }
            setFreeText(false);
            onChange({ ...setting, model: e.target.value === '' ? null : e.target.value });
          }}
        >
          <option value="">default (the runtime chooses)</option>
          {known.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
          <option value="__other">something else…</option>
        </select>
      </Field>
      {custom ? (
        <Field label={`${label} model id`} hint="A model this runtime offers that is not in the list.">
          <input
            className={cx(inputCx, 'ac-mono')}
            aria-label={`${label} model id`}
            defaultValue={setting.model ?? ''}
            onBlur={(e) => onChange({ ...setting, model: e.target.value.trim() === '' ? null : e.target.value.trim() })}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          />
        </Field>
      ) : null}
    </div>
  );
}

function ChannelsSection(): React.ReactElement {
  const summary = useWorkspaceSummary();
  const patch = usePatchConfig();
  const channels = (summary.data?.config?.['channels'] ?? {}) as Record<string, { enabled?: boolean; allowlist?: string[] }>;
  const telegram = channels['telegram'] ?? {};

  return (
    <div className="flex flex-col gap-3">
      <div className="ac-label">Telegram</div>
      <Field label="Enabled" hint="The bot token itself lives in the daemon's secrets, never here.">
        <select
          className={cx(inputCx, 'ac-mono')}
          value={telegram.enabled ? 'on' : 'off'}
          onChange={(e) => patch.mutate({ channels: { telegram: { ...telegram, enabled: e.target.value === 'on' } } })}
        >
          <option value="off">off</option>
          <option value="on">on</option>
        </select>
      </Field>
      <Field label="Allowlist" hint="Comma-separated Telegram user ids that may talk to the conductor.">
        <input
          className={cx(inputCx, 'ac-mono')}
          defaultValue={(telegram.allowlist ?? []).join(', ')}
          onBlur={(e) =>
            patch.mutate({ channels: { telegram: { ...telegram, allowlist: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } } })
          }
        />
      </Field>
    </div>
  );
}

function PresentationSection(): React.ReactElement {
  const presentation = usePresentation();
  const surfaces = usePresentationSurfaces();
  const put = usePutPresentation();
  if (presentation.isLoading) return <SkeletonRows rows={3} />;
  if (presentation.isError || !presentation.data) {
    return (
      <ErrorState
        code="PRESENTATION_UNAVAILABLE"
        message="The daemon did not return a presentation config."
        onRetry={() => void presentation.refetch()}
      />
    );
  }

  const config = presentation.data;
  // The registry list plus whatever is already configured, so a plugin surface this daemon has not
  // loaded still shows as the current choice instead of silently switching the select to something else.
  const options = [...new Set([...(surfaces.data?.surfaces ?? []), config.default])];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-meta leading-relaxed text-text-2">
        Presentation surfaces run on the presenter&apos;s machine, which need not be the daemon&apos;s. The daemon stores only the desired
        config; the presenter detects what is actually available there and reconciles windows locally.
      </p>
      <Field label="Default surface" hint="Used for every agent that has no surface of its own.">
        <select
          className={cx(inputCx, 'ac-mono')}
          value={config.default}
          disabled={put.isPending}
          onChange={(e) => put.mutate({ ...config, default: e.target.value })}
        >
          {options.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </Field>
      <dl className="ac-card divide-y divide-line-1">
        <PresentationBlockRow label="Conductor" block={config.conductor} fallback={config.default} />
        <PresentationBlockRow label="Workers" block={config.workers} fallback={config.default} />
      </dl>
    </div>
  );
}

/** One override block, read-only: the surface it pins plus whatever knobs the block carries. */
function PresentationBlockRow({ label, block, fallback }: { label: string; block?: PresentationBlock; fallback: string }): React.ReactElement {
  const detail = block
    ? Object.entries(block)
        .filter(([key, value]) => key !== 'surface' && value !== undefined)
        .map(([key, value]) => `${key}: ${String(value)}`)
    : [];
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <dt className="flex-1 text-meta text-text-1">{label}</dt>
      <dd className="flex items-center gap-2">
        {detail.length ? <span className="ac-mono text-micro text-text-3">{detail.join(' · ')}</span> : null}
        <span className="ac-mono text-micro text-text-2">{block?.surface ?? fallback}</span>
        {block?.surface ? null : <Badge tone="neutral">default</Badge>}
      </dd>
    </div>
  );
}

function SecuritySection(): React.ReactElement {
  const me = useMe();
  const sessions = useAuthSessions();
  const qc = useQueryClient();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [code, setCode] = useState('');
  const [pendingRevoke, setPendingRevoke] = useState<Set<string>>(new Set());

  const revoke = (id: string): void => {
    // 5 s undo before the request actually goes out.
    setPendingRevoke((s) => new Set(s).add(id));
    const timer = setTimeout(() => {
      void api.root(`/auth/sessions/${id}`, { method: 'DELETE' }).then(() => qc.invalidateQueries({ queryKey: qk.sessions() }));
      setPendingRevoke((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }, 5000);
    toast.push({
      title: 'Device revoked',
      detail: 'It will be signed out in 5 seconds.',
      status: 'failed',
      ttl: 5000,
      undo: {
        label: 'Undo',
        run: () => {
          clearTimeout(timer);
          setPendingRevoke((s) => {
            const n = new Set(s);
            n.delete(id);
            return n;
          });
        },
      },
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <section>
        <div className="ac-label mb-2">Change password</div>
        <Field label="Current password">
          <input type="password" className={inputCx} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="New password">
          <input type="password" className={inputCx} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </Field>
        <Button
          variant="primary"
          disabled={!current || next.length < 8}
          onClick={() =>
            void api
              .root('/auth/password', { method: 'POST', body: { current, next } })
              .then(() => {
                toast.push({ title: 'Password changed', status: 'done' });
                setCurrent('');
                setNext('');
              })
              .catch((e: Error) => toast.push({ title: 'Could not change the password', detail: e.message, status: 'failed' }))
          }
        >
          Change password
        </Button>
      </section>

      <section>
        <div className="ac-label mb-2">Two-factor authentication</div>
        {me.data?.totpEnabled ? (
          <div className="flex items-center gap-3">
            <Badge tone="added">enabled</Badge>
            <Button
              variant="danger"
              size="sm"
              onClick={() =>
                void api
                  .root('/auth/totp/disable', { method: 'POST', body: { password: current } })
                  .then(() => qc.invalidateQueries({ queryKey: qk.me() }))
                  .catch((e: Error) => toast.push({ title: 'Could not disable TOTP', detail: e.message, status: 'failed' }))
              }
            >
              Disable
            </Button>
            <span className="text-micro text-text-3">Enter your current password above first.</span>
          </div>
        ) : setup ? (
          <div className="flex flex-col gap-3 sm:flex-row">
            <QR text={setup.otpauthUrl} />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div>
                <div className="ac-label mb-1">Secret</div>
                <code className="ac-mono block break-all rounded-r4 border border-line-1 bg-bg-2 px-2 py-1.5 text-micro text-text-1">{setup.secret}</code>
                <p className="mt-1 break-all text-nano text-text-4">{setup.otpauthUrl}</p>
              </div>
              <div>
                <div className="ac-label mb-1.5">Confirm the six digits</div>
                <TOTPInput
                  value={code}
                  onChange={setCode}
                  onComplete={(c) =>
                    void api
                      .root('/auth/totp/enable', { method: 'POST', body: { code: c } })
                      .then(() => {
                        toast.push({ title: 'Two-factor enabled', status: 'done' });
                        setSetup(null);
                        void qc.invalidateQueries({ queryKey: qk.me() });
                      })
                      .catch(() => toast.push({ title: 'That code did not verify', status: 'failed' }))
                  }
                />
              </div>
              <div>
                <div className="ac-label mb-1.5">Recovery codes — store these now</div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {setup.recoveryCodes.map((c) => (
                    <code key={c} className="ac-mono rounded-r4 border border-line-1 bg-bg-2 px-2 py-1 text-micro text-text-soft">
                      {c}
                    </code>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <Button
            onClick={() =>
              void api
                .root<TotpSetup>('/auth/totp/setup', { method: 'POST', body: {} })
                .then(setSetup)
                .catch((e: Error) => toast.push({ title: 'Could not start TOTP setup', detail: e.message, status: 'failed' }))
            }
          >
            Set up two-factor
          </Button>
        )}
      </section>

      <section>
        <div className="ac-label mb-2">Devices</div>
        {sessions.isLoading ? (
          <SkeletonRows rows={3} />
        ) : (
          <div className="ac-card overflow-hidden">
            {(sessions.data ?? [])
              .filter((s) => !pendingRevoke.has(s.id))
              .map((s) => (
                <DeviceRow key={s.id} session={s} current={s.current ?? s.id === me.data?.session.id} onRevoke={revoke} />
              ))}
          </div>
        )}
        <Button
          className="mt-3"
          variant="danger"
          size="sm"
          onClick={() =>
            void api.root('/auth/sessions', { method: 'DELETE' }).then(() => {
              setToken(null, false);
              void qc.invalidateQueries({ queryKey: qk.sessions() });
            })
          }
        >
          Sign out every other device
        </Button>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------- device
 * Neither the daemon's nor the workspace's: the theme and the notification preferences live in this
 * browser's localStorage, so they follow the device and not the account. The section says so, which
 * is what keeps the page at two areas without filing per-device state under either of them.
 */

const NOTIFS = [
  { key: 'decisions', label: 'Decisions', detail: 'Plans, merges, hires, worker questions', def: true },
  { key: 'landed', label: 'Landed work', detail: 'A PR merged, a ticket closed', def: true },
  { key: 'everything', label: 'Everything else', detail: 'Status changes, run starts, curation', def: false },
] as const;

function DeviceSection(): React.ReactElement {
  const ws = useWs();
  const toast = useToast();
  const [theme, setTheme] = useTheme();
  const [state, setState] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('conductor.notifs') ?? '') as Record<string, boolean>;
    } catch {
      return Object.fromEntries(NOTIFS.map((n) => [n.key, n.def]));
    }
  });
  const [enabled, setEnabled] = useState(() => subscriptionId(ws) !== null);
  const [busy, setBusy] = useState(false);
  // The chat reads this through `useShowSilentTurns`; the writer publishes, so a chat already
  // mounted behind this page follows without a reload.
  const [silentTurns, setSilentTurns] = useState(readShowSilentTurns);
  const dictationDiagnostics = useDictationDiagnosticsEnabled();

  const save = (key: string, on: boolean): void => {
    const next = { ...state, [key]: on };
    setState(next);
    try {
      localStorage.setItem('conductor.notifs', JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };

  /** Whatever went wrong — a blocked permission, a daemon without VAPID keys — the human reads it. */
  const run = (what: 'on' | 'off'): void => {
    setBusy(true);
    const done = what === 'on' ? enablePush(ws) : disablePush(ws);
    done
      .then(() => {
        setEnabled(what === 'on');
        toast.push(
          what === 'on'
            ? { title: 'Push enabled', detail: 'Decisions and landed work will reach this device.', status: 'done' }
            : { title: 'Push turned off for this device', status: 'done' },
        );
      })
      .catch((e: Error) =>
        toast.push({ title: what === 'on' ? 'Could not enable push' : 'Could not turn push off', detail: e.message, status: 'failed', ttl: 8000 }),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="text-meta leading-relaxed text-text-2">
        These are stored in this browser only — not on the daemon and not in any workspace. Another device signed in to the
        same account has its own.
      </p>

      <section>
        <div className="ac-label mb-2">Theme</div>
        <div className="flex gap-1.5">
          {(['dark', 'light', 'system'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTheme(t)}
              className={cx('rounded-r6 border px-3 py-1.5 text-meta', theme === t ? 'border-accent-edge bg-accent-tint text-accent-link' : 'border-line-2 text-text-3')}
            >
              {t}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-micro text-text-3">Dark is the designed theme; light is authored from the same tokens.</p>
      </section>

      <section>
        <div className="ac-label mb-2">Chat</div>
        <div className="ac-card">
          <label className="flex items-center gap-3 px-3.5 py-3">
            <span className="min-w-0 flex-1">
              <span className="block text-meta text-text-1">Turns with no reply</span>
              <span className="block text-micro text-text-3">A row for work the conductor did without saying anything — a wake that only filed a ticket.</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={silentTurns}
              aria-label="Turns with no reply"
              onClick={() => { setSilentTurns(!silentTurns); writeShowSilentTurns(!silentTurns); }}
              className={cx(
                'flex h-5 w-9 flex-none items-center rounded-pill border px-0.5 transition-colors duration-(--dur-fast) ease-ac',
                silentTurns ? 'justify-end border-accent bg-accent' : 'justify-start border-line-2 bg-bg-3',
              )}
            >
              <span className={cx('size-3.5 rounded-pill', silentTurns ? 'bg-accent-on' : 'bg-text-nav')} />
            </button>
          </label>
        </div>
      </section>

      <section>
        <div className="ac-label mb-2">Dictation</div>
        <div className="ac-card">
          <label className="flex items-center gap-3 px-3.5 py-3">
            <span className="min-w-0 flex-1">
              <span className="block text-meta text-text-1">Diagnostics capture</span>
              <span className="block text-micro text-text-3">
                Records the raw recognizer events from your next dictation so a duplication bug can be diagnosed from what actually happened,
                not a guess. Nothing leaves this device unless you copy it from the composer yourself.
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={dictationDiagnostics}
              aria-label="Dictation diagnostics capture"
              onClick={() => writeDictationDiagnosticsEnabled(!dictationDiagnostics)}
              className={cx(
                'flex h-5 w-9 flex-none items-center rounded-pill border px-0.5 transition-colors duration-(--dur-fast) ease-ac',
                dictationDiagnostics ? 'justify-end border-accent bg-accent' : 'justify-start border-line-2 bg-bg-3',
              )}
            >
              <span className={cx('size-3.5 rounded-pill', dictationDiagnostics ? 'bg-accent-on' : 'bg-text-nav')} />
            </button>
          </label>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="ac-label">Notifications</div>
        <p className="text-meta leading-relaxed text-text-2">
          In-app arrival is the primary path — a toast plus the Needs-you badge — and nothing in any flow depends on a push being delivered.
        </p>
        <div className="ac-card divide-y divide-line-1">
          {NOTIFS.map((n) => (
            <label key={n.key} className="flex items-center gap-3 px-3.5 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-meta text-text-1">{n.label}</span>
                <span className="block text-micro text-text-3">{n.detail}</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={state[n.key] ?? n.def}
                aria-label={n.label}
                onClick={() => save(n.key, !(state[n.key] ?? n.def))}
                className={cx(
                  'flex h-5 w-9 flex-none items-center rounded-pill border px-0.5 transition-colors duration-(--dur-fast) ease-ac',
                  state[n.key] ?? n.def ? 'justify-end border-accent bg-accent' : 'justify-start border-line-2 bg-bg-3',
                )}
              >
                <span className={cx('size-3.5 rounded-pill', state[n.key] ?? n.def ? 'bg-accent-on' : 'bg-text-nav')} />
              </button>
            </label>
          ))}
        </div>
        {enabled ? (
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 text-micro text-text-3">Push is on for this device.</p>
            <Button disabled={busy} onClick={() => run('off')}>
              Turn off on this device
            </Button>
          </div>
        ) : (
          <Button disabled={busy} onClick={() => run('on')}>
            Get notified when something needs you
          </Button>
        )}
      </section>
    </div>
  );
}


/* ------------------------------------------------------------------ updates
 * The daemon's own release: what it is running, whether the source it builds from is ahead, and the
 * deferred upgrade — which waits for every running turn to finish before it touches anything, and
 * restarts the daemon this app is talking to. See PLAN §20.
 */

function UpdatesSection(): React.ReactElement {
  const update = useDaemonUpdate();
  const status = useDaemonUpgrade();
  const refresh = useRefreshDaemonUpdate();
  const request = useRequestUpgrade();
  const cancel = useCancelUpgrade();
  const toast = useToast();

  if (update.isLoading) return <SkeletonRows rows={3} />;
  if (update.isError && !update.data) return <ErrorState message="Could not read the daemon's update state." onRetry={() => void update.refetch()} />;

  const data = update.data;
  const upgrade = status.data?.upgrade ?? null;
  const pending = inFlight(upgrade);

  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className="ac-label mb-2">This daemon</div>
        <div className="ac-card divide-y divide-line-1">
          <Row label="Version" value={`v${data?.running.version ?? '?'}`} />
          <Row label="Commit" value={shortSha(data?.running.sha)} mono />
          <Row label="Release" value={data?.running.path ?? '—'} mono />
        </div>
      </section>

      <section>
        <div className="ac-label mb-2">Release source</div>
        {!data?.configured ? (
          <EmptyState
            title="Update checking is not configured"
            detail="Set upgrade.source (a git URL or a local checkout) in the daemon's daemon.yaml, and optionally upgrade.ref."
          />
        ) : (
          <>
            <div className="ac-card divide-y divide-line-1">
              <Row label="Source" value={`${data.source} @ ${data.ref}`} mono />
              <Row label="Target" value={shortSha(data.targetSha)} mono />
              <Row label="Checked" value={data.checkedAt ?? '—'} />
              {data.error ? <Row label="Error" value={data.error} tone="failed" /> : null}
            </div>
            <div className="mt-3 flex items-center gap-2">
              {data.updateAvailable && !data.error ? (
                <Badge tone="accent">Update available</Badge>
              ) : data.error ? null : (
                <span className="text-meta text-text-3">Up to date</span>
              )}
              <div className="flex-1" />
              <Button onClick={() => refresh.mutate()} disabled={refresh.isPending}>
                {refresh.isPending ? 'Checking…' : 'Check again'}
              </Button>
              {data.updateAvailable && !data.error && !pending ? (
                <Button
                  variant="primary"
                  disabled={request.isPending}
                  onClick={() =>
                    request.mutate(undefined, {
                      onSuccess: () => toast.push({ title: 'Upgrade queued', detail: 'It starts once no turn is running.', status: 'merging', ttl: 6000 }),
                      onError: (e) => toast.push({ title: 'Could not queue the upgrade', detail: e.message, status: 'failed', ttl: 8000 }),
                    })
                  }
                >
                  {request.isPending ? 'Queueing…' : 'Upgrade'}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </section>

      {upgrade ? <UpgradeProgress upgrade={upgrade} waitingFor={status.data?.waitingFor ?? []} unreachable={status.isError} onCancel={() => cancel.mutate()} cancelling={cancel.isPending} runningVersion={data?.running.version ?? null} /> : null}
    </div>
  );
}

function Row({ label, value, mono, tone }: { label: string; value: string; mono?: boolean; tone?: 'failed' }): React.ReactElement {
  return (
    <div className="flex items-baseline gap-3 px-3.5 py-2.5">
      <span className="ac-label w-28 flex-none">{label}</span>
      <span className={cx('min-w-0 flex-1 break-all text-meta', mono ? 'ac-mono' : '', tone === 'failed' ? 'text-failed' : 'text-text-2')}>{value}</span>
    </div>
  );
}

function UpgradeProgress({
  upgrade, waitingFor, unreachable, onCancel, cancelling, runningVersion,
}: {
  upgrade: NonNullable<ReturnType<typeof useDaemonUpgrade>['data']>['upgrade'];
  waitingFor: Array<{ workspace: string; running: number; runIds: string[] }>;
  unreachable: boolean;
  onCancel: () => void;
  cancelling: boolean;
  runningVersion: string | null;
}): React.ReactElement | null {
  if (!upgrade) return null;
  const pending = inFlight(upgrade);
  // While the daemon restarts the poll fails; that is the restart, not an error.
  const restarting = isRestarting(upgrade.state) || (pending && unreachable);

  return (
    <section>
      <div className="ac-label mb-2">Upgrade</div>
      <div className="ac-card divide-y divide-line-1">
        <div className="flex items-center gap-3 px-3.5 py-2.5">
          <span className="flex-1 text-body text-text-1">
            {restarting ? 'Restarting the daemon…' : UPGRADE_STAGE_LABEL[upgrade.state]}
          </span>
          {pending ? <Badge tone="accent">{upgrade.state}</Badge> : null}
          {upgrade.state === 'completed' ? <Badge tone="added">completed</Badge> : null}
          {upgrade.state === 'failed' ? <Badge tone="removed">failed</Badge> : null}
        </div>

        {restarting ? (
          <div className="px-3.5 py-2.5 text-meta text-text-3">
            Waiting for the daemon to answer again. This page reconnects on its own.
          </div>
        ) : null}

        {upgrade.state === 'waiting' && waitingFor.length ? (
          <div className="px-3.5 py-2.5 text-meta text-text-2">
            Waiting for{' '}
            {waitingFor.map((w) => `${w.running} run${w.running === 1 ? '' : 's'} in ${w.workspace}`).join(', ')}. No new run starts until the upgrade finishes or is cancelled.
          </div>
        ) : null}

        <Row label="Target" value={`${upgrade.source} @ ${upgrade.ref} · ${shortSha(upgrade.toSha ?? upgrade.targetSha)}`} mono />
        {upgrade.state === 'completed' ? <Row label="Now running" value={`v${upgrade.cameBackVersion ?? runningVersion ?? '?'}`} /> : null}
        {upgrade.state === 'failed' ? <Row label="Reason" value={upgrade.reason ?? 'unknown'} tone="failed" /> : null}
        {upgrade.state === 'failed' ? <Row label="Still running" value={`v${runningVersion ?? '?'}`} /> : null}
        {upgrade.message ? <Row label="Detail" value={upgrade.message} tone={upgrade.state === 'failed' ? 'failed' : undefined} /> : null}

        {upgrade.log.length ? (
          <pre className="ac-mono max-h-56 overflow-auto px-3.5 py-2.5 text-micro text-text-3">{upgrade.log.join('\n')}</pre>
        ) : null}
      </div>

      {isCancellableUpgrade(upgrade.state) ? (
        <div className="mt-3 flex justify-end">
          <Button onClick={onCancel} disabled={cancelling}>{cancelling ? 'Cancelling…' : 'Cancel upgrade'}</Button>
        </div>
      ) : null}
    </section>
  );
}
