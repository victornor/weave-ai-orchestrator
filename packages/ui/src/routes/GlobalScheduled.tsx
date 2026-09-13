/**
 * Daemon-wide Scheduled page (VS-231): every workspace's routines, with per-fire history.
 */
import { useMemo, useState } from 'react';
import type { Routine, RoutineFire, RoutineListItem } from '@weave-ai/shared';
import { Page, PageBody, PageHeader } from '../components/Page';
import { Button } from '../components/Button';
import { Badge } from '../components/StatusGlyph';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { useToast } from '../components/Toast';
import {
  useCreateRoutineAt,
  usePatchRoutineAt,
  useRemoveRoutineAt,
  useRoutineFires,
  useRoutineUsageFor,
  useRoutinesMany,
  useWorkspaces,
} from '../api/hooks';
import { useSearchParams } from '../app/link';
import { cents } from '../lib/format';
import { cx } from '../lib/cx';
import type { WorkspaceListItem } from '../api/types';

const inputCx = 'h-9 w-full rounded-r6 border border-line-2 bg-bg-input px-3 text-body text-text-1 outline-none';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <label className="flex flex-col gap-1.5 py-2.5">
      <span className="ac-label">{label}</span>
      {children}
      {hint ? <span className="text-micro text-text-3">{hint}</span> : null}
    </label>
  );
}

export function scheduleLabel(r: Pick<Routine, 'trigger'>): string {
  const t = r.trigger;
  if ('daily' in t) {
    const hh = String(t.daily.hour).padStart(2, '0');
    const mm = String(t.daily.minute).padStart(2, '0');
    return `daily ${hh}:${mm} ${t.timezone}`;
  }
  return `every ${t.everyMinutes}m ${t.timezone}`;
}

export function dueLabel(iso: string | null): string {
  if (!iso) return '—';
  return iso.slice(0, 16).replace('T', ' ') + 'Z';
}

function fireCountLabel(n: number): string {
  if (n === 0) return '0 fires';
  return n === 1 ? '1 fire' : `${n} fires`;
}

type Listed = RoutineListItem & { ws: string; workspaceName: string };

