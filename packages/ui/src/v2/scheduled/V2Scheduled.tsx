/**
 * V2 Scheduled (VS-348): every workspace's routines as the design's list, with the scope in the
 * project's hue, keeping V1's create, edit, pause and delete, its fire history and its 7d spend.
 */
import { useMemo, useState } from 'react';
import type { Routine, RoutineListItem } from '@weave-ai/shared';
import { V2Page } from '../V2Page';
import { Button } from '../../components/Button';
import { SkeletonRows } from '../../components/Skeleton';
import { EmptyState } from '../../components/States';
import { useToast } from '../../components/Toast';
import {
  useCreateRoutineAt,
  usePatchRoutineAt,
  useRemoveRoutineAt,
  useRoutineFires,
  useRoutineUsageFor,
  useRoutinesMany,
  useWorkspaceProjects,
  useWorkspaces,
} from '../../api/hooks';
import { dueLabel, scheduleLabel } from '../../lib/schedule';
import { projectColorVar } from '../../lib/projectColor';
import { cents } from '../../lib/format';
import { cx } from '../../lib/cx';
import type { WorkspaceListItem } from '../../api/types';

const inputCx = 'h-8 w-full rounded-r4 border border-line-2 bg-bg-input px-2 text-micro text-text-1 outline-none';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <label className="flex flex-col gap-1">
      <span className="ac-label">{label}</span>
      {children}
      {hint ? <span className="text-micro text-text-3">{hint}</span> : null}
    </label>
  );
}

type Listed = RoutineListItem & { ws: string; workspaceName: string };

export function V2Scheduled(): React.ReactElement {
  const workspaces = useWorkspaces();
  const listed = workspaces.data ?? [];
  const ids = useMemo(() => listed.map((w) => w.id), [listed]);
  const routineQueries = useRoutinesMany(ids);
  const projectMap = useWorkspaceProjects(ids);
  const [focusWs, setFocusWs] = useState('');
  const rows = useMemo<Listed[]>(() => {
    const out: Listed[] = [];
    listed.forEach((w, i) => {
      for (const r of routineQueries[i]?.data ?? []) out.push({ ...r, ws: w.id, workspaceName: w.name });
    });
    if (focusWs) out.sort((a, b) => Number(b.ws === focusWs) - Number(a.ws === focusWs) || a.name.localeCompare(b.name));
    return out;
  }, [listed, routineQueries, focusWs]);
  const loaded = Boolean(workspaces.data) && routineQueries.every((q) => q.data !== undefined || q.isError);

  return (
    <V2Page title="Scheduled" subtitle={loaded ? `${rows.length} ${rows.length === 1 ? 'task' : 'tasks'}` : undefined}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4 md:px-5">
        {!loaded ? (
          <SkeletonRows rows={4} />
        ) : (
          <>
            <AddForm workspaces={listed} defaultWs={focusWs || (listed.length === 1 ? listed[0]!.id : '')} />
            {rows.length === 0 ? (
              <EmptyState title="No scheduled tasks yet." detail="Add one above, or ask the weaver." />
            ) : (
              <div className="divide-y divide-line-1 border-t border-line-1">
                {rows.map((r) => <ScheduledRow key={`${r.ws}:${r.id}`} r={r} projects={projectMap[r.ws]?.projects ?? []} onFocus={() => setFocusWs(r.ws)} />)}
              </div>
            )}
          </>
        )}
      </div>
    </V2Page>
  );
}

function projectName(projectId: string | null | undefined, projects: Array<{ id: string; slug: string; name?: string | null }>): string | null {
  if (!projectId) return null;
  const p = projects.find((x) => x.id === projectId);
  // An unresolved project reads as nothing, never its raw id (VS-403).
  return p ? (p.name ?? p.slug) : null;
}

