import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Page, PageBody, PageHeader } from '../components/Page';
import { Tabs } from '../components/Tabs';
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
  useConductor,
  useMe,
  usePatchConductor,
  usePatchConfig,
  usePatchProject,
  usePresentation,
  useProjects,
  usePutPresentation,
  useRuntimeModels,
  useRuntimes,
  useWorkspaceSummary,
  useWorkspaces,
} from '../api/hooks';
import { api, setToken } from '../api/client';
import { qk } from '../api/keys';
import type { TotpSetup } from '../api/types';
import { useWs } from '../api/context';
import { useGo } from '../app/link';
import { useTheme } from '../lib/theme';
import { cx } from '../lib/cx';

const SECTIONS = [
  { key: 'workspace', label: 'Workspace' },
  { key: 'projects', label: 'Projects' },
  { key: 'conductor', label: 'Conductor' },
  { key: 'channels', label: 'Channels' },
  { key: 'presentation', label: 'Presentation' },
  { key: 'security', label: 'Security & Devices' },
  { key: 'notifications', label: 'Notifications' },
] as const;

export function SettingsRoute(): React.ReactElement {
  const [section, setSection] = useState<string>('workspace');
  return (
    <Page>
      <PageHeader title="Settings" tabs={<Tabs items={SECTIONS} active={section} onChange={setSection} className="px-3 md:px-4" />} />
      <PageBody className="p-4 md:p-5">
        <div className="mx-auto max-w-3xl">
          {section === 'workspace' ? <WorkspaceSection /> : null}
          {section === 'projects' ? <ProjectsSection /> : null}
          {section === 'conductor' ? <ConductorSection /> : null}
          {section === 'channels' ? <ChannelsSection /> : null}
          {section === 'presentation' ? <PresentationSection /> : null}
          {section === 'security' ? <SecuritySection /> : null}
          {section === 'notifications' ? <NotificationsSection /> : null}
        </div>
      </PageBody>
    </Page>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <label className="flex flex-col gap-1.5 py-2.5">
      <span className="oc-label">{label}</span>
      {children}
      {hint ? <span className="text-micro text-text-3">{hint}</span> : null}
    </label>
  );
}

const inputCx = 'h-9 w-full rounded-r6 border border-line-2 bg-bg-input px-3 text-body text-text-1 outline-none';