export function GlobalScheduledRoute(): React.ReactElement {
  const workspaces = useWorkspaces();
  const listed = workspaces.data ?? [];
  const ids = useMemo(() => listed.map((w) => w.id), [listed]);
  const routineQueries = useRoutinesMany(ids);
  const search = useSearchParams();
  const focusWs = search.ws?.trim() || '';

  const rows = useMemo<Listed[]>(() => {
    const out: Listed[] = [];
    for (let i = 0; i < listed.length; i++) {
      const w = listed[i];
      const items = routineQueries[i]?.data;
      if (!w || !items) continue;
      for (const r of items) out.push({ ...r, ws: w.id, workspaceName: w.name });
    }
    if (focusWs) {
      out.sort((a, b) => Number(b.ws === focusWs) - Number(a.ws === focusWs) || a.name.localeCompare(b.name));
    }
    return out;
  }, [listed, routineQueries, focusWs]);

  const loaded = Boolean(workspaces.data) && routineQueries.every((q) => q.data !== undefined || q.isError);
  const failed = listed.map((w, i) => (routineQueries[i]?.isError ? w : null)).filter((w): w is WorkspaceListItem => w !== null);
  const n = rows.length;

  if (workspaces.isError) {
    return (
      <Page>
        <PageHeader title="Scheduled" />
        <PageBody className="p-4 md:p-5">
          <ErrorState code="WORKSPACES_QUERY_FAILED" message="Could not load workspaces." onRetry={() => void workspaces.refetch()} />
        </PageBody>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title="Scheduled" meta={loaded ? (n === 1 ? '1 task' : `${n} tasks`) : undefined} />
      <PageBody className="p-4 md:p-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {!workspaces.data || !loaded ? (
            <SkeletonRows rows={4} />
          ) : (
            <>
              <AddForm workspaces={listed} defaultWs={focusWs || (listed.length === 1 ? listed[0]!.id : '')} />
              {failed.map((w) => (
                <ErrorState
                  key={w.id}
                  code="ROUTINES_QUERY_FAILED"
                  message={`Could not load scheduled tasks in ${w.name}.`}
                  onRetry={() => {
                    const i = listed.findIndex((x) => x.id === w.id);
                    if (i >= 0) void routineQueries[i]?.refetch();
                  }}
                />
              ))}
              {n === 0 && failed.length === 0 ? (
                <EmptyState
                  title="No scheduled tasks yet."
                  detail="Alarms that wake a workspace's weaver with an instruction. Add one above, or ask the weaver."
                />
              ) : n > 0 ? (
                <div className="ac-card divide-y divide-line-1">
                  {rows.map((r) => (
                    <ScheduledRow key={`${r.ws}:${r.id}`} r={r} />
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      </PageBody>
    </Page>
  );
}

function AddForm({ workspaces, defaultWs }: { workspaces: WorkspaceListItem[]; defaultWs: string }): React.ReactElement {
  const create = useCreateRoutineAt();
  const toast = useToast();
  const [ws, setWs] = useState(defaultWs);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'daily' | 'interval'>('daily');
  const [daily, setDaily] = useState('07:00');
  const [every, setEvery] = useState('60');
  const [tz, setTz] = useState('');
  const [instruction, setInstruction] = useState('');
  const [action, setAction] = useState<Routine['template']['action']>('report');
  const [maxTickets, setMaxTickets] = useState('');
  const [projectId, setProjectId] = useState('');

  const parsedDaily = /^(\d{1,2}):(\d{2})$/.exec(daily.trim());
  const hour = parsedDaily ? Number(parsedDaily[1]) : NaN;
  const minute = parsedDaily ? Number(parsedDaily[2]) : NaN;
  const everyN = Number(every);
  const trigger = ((): { kind: 'schedule'; timezone?: string; daily?: { hour: number; minute: number }; everyMinutes?: number } | null => {
    if (kind === 'daily') {
      if (!(Number.isInteger(hour) && hour <= 23 && Number.isInteger(minute) && minute <= 59)) return null;
      return { kind: 'schedule', ...(tz.trim() ? { timezone: tz.trim() } : {}), daily: { hour, minute } };
    }
    if (!(Number.isInteger(everyN) && everyN >= 15)) return null;
    return { kind: 'schedule', ...(tz.trim() ? { timezone: tz.trim() } : {}), everyMinutes: everyN };
  })();
  const targetWs = workspaces.length === 1 ? workspaces[0]!.id : ws;
  const canAdd = Boolean(name.trim() && instruction.trim() && trigger && targetWs) && !create.isPending;

  return (
    <section className="ac-card p-3.5">
      <div className="ac-label mb-2">Add a scheduled task</div>
      {workspaces.length > 1 ? (
        <Field label="Workspace">
          <select className={cx(inputCx, 'ac-mono')} value={targetWs} onChange={(e) => setWs(e.target.value)}>
            <option value="">Choose a workspace</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field label="Name">
        <input className={inputCx} value={name} onChange={(e) => setName(e.target.value)} placeholder="Morning review" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="When">
          <select className={cx(inputCx, 'ac-mono')} value={kind} onChange={(e) => setKind(e.target.value as 'daily' | 'interval')}>
            <option value="daily">every day at</option>
            <option value="interval">every N minutes</option>
          </select>
        </Field>
        {kind === 'daily' ? (
          <Field label="Time" hint="HH:MM in the timezone below">
            <input className={cx(inputCx, 'ac-mono')} value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="07:00" />
          </Field>
        ) : (
          <Field label="Minutes" hint="15 or more">
            <input type="number" min={15} className={cx(inputCx, 'ac-mono')} value={every} onChange={(e) => setEvery(e.target.value)} />
          </Field>
        )}
      </div>
      <Field label="Timezone" hint="IANA zone. Leave blank for the daemon host's zone.">
        <input className={cx(inputCx, 'ac-mono')} value={tz} onChange={(e) => setTz(e.target.value)} placeholder="Europe/Copenhagen" />
      </Field>
      <Field label="Instruction">
        <textarea
          className={cx(inputCx, 'h-24 py-2')}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Look at today's incidents and report anything cheap to fix."
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Action" hint="report looks, then replies. file_work is the only filing licence.">
          <select className={cx(inputCx, 'ac-mono')} value={action} onChange={(e) => setAction(e.target.value as Routine['template']['action'])}>
            <option value="report">report</option>
            <option value="file_work">file_work</option>
          </select>
        </Field>
        <Field label="Max tickets per fire" hint="Optional. Defaults 0 (report) or 3 (file_work); cap 8.">
          <input type="number" min={0} max={8} className={cx(inputCx, 'ac-mono')} value={maxTickets} onChange={(e) => setMaxTickets(e.target.value)} />
        </Field>
      </div>
      <Field label="Project" hint="Optional. Leave blank for the whole workspace.">
        <input className={cx(inputCx, 'ac-mono')} value={projectId} onChange={(e) => setProjectId(e.target.value)} />
      </Field>
      <Button
        variant="primary"
        disabled={!canAdd}
        onClick={() => {
          if (!trigger || !targetWs) return;
          const body: Parameters<typeof create.mutate>[0] = {
            ws: targetWs,
            name: name.trim(),
            trigger,
            instruction: instruction.trim(),
            action,
          };
          if (maxTickets.trim()) body.maxTicketsPerFire = Number(maxTickets);
          if (projectId.trim()) body.projectId = projectId.trim();
          create.mutate(body, {
            onSuccess: () => {
              toast.push({ title: 'Scheduled task added', detail: name.trim() });
              setName('');
              setInstruction('');
            },
            onError: (e) => toast.push({ title: 'Could not add the scheduled task', detail: e.message, status: 'failed' }),
          });
        }}
      >
        Add scheduled task
      </Button>
    </section>
  );
}

function ScheduledRow({ r }: { r: Listed }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const usage = useRoutineUsageFor(r.ws, r.id, '7d');
  const fires = useRoutineFires(r.ws, r.id, open);
  const patch = usePatchRoutineAt();
  const remove = useRemoveRoutineAt();
  const toast = useToast();
  const spend = usage.data ? cents(usage.data.costCents) : (usage.isLoading ? '…' : cents(0));
  const paused = r.status === 'paused';

  return (
    <article>
      <button
        type="button"
        className="flex w-full flex-col gap-2 px-3.5 py-3 text-left hover:bg-bg-2 sm:flex-row sm:items-center sm:gap-3"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-meta font-medium text-text-1">{r.name}</span>
            <Badge tone={paused ? 'neutral' : 'accent'}>{r.status}</Badge>
            <span className="text-micro text-text-3">{r.workspaceName}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-micro text-text-3">
            <span className="ac-mono">{scheduleLabel(r)}</span>
            <span>next {dueLabel(r.nextFireAt)}</span>
            <span>created {dueLabel(r.createdAt)}</span>
            <span>{fireCountLabel(r.fireCount)}</span>
            <span>7d {spend}</span>
          </div>
        </div>
      </button>
      {open ? (
        <div className="flex flex-col gap-4 px-3.5 pb-3">
          <FireList fires={fires.data} loading={fires.isLoading} error={fires.isError} onRetry={() => void fires.refetch()} />
          <EditForm r={r} />
          <div className="flex flex-none items-center gap-2">
            <Button
              size="sm"
              disabled={patch.isPending}
              onClick={() =>
                patch.mutate(
                  { ws: r.ws, id: r.id, patch: { status: paused ? 'active' : 'paused' } },
                  { onError: (e) => toast.push({ title: paused ? 'Could not resume' : 'Could not pause', detail: e.message, status: 'failed' }) },
                )
              }
            >
              {paused ? 'Resume' : 'Pause'}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(
                  { ws: r.ws, id: r.id },
                  { onError: (e) => toast.push({ title: 'Could not remove', detail: e.message, status: 'failed' }) },
                )
              }
            >
              Remove
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function FireList({
  fires,
  loading,
  error,
  onRetry,
}: {
  fires: RoutineFire[] | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}): React.ReactElement {
  if (loading && !fires) return <p className="text-micro text-text-3">Loading fires…</p>;
  if (error) {
    return <ErrorState code="FIRES_QUERY_FAILED" message="Could not load this task's fires." onRetry={onRetry} />;
  }
  if (!fires?.length) {
    return <p className="text-micro text-text-3">No fires yet.</p>;
  }
  return (
    <ol className="flex flex-col gap-2">
      {fires.map((f) => (
        <li key={f.wakeId} className="rounded-r6 border border-line-1 bg-bg-1 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-micro text-text-3">
            <time className="ac-mono" dateTime={f.firedAt}>{dueLabel(f.firedAt)}</time>
            <Badge tone={f.status === 'succeeded' ? 'added' : f.status === 'failed' ? 'removed' : 'neutral'}>{f.status}</Badge>
          </div>
          {f.summary ? <p className="mt-1 text-meta text-text-1">{f.summary}</p> : null}
          {f.sharedTurn ? <p className="mt-1 text-micro text-text-3">this run also handled other work</p> : null}
        </li>
      ))}
    </ol>
  );
}

function EditForm({ r }: { r: Listed }): React.ReactElement {
  const patch = usePatchRoutineAt();
  const toast = useToast();
  const daily0 = 'daily' in r.trigger ? r.trigger.daily : { hour: 7, minute: 0 };
  const [name, setName] = useState(r.name);
  const [kind, setKind] = useState<'daily' | 'interval'>('daily' in r.trigger ? 'daily' : 'interval');
  const [daily, setDaily] = useState(`${String(daily0.hour).padStart(2, '0')}:${String(daily0.minute).padStart(2, '0')}`);
  const [every, setEvery] = useState('everyMinutes' in r.trigger ? String(r.trigger.everyMinutes) : '60');
  const [tz, setTz] = useState(r.trigger.timezone);
  const [instruction, setInstruction] = useState(r.template.instruction);
  const [action, setAction] = useState(r.template.action);

  const parsedDaily = /^(\d{1,2}):(\d{2})$/.exec(daily.trim());
  const hour = parsedDaily ? Number(parsedDaily[1]) : NaN;
  const minute = parsedDaily ? Number(parsedDaily[2]) : NaN;
  const everyN = Number(every);
  const trigger = ((): Routine['trigger'] | null => {
    if (kind === 'daily') {
      if (!(Number.isInteger(hour) && hour <= 23 && Number.isInteger(minute) && minute <= 59)) return null;
      return { kind: 'schedule', timezone: tz.trim() || r.trigger.timezone, daily: { hour, minute } };
    }
    if (!(Number.isInteger(everyN) && everyN >= 15)) return null;
    return { kind: 'schedule', timezone: tz.trim() || r.trigger.timezone, everyMinutes: everyN };
  })();

  return (
    <section>
      <div className="ac-label mb-1">Edit</div>
      <Field label="Name">
        <input className={inputCx} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="When">
          <select className={cx(inputCx, 'ac-mono')} value={kind} onChange={(e) => setKind(e.target.value as 'daily' | 'interval')}>
            <option value="daily">every day at</option>
            <option value="interval">every N minutes</option>
          </select>
        </Field>
        {kind === 'daily' ? (
          <Field label="Time">
            <input className={cx(inputCx, 'ac-mono')} value={daily} onChange={(e) => setDaily(e.target.value)} />
          </Field>
        ) : (
          <Field label="Minutes">
            <input type="number" min={15} className={cx(inputCx, 'ac-mono')} value={every} onChange={(e) => setEvery(e.target.value)} />
          </Field>
        )}
      </div>
      <Field label="Timezone">
        <input className={cx(inputCx, 'ac-mono')} value={tz} onChange={(e) => setTz(e.target.value)} />
      </Field>
      <Field label="Instruction">
        <textarea className={cx(inputCx, 'h-24 py-2')} value={instruction} onChange={(e) => setInstruction(e.target.value)} />
      </Field>
      <Field label="Action">
        <select className={cx(inputCx, 'ac-mono')} value={action} onChange={(e) => setAction(e.target.value as Routine['template']['action'])}>
          <option value="report">report</option>
          <option value="file_work">file_work</option>
        </select>
      </Field>
      <Button
        size="sm"
        variant="primary"
        disabled={!name.trim() || !instruction.trim() || !trigger || patch.isPending}
        onClick={() => {
          if (!trigger) return;
          patch.mutate(
            {
              ws: r.ws,
              id: r.id,
              patch: { name: name.trim(), instruction: instruction.trim(), action, trigger },
            },
            {
              onSuccess: () => toast.push({ title: 'Scheduled task updated', detail: name.trim() }),
              onError: (e) => toast.push({ title: 'Could not save', detail: e.message, status: 'failed' }),
            },
          );
        }}
      >
        Save
      </Button>
    </section>
  );
}