function ScheduledRow({ r, projects, onFocus }: { r: Listed; projects: Array<{ id: string; slug: string; name?: string | null }>; onFocus: () => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const usage = useRoutineUsageFor(r.ws, r.id, '7d');
  const fires = useRoutineFires(r.ws, r.id, true);
  const patch = usePatchRoutineAt();
  const remove = useRemoveRoutineAt();
  const toast = useToast();
  const paused = r.status === 'paused';
  const last = fires.data?.[0];
  const dot = last ? (last.status === 'succeeded' ? 'bg-status-done' : last.status === 'failed' ? 'bg-failed' : 'bg-needs-you') : 'border border-line-3';
  const name = projectName(r.template.projectId, projects);
  return (
    <article>
      <div className="flex items-center gap-3 py-3">
        <span className={cx('size-2 flex-none rounded-pill', dot)} aria-hidden />
        <button type="button" className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left" aria-expanded={open} onClick={() => { setOpen((v) => !v); onFocus(); }}>
          <span className="truncate text-meta font-medium text-text-1">{r.name}</span>
          <span className="ac-mono text-nano text-text-2">
            {scheduleLabel(r)} · {r.workspaceName}
            {name ? <> · <span style={{ color: projectColorVar(r.template.projectId!, projects.map((p) => p.id)) }}>{name}</span></> : null}
          </span>
        </button>
        <div className="flex-none text-right">
          <div className="ac-mono text-micro text-text-2">in {dueLabel(r.nextFireAt)}</div>
          <div className="ac-mono text-nano text-text-3">{last ? `last ${last.status}` : `7d ${usage.data ? cents(usage.data.costCents) : '—'}`}</div>
        </div>
      </div>
      {open ? (
        <div className="v2-anim-fade flex flex-col gap-3 pb-4">
          <EditForm r={r} />
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={patch.isPending}
              onClick={() => patch.mutate({ ws: r.ws, id: r.id, patch: { status: paused ? 'active' : 'paused' } }, { onError: (e) => toast.push({ title: 'Could not change status', detail: e.message, status: 'failed' }) })}>
              {paused ? 'Resume' : 'Pause'}
            </Button>
            <Button size="sm" variant="danger" disabled={remove.isPending}
              onClick={() => remove.mutate({ ws: r.ws, id: r.id }, { onError: (e) => toast.push({ title: 'Could not remove', detail: e.message, status: 'failed' }) })}>
              Remove
            </Button>
            <span className="ac-mono ml-auto text-nano text-text-3">7d {usage.data ? cents(usage.data.costCents) : '—'}</span>
          </div>
          {fires.data?.length ? (
            <ol className="flex flex-col gap-1.5">
              {fires.data.slice(0, 5).map((f) => (
                <li key={f.wakeId} className="flex items-center gap-2 text-micro text-text-3">
                  <time className="ac-mono" dateTime={f.firedAt}>{dueLabel(f.firedAt)}</time>
                  <span className="v2-tag text-text-2">{f.status}</span>
                  {f.summary ? <span className="truncate text-text-2">{f.summary}</span> : null}
                </li>
              ))}
            </ol>
          ) : <p className="text-micro text-text-3">No fires yet.</p>}
        </div>
      ) : null}
    </article>
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
  const [instruction, setInstruction] = useState(r.template.instruction);
  const [action, setAction] = useState(r.template.action);
  const parsed = /^(\d{1,2}):(\d{2})$/.exec(daily.trim());
  const hour = parsed ? Number(parsed[1]) : NaN;
  const minute = parsed ? Number(parsed[2]) : NaN;
  const everyN = Number(every);
  const trigger = ((): Routine['trigger'] | null => {
    if (kind === 'daily') return Number.isInteger(hour) && hour <= 23 && Number.isInteger(minute) && minute <= 59 ? { kind: 'schedule', timezone: r.trigger.timezone, daily: { hour, minute } } : null;
    return Number.isInteger(everyN) && everyN >= 15 ? { kind: 'schedule', timezone: r.trigger.timezone, everyMinutes: everyN } : null;
  })();
  return (
    <div className="v2-recessed flex flex-col gap-2 rounded-r4 border border-line-1 p-3">
      <Field label="Name"><input aria-label="Task name" className={inputCx} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="When">
          <select aria-label="When" className={cx(inputCx, 'ac-mono')} value={kind} onChange={(e) => setKind(e.target.value as 'daily' | 'interval')}>
            <option value="daily">every day at</option>
            <option value="interval">every N minutes</option>
          </select>
        </Field>
        {kind === 'daily'
          ? <Field label="Time"><input aria-label="Time" className={cx(inputCx, 'ac-mono')} value={daily} onChange={(e) => setDaily(e.target.value)} /></Field>
          : <Field label="Minutes"><input aria-label="Minutes" type="number" min={15} className={cx(inputCx, 'ac-mono')} value={every} onChange={(e) => setEvery(e.target.value)} /></Field>}
      </div>
      <Field label="Instruction"><textarea aria-label="Instruction" className={cx(inputCx, 'h-16 py-1.5')} value={instruction} onChange={(e) => setInstruction(e.target.value)} /></Field>
      <Field label="Action">
        <select aria-label="Action" className={cx(inputCx, 'ac-mono')} value={action} onChange={(e) => setAction(e.target.value as Routine['template']['action'])}>
          <option value="report">report</option>
          <option value="file_work">file_work</option>
        </select>
      </Field>
      <div className="flex justify-end">
        <Button size="sm" variant="primary" disabled={!name.trim() || !instruction.trim() || !trigger || patch.isPending}
          onClick={() => { if (trigger) patch.mutate({ ws: r.ws, id: r.id, patch: { name: name.trim(), instruction: instruction.trim(), action, trigger } }, { onSuccess: () => toast.push({ title: 'Scheduled task updated' }), onError: (e) => toast.push({ title: 'Could not save', detail: e.message, status: 'failed' }) }); }}>
          Save
        </Button>
      </div>
    </div>
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
  const [instruction, setInstruction] = useState('');
  const [action, setAction] = useState<Routine['template']['action']>('report');
  const parsed = /^(\d{1,2}):(\d{2})$/.exec(daily.trim());
  const hour = parsed ? Number(parsed[1]) : NaN;
  const minute = parsed ? Number(parsed[2]) : NaN;
  const everyN = Number(every);
  const targetWs = workspaces.length === 1 ? workspaces[0]!.id : ws;
  const trigger = ((): { kind: 'schedule'; timezone?: string; daily?: { hour: number; minute: number }; everyMinutes?: number } | null => {
    if (kind === 'daily') return Number.isInteger(hour) && hour <= 23 && Number.isInteger(minute) && minute <= 59 ? { kind: 'schedule', daily: { hour, minute } } : null;
    return Number.isInteger(everyN) && everyN >= 15 ? { kind: 'schedule', everyMinutes: everyN } : null;
  })();
  const canAdd = Boolean(name.trim() && instruction.trim() && trigger && targetWs) && !create.isPending;
  return (
    <div className="v2-card flex flex-col gap-2 p-3">
      <span className="ac-label">Add a scheduled task</span>
      {workspaces.length > 1 ? (
        <Field label="Workspace">
          <select aria-label="Workspace" className={cx(inputCx, 'ac-mono')} value={targetWs} onChange={(e) => setWs(e.target.value)}>
            <option value="">Choose a workspace</option>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
      ) : null}
      <Field label="Name"><input aria-label="New task name" className={inputCx} value={name} onChange={(e) => setName(e.target.value)} placeholder="Morning review" /></Field>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="When">
          <select aria-label="New when" className={cx(inputCx, 'ac-mono')} value={kind} onChange={(e) => setKind(e.target.value as 'daily' | 'interval')}>
            <option value="daily">every day at</option>
            <option value="interval">every N minutes</option>
          </select>
        </Field>
        {kind === 'daily'
          ? <Field label="Time" hint="HH:MM"><input aria-label="New time" className={cx(inputCx, 'ac-mono')} value={daily} onChange={(e) => setDaily(e.target.value)} /></Field>
          : <Field label="Minutes" hint="15 or more"><input aria-label="New minutes" type="number" min={15} className={cx(inputCx, 'ac-mono')} value={every} onChange={(e) => setEvery(e.target.value)} /></Field>}
      </div>
      <Field label="Instruction"><textarea aria-label="New instruction" className={cx(inputCx, 'h-16 py-1.5')} value={instruction} onChange={(e) => setInstruction(e.target.value)} /></Field>
      <Field label="Action">
        <select aria-label="New action" className={cx(inputCx, 'ac-mono')} value={action} onChange={(e) => setAction(e.target.value as Routine['template']['action'])}>
          <option value="report">report</option>
          <option value="file_work">file_work</option>
        </select>
      </Field>
      <div className="flex justify-end">
        <Button variant="primary" disabled={!canAdd}
          onClick={() => { if (trigger && targetWs) create.mutate({ ws: targetWs, name: name.trim(), trigger, instruction: instruction.trim(), action }, { onSuccess: () => { toast.push({ title: 'Scheduled task added' }); setName(''); setInstruction(''); }, onError: (e) => toast.push({ title: 'Could not add', detail: e.message, status: 'failed' }) }); }}>
          Add scheduled task
        </Button>
      </div>
    </div>
  );
}