function WorkspaceSection(): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const summary = useWorkspaceSummary();
  const workspaces = useWorkspaces();
  const patch = usePatchConfig();
  const [theme, setTheme] = useTheme();
  const [name, setName] = useState('');

  if (summary.isLoading) return <SkeletonRows rows={4} />;

  return (
    <div className="flex flex-col gap-5">
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
          <input className={cx(inputCx, 'oc-mono')} defaultValue={summary.data?.workspace.ticketPrefix ?? ''} readOnly />
        </Field>
        <Field label="Theme" hint="Dark is the designed theme; light is authored from the same tokens.">
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
        </Field>
      </section>

      <section>
        <div className="oc-label mb-2">Workspaces</div>
        <div className="oc-card divide-y divide-line-1">
          {(workspaces.data ?? []).map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => go(`/w/${w.slug || w.id}/needs`)}
              className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-bg-2"
            >
              <span className="flex-1 text-meta text-text-1">{w.name}</span>
              <span className="oc-mono text-micro text-text-3">{w.slug}</span>
              {(w.slug === ws || w.id === ws) && <Badge tone="accent">current</Badge>}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ProjectsSection(): React.ReactElement {
  const projects = useProjects();
  const runtimes = useRuntimes();
  const add = useAddProject();
  const patch = usePatchProject();
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [runtime, setRuntime] = useState('');
  const [maxWorkers, setMaxWorkers] = useState(2);
  const [setupCommand, setSetupCommand] = useState('');
  const [autoMerge, setAutoMerge] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <section className="oc-card p-3.5">
        <div className="oc-label mb-2">Add a project</div>
        <Field label="Git URL" hint="Cloned into projects/<id>; nobody works in that clone.">
          <input className={cx(inputCx, 'oc-mono')} placeholder="git@github.com:acme/api.git" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Runtime">
            <select className={cx(inputCx, 'oc-mono')} value={runtime} onChange={(e) => setRuntime(e.target.value)}>
              <option value="">default</option>
              {(runtimes.data ?? []).map((r) => (
                <option key={r.id} value={r.id} disabled={!r.detection.available}>
                  {r.displayName}
                  {r.detection.available ? '' : ' (not installed)'}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Max workers">
            <input type="number" min={1} max={16} className={cx(inputCx, 'oc-mono')} value={maxWorkers} onChange={(e) => setMaxWorkers(Number(e.target.value))} />
          </Field>
          <Field label="Auto-merge default">
            <select className={cx(inputCx, 'oc-mono')} value={autoMerge ? 'on' : 'off'} onChange={(e) => setAutoMerge(e.target.value === 'on')}>
              <option value="off">off</option>
              <option value="on">on</option>
            </select>
          </Field>
        </div>
        <Field label="Setup command" hint="Run once per worktree before the first turn.">
          <input className={cx(inputCx, 'oc-mono')} placeholder="pnpm install" value={setupCommand} onChange={(e) => setSetupCommand(e.target.value)} />
        </Field>
        <Button
          variant="primary"
          disabled={!url || add.isPending}
          onClick={() =>
            add.mutate(
              { url, ...(runtime ? { runtime } : {}), maxWorkers, ...(setupCommand ? { setupCommand } : {}), autoMerge },
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
        <div className="oc-card divide-y divide-line-1">
          {(projects.data ?? []).map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 px-3.5 py-3">
              <span className="oc-mono text-meta text-text-1">{p.slug}</span>
              <Badge>{p.status}</Badge>
              <span className="oc-mono oc-truncate flex-1 text-micro text-text-3">{p.gitUrl}</span>
              <label className="flex items-center gap-1.5">
                <span className="oc-label">workers</span>
                <input
                  type="number"
                  min={1}
                  defaultValue={p.maxWorkers}
                  onBlur={(e) => patch.mutate({ id: p.id, patch: { maxWorkers: Number(e.target.value) } })}
                  className="oc-mono h-7 w-14 rounded-r4 border border-line-2 bg-bg-input px-2 text-micro"
                />
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConductorSection(): React.ReactElement {
  const conductor = useConductor();
  const runtimes = useRuntimes();
  const [runtime, setRuntime] = useState('');
  const models = useRuntimeModels(runtime || conductor.data?.agent.runtimeId);
  const patch = usePatchConductor();

  if (conductor.isLoading) return <SkeletonRows rows={3} />;
  if (!conductor.data) return <ErrorState code="CONDUCTOR_UNREACHABLE" message="The conductor agent is not registered." />;

  return (
    <div className="flex flex-col gap-3">
      <Field label="Runtime">
        <select
          className={cx(inputCx, 'oc-mono')}
          value={runtime || conductor.data.agent.runtimeId}
          onChange={(e) => {
            setRuntime(e.target.value);
            patch.mutate({ runtime: e.target.value });
          }}
        >
          {(runtimes.data ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.displayName}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Model">
        <select className={cx(inputCx, 'oc-mono')} value={conductor.data.agent.model ?? ''} onChange={(e) => patch.mutate({ model: e.target.value })}>
          <option value="">default</option>
          {(models.data ?? []).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Field>
      <p className="text-micro leading-relaxed text-text-3">
        Transcription for voice dictation is configured on the daemon host. With no provider, the composer keeps the mic visible, dimmed with a slash, and says so on tap.
      </p>
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
      <div className="oc-label">Telegram</div>
      <Field label="Enabled" hint="The bot token itself lives in the daemon's secrets, never here.">
        <select
          className={cx(inputCx, 'oc-mono')}
          value={telegram.enabled ? 'on' : 'off'}
          onChange={(e) => patch.mutate({ channels: { telegram: { ...telegram, enabled: e.target.value === 'on' } } })}
        >
          <option value="off">off</option>
          <option value="on">on</option>
        </select>
      </Field>
      <Field label="Allowlist" hint="Comma-separated Telegram user ids that may talk to the conductor.">
        <input
          className={cx(inputCx, 'oc-mono')}
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
  const put = usePutPresentation();
  if (presentation.isLoading) return <SkeletonRows rows={3} />;
  if (presentation.isError) return <ErrorState code="PRESENTATION_UNAVAILABLE" message="The daemon did not return a presentation config." onRetry={() => void presentation.refetch()} />;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-meta leading-relaxed text-text-2">
        Presentation surfaces run on the client. The daemon holds only the desired config; the presenter reconciles it locally.
      </p>
      <div className="oc-card divide-y divide-line-1">
        {(presentation.data?.available ?? []).map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={!s.detection.available}
            onClick={() => put.mutate({ surface: s.id })}
            className={cx('flex w-full items-center gap-3 px-3.5 py-2.5 text-left', s.detection.available ? 'hover:bg-bg-2' : 'opacity-50')}
          >
            <span className="flex-1 text-meta text-text-1">{s.displayName}</span>
            <span className={cx('oc-mono text-micro', s.detection.available ? 'text-done' : 'text-text-3')}>
              {s.detection.available ? 'detected' : (s.detection.reason ?? 'not found')}
            </span>
            {presentation.data?.surface === s.id ? <Badge tone="accent">selected</Badge> : null}
          </button>
        ))}
      </div>
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
        <div className="oc-label mb-2">Change password</div>
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
        <div className="oc-label mb-2">Two-factor authentication</div>
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
                <div className="oc-label mb-1">Secret</div>
                <code className="oc-mono block break-all rounded-r4 border border-line-1 bg-bg-2 px-2 py-1.5 text-micro text-text-1">{setup.secret}</code>
                <p className="mt-1 break-all text-nano text-text-4">{setup.otpauthUrl}</p>
              </div>
              <div>
                <div className="oc-label mb-1.5">Confirm the six digits</div>
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
                <div className="oc-label mb-1.5">Recovery codes — store these now</div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {setup.recoveryCodes.map((c) => (
                    <code key={c} className="oc-mono rounded-r4 border border-line-1 bg-bg-2 px-2 py-1 text-micro text-text-soft">
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
        <div className="oc-label mb-2">Devices</div>
        {sessions.isLoading ? (
          <SkeletonRows rows={3} />
        ) : (
          <div className="oc-card overflow-hidden">
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

const NOTIFS = [
  { key: 'decisions', label: 'Decisions', detail: 'Plans, merges, hires, worker questions', def: true },
  { key: 'landed', label: 'Landed work', detail: 'A PR merged, a ticket closed', def: true },
  { key: 'everything', label: 'Everything else', detail: 'Status changes, run starts, curation', def: false },
] as const;

function NotificationsSection(): React.ReactElement {
  const ws = useWs();
  const toast = useToast();
  const [state, setState] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('oc.notifs') ?? '') as Record<string, boolean>;
    } catch {
      return Object.fromEntries(NOTIFS.map((n) => [n.key, n.def]));
    }
  });
  const [permission, setPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'default');

  const save = (key: string, on: boolean): void => {
    const next = { ...state, [key]: on };
    setState(next);
    try {
      localStorage.setItem('oc.notifs', JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };

  const subscribe = async (): Promise<void> => {
    if (typeof Notification === 'undefined') return;
    const p = await Notification.requestPermission();
    setPermission(p);
    if (p !== 'granted') return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true });
      await api.ws(ws, '/push/subscribe', { method: 'POST', body: sub.toJSON() });
      toast.push({ title: 'Push enabled', detail: 'Decisions and landed work will reach this device.', status: 'done' });
    } catch {
      toast.push({ title: 'Push is not available', detail: 'In-app arrival still works: a toast plus the Needs-you badge.', status: 'working' });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-meta leading-relaxed text-text-2">
        In-app arrival is the primary path — a toast plus the Needs-you badge — and nothing in any flow depends on a push being delivered.
      </p>
      <div className="oc-card divide-y divide-line-1">
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
                'flex h-5 w-9 flex-none items-center rounded-pill border px-0.5 transition-colors duration-(--dur-fast) ease-oc',
                state[n.key] ?? n.def ? 'justify-end border-accent bg-accent' : 'justify-start border-line-2 bg-bg-3',
              )}
            >
              <span className={cx('size-3.5 rounded-pill', state[n.key] ?? n.def ? 'bg-accent-on' : 'bg-text-nav')} />
            </button>
          </label>
        ))}
      </div>
      {permission !== 'granted' ? (
        <Button onClick={() => void subscribe()}>Get notified when something needs you</Button>
      ) : (
        <p className="text-micro text-text-3">Push is on for this device.</p>
      )}
    </div>
  );
}
