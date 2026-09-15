/**
 * V2 conversational onboarding (VS-353, mockup 16-onboarding). Five steps, one weaver message each,
 * driving the same daemon operations V1's onboarding does: `weave init`, the model write, the
 * project add and the workspace config write. Only the presentation is different — and the autonomy
 * question, whose three answers persist existing workspace settings on a successful create.
 *
 * Step 3 is where the mockup's answer chips live. Nothing about the create path is forked from V1:
 * `useInitWorkspace`, `PUT /models`, `POST /projects`, the job stream and the resume record are the
 * same machinery `routes/Onboarding.tsx` uses.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RuntimeInfo, RuntimeModel } from '../api/types';
import { useGo } from '../app/link';
import { api, ApiError, setWorkspaceId } from '../api/client';
import { useHealth, useInitWorkspace, useRuntimes, useRuntimeModels } from '../api/hooks';
import { Button } from '../components/Button';
import { Skeleton } from '../components/Skeleton';
import { cx } from '../lib/cx';
import { isRuntimeAvailable, modelOptionLabel, runtimeStatusLabel } from '../lib/runtime';
import {
  prefixOf,
  readResume,
  slugFromGitUrl,
  slugOf,
  StepRow,
  writeResume,
  type StepView,
} from '../lib/onboarding';

const TOTAL = 5;

interface ProjectDraft {
  url: string;
  id: string;
  maxWorkers: number;
  setupCommand: string;
  idTouched: boolean;
}

type Autonomy = 'human' | 'merges' | 'yolo';

const AUTONOMY: Array<{ key: Autonomy; label: string }> = [
  { key: 'human', label: 'Ask me before any plan' },
  { key: 'merges', label: 'Only merges and actions' },
  { key: 'yolo', label: 'Let the weaver decide' },
];

const AUTONOMY_NOTE =
  'Ask me before any plan: I check with you before a plan or a merge. ' +
  'Only merges and actions: plans run, while merges and actions still come to you. ' +
  'Let the weaver decide: I approve plans and merges myself. ' +
  'Action approvals always stay with you. Change this any time in Settings.';

const INPUT = 'h-9 w-full rounded-r6 border border-line-2 bg-bg-input px-3 text-body text-text-1 outline-none focus:border-accent';
const PREFIX_RE = /^[A-Z][A-Z0-9]{1,9}$/;

/**
 * The workspace-defaults patch the autonomy question writes, mapped onto the workspace settings
 * that already exist and are edited in Settings (VS-353). VS-382: "Let the weaver decide" no longer
 * writes a workspace-wide YOLO default, so it contributes nothing here — its autonomy is scoped to
 * the projects added by the run (`autonomyProjectPolicies`). Exported so the mapping is testable.
 */
export function autonomyDefaults(a: Autonomy): Record<string, unknown> {
  if (a === 'yolo') return {};
  return { proposalApproval: a === 'merges' ? 'weaver' : 'human' };
}

/** The project policies the autonomy answer asks for: only "Let the weaver decide" turns YOLO on. */
export function autonomyProjectPolicies(a: Autonomy): Record<string, unknown> {
  return a === 'yolo' ? { yolo: true } : {};
}

interface StartedAdd { project?: { id?: string } | null; jobId?: string | null }

export function V2OnboardingPage(): React.ReactElement {
  const health = useHealth();
  const runtimes = useRuntimes();
  const go = useGo();
  const qc = useQueryClient();
  const init = useInitWorkspace();

  const [step, setStep] = useState(0);

  const [name, setName] = useState('');
  const [humanName, setHumanName] = useState('');
  const [id, setId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [prefix, setPrefix] = useState('');
  const [prefixTouched, setPrefixTouched] = useState(false);
  const [path, setPath] = useState('');
  const [pathTouched, setPathTouched] = useState(false);

  const [projects, setProjects] = useState<ProjectDraft[]>([]);
  const [autonomy, setAutonomy] = useState<Autonomy | null>(null);

  const [runtime, setRuntime] = useState('');
  const [model, setModel] = useState('');

  const root = health.data?.host?.defaultWorkspaceRoot ?? '~/weave';
  useEffect(() => { if (!idTouched) setId(slugOf(name)); }, [name, idTouched]);
  useEffect(() => { if (!prefixTouched) setPrefix(name ? prefixOf(name) : ''); }, [name, prefixTouched]);
  useEffect(() => { if (!pathTouched) setPath(id ? `${root}/${id}` : ''); }, [id, root, pathTouched]);

  const available = useMemo(() => (runtimes.data ?? []).filter(isRuntimeAvailable), [runtimes.data]);
  useEffect(() => { if (!runtime && available[0]) setRuntime(available[0].id); }, [available, runtime]);
  const models = useRuntimeModels(runtime || null);

  const [progress, setProgress] = useState<StepView[]>([]);
  const [creating, setCreating] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [workspaceId, setWsId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!progress.some((s) => s.state === 'running')) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [progress]);

  // A reload mid-create comes back to the same steps, re-attached to the jobs still running.
  useEffect(() => {
    const resume = readResume();
    if (!resume) return;
    setWsId(resume.workspaceId);
    setProgress(resume.steps);
    setName((n) => n || resume.name);
    setStep(TOTAL - 1);
    setCreating(resume.steps.some((s) => s.state === 'running' || s.state === 'pending'));
    if (resume.steps.every((s) => s.state === 'done')) setCreatedId(resume.workspaceId);
  }, []);

  const workspaceValid = name.trim().length > 0 && /^[a-z0-9][a-z0-9-]{0,39}$/.test(id) && PREFIX_RE.test(prefix) && path.trim().length > 0;
  const projectsValid = projects.every((p) => p.url.trim().length > 0 && /^[a-z0-9][a-z0-9-]*$/.test(p.id));
  const step3Valid = (projects.length === 0 || projectsValid) && autonomy !== null;

  const addProject = (): void => setProjects((p) => [...p, { url: '', id: '', maxWorkers: 2, setupCommand: '', idTouched: false }]);
  const patchProject = (i: number, patch: Partial<ProjectDraft>): void =>
    setProjects((p) => p.map((d, j) => {
      if (j !== i) return d;
      const next = { ...d, ...patch };
      if (patch.url !== undefined && !next.idTouched) next.id = slugFromGitUrl(patch.url);
      return next;
    }));

  const patchStep = useCallback((i: number, patch: Partial<StepView>, ws?: string): void => {
    setProgress((prev) => {
      const next = prev.map((s, j) => (j === i ? { ...s, ...patch } : s));
      const wid = ws ?? workspaceId;
      if (wid) writeResume({ workspaceId: wid, name, steps: next });
      return next;
    });
  }, [workspaceId, name]);

  const create = async (): Promise<void> => {
    setCreating(true);
    const steps: StepView[] = [
      { label: `Create workspace ${name}`, state: 'pending' },
      { label: `Set the models${model ? ` (${runtime} · ${model})` : ` (${runtime})`} and the approval policy`, state: 'pending' },
      ...projects.map((p) => ({ label: `Add project ${p.id}`, state: 'pending' as const })),
    ];
    setProgress(steps);
    let wsId: string;
    try {
      patchStep(0, { state: 'running', startedAt: Date.now() });
      const r = await init.mutateAsync({ id, name: name.trim(), ticketPrefix: prefix, path: path.trim() });
      wsId = r.id;
      setWsId(wsId);
      patchStep(0, { state: 'done', detail: r.path, endedAt: Date.now() }, wsId);
    } catch (e) {
      patchStep(0, { state: 'failed', detail: describe(e), endedAt: Date.now() });
      setCreating(false);
      return;
    }
    try {
      patchStep(1, { state: 'running', startedAt: Date.now() }, wsId);
      const setting = { runtime, model: model || null };
      await api.ws(wsId, '/models', { method: 'PUT', body: { weaver: setting, workers: setting } });
      if (humanName.trim()) await api.ws(wsId, '/config', { method: 'PATCH', body: { weaver: { humanName: humanName.trim() } } });
      // The autonomy answer lands only now that the workspace exists (VS-353). VS-382: "Let the
      // weaver decide" writes no workspace default — it is applied per project below.
      const wsDefaults = autonomyDefaults(autonomy ?? 'human');
      if (Object.keys(wsDefaults).length > 0) {
        await api.ws(wsId, '/config', { method: 'PATCH', body: { defaults: wsDefaults } });
      }
      patchStep(1, { state: 'done', endedAt: Date.now() }, wsId);
    } catch (e) {
      patchStep(1, { state: 'failed', detail: describe(e), endedAt: Date.now() }, wsId);
    }
    for (let i = 0; i < projects.length; i++) {
      const p = projects[i]!;
      try {
        patchStep(2 + i, { state: 'running', startedAt: Date.now() }, wsId);
        const started = await api.ws<StartedAdd>(wsId, '/projects', {
          method: 'POST',
          body: {
            url: p.url.trim(), id: p.id, maxWorkers: p.maxWorkers,
            ...(p.setupCommand.trim() ? { setupCommand: p.setupCommand.trim() } : {}),
            ...(Object.keys(autonomyProjectPolicies(autonomy ?? 'human')).length > 0 ? { policies: autonomyProjectPolicies(autonomy ?? 'human') } : {}),
          },
        });
        patchStep(2 + i, { jobId: started?.jobId ?? undefined, projectId: started?.project?.id ?? p.id }, wsId);
      } catch (e) {
        patchStep(2 + i, { state: 'failed', detail: describe(e), endedAt: Date.now() }, wsId);
      }
    }
    setWorkspaceId(wsId);
    await qc.invalidateQueries();
    setCreating(false);
  };

  const finishStep = useCallback((i: number, state: 'done' | 'failed', detail?: string): void => {
    patchStep(i, { state, endedAt: Date.now(), ...(detail !== undefined ? { detail } : {}) });
  }, [patchStep]);

  const retryStep = useCallback(async (i: number): Promise<void> => {
    const stepRow = progress[i];
    if (!stepRow?.projectId || !workspaceId) return;
    patchStep(i, { state: 'running', startedAt: Date.now(), endedAt: undefined, detail: undefined, jobId: undefined });
    try {
      const started = await api.ws<StartedAdd>(workspaceId, `/projects/${encodeURIComponent(stepRow.projectId)}/retry`, { method: 'POST', body: {} });
      patchStep(i, { jobId: started?.jobId ?? undefined });
    } catch (e) {
      patchStep(i, { state: 'failed', detail: describe(e), endedAt: Date.now() });
    }
  }, [progress, workspaceId, patchStep]);

  const allDone = progress.length > 0 && progress.every((s) => s.state === 'done' || s.state === 'failed');
  useEffect(() => {
    if (!allDone || !workspaceId || createdId) return;
    setCreatedId(workspaceId);
    void qc.invalidateQueries();
  }, [allDone, workspaceId, createdId, qc]);

  const answerFor = (i: number): string => {
    if (i === 0) return `${name}${humanName.trim() ? ` · call me ${humanName.trim()}` : ''}`;
    if (i === 1) return `${id} · ${prefix} · ${path}`;
    if (i === 2) return projects.length ? projects.map((p) => p.url || p.id).join(', ') : 'no projects yet';
    if (i === 3) return `${runtimes.data?.find((r) => r.id === runtime)?.displayName ?? runtime}${model ? ` · ${model}` : ' · default model'}`;
    return '';
  };

  if (health.isLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <Skeleton className="h-40 w-full max-w-lg rounded-r6" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-[38px] flex-none items-center gap-3 border-b border-line-1 bg-bg-0 px-4">
        <h1 className="text-ui font-medium tracking-[-0.005em] text-text-1">Set up your workspace</h1>
        <span className="ac-mono text-micro text-text-3">Step {step + 1} of {TOTAL}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-4 py-5">
          <div className="flex items-center gap-2.5">
            <div className="h-[3px] flex-1 overflow-hidden rounded-pill bg-bg-3">
              <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${((step + 1) / TOTAL) * 100}%` }} />
            </div>
            <span className="ac-mono text-[10.5px] text-text-3">{step + 1} / {TOTAL}</span>
          </div>

          {Array.from({ length: step }, (_, i) => (
            <div key={i} className="flex flex-col gap-4">
              <WeaverMessage>{question(i)}</WeaverMessage>
              <HumanMessage>{answerFor(i)}</HumanMessage>
            </div>
          ))}

          {step < TOTAL - 1 ? (
            <>
              <WeaverMessage>{question(step)}</WeaverMessage>
              {step === 0 ? (
                <div className="flex flex-col gap-3">
                  <Input label="Business name" value={name} autoFocus onChange={setName} placeholder="Acme Labs" />
                  <Input label="What should I call you?" value={humanName} onChange={setHumanName} placeholder="captain" />
                </div>
              ) : null}
              {step === 1 ? (
                <div className="flex flex-col gap-3">
                  <Input label="Id" value={id} onChange={(v) => { setIdTouched(true); setId(slugOf(v)); }} mono />
                  <Input label="Ticket prefix" value={prefix} onChange={(v) => { setPrefixTouched(true); setPrefix(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)); }} mono error={prefix && !PREFIX_RE.test(prefix) ? 'A–Z then A–Z/0–9, 2–10 characters' : undefined} />
                  <Input label="Directory on the daemon host" value={path} onChange={(v) => { setPathTouched(true); setPath(v); }} mono />
                </div>
              ) : null}
              {step === 2 ? (
                <div className="flex flex-col gap-3">
                  {projects.map((p, i) => (
                    <div key={i} className="v2-card flex flex-col gap-2 p-3">
                      <Input label="Git URL" value={p.url} autoFocus onChange={(v) => patchProject(i, { url: v })} placeholder="git@github.com:acme/web.git" mono />
                      <div className="grid grid-cols-2 gap-2">
                        <Input label="Id" value={p.id} onChange={(v) => patchProject(i, { id: slugOf(v), idTouched: true })} mono />
                        <Input label="Max workers" value={String(p.maxWorkers)} onChange={(v) => patchProject(i, { maxWorkers: Math.max(1, Math.min(32, Number(v) || 1)) })} />
                      </div>
                      <div className="flex justify-end">
                        <Button variant="ghost" size="sm" onClick={() => setProjects((all) => all.filter((_, j) => j !== i))}>Remove</Button>
                      </div>
                    </div>
                  ))}
                  <div>
                    <Button variant="secondary" onClick={addProject}>{projects.length ? 'Add another project' : 'Add a project'}</Button>
                  </div>
                  <div className="mt-1 flex flex-col gap-3">
                    <div className="text-[13px] leading-relaxed text-text-body">How much should I check with you before acting?</div>
                    <div className="flex flex-wrap gap-2">
                      {AUTONOMY.map((a) => (
                        <button
                          key={a.key}
                          type="button"
                          aria-pressed={autonomy === a.key}
                          onClick={() => setAutonomy(a.key)}
                          className={cx('v2-tag h-7 px-3 text-[11px]', autonomy === a.key ? 'border-accent bg-accent-tint text-text-1' : 'text-text-2 hover:text-text-1')}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] leading-relaxed text-text-3">{AUTONOMY_NOTE}</p>
                  </div>
                </div>
              ) : null}
              {step === 3 ? (
                <div className="flex flex-col gap-3">
                  {runtimes.isLoading ? <Skeleton className="h-16 w-full rounded-r6" /> : available.length === 0 ? (
                    <div className="rounded-r6 border border-blocked/35 bg-blocked/8 p-3 text-meta text-text-1">
                      No coding CLI was detected on the daemon host. Install one there, then reload.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {(runtimes.data ?? []).map((r: RuntimeInfo) => {
                        const ok = isRuntimeAvailable(r);
                        return (
                          <button
                            key={r.id}
                            type="button"
                            disabled={!ok}
                            onClick={() => { setRuntime(r.id); setModel(''); }}
                            className={cx('flex flex-col items-start gap-0.5 rounded-r6 border p-3 text-left', runtime === r.id ? 'border-accent bg-accent-tint' : 'border-line-2 bg-bg-input hover:bg-bg-2', !ok && 'cursor-not-allowed opacity-50')}
                          >
                            <span className="text-ui font-medium text-text-1">{r.displayName}</span>
                            <span className="ac-mono text-micro text-text-3">{runtimeStatusLabel(r)}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <label className="flex flex-col gap-1.5">
                    <span className="ac-label">Model</span>
                    <select value={model} onChange={(e) => setModel(e.target.value)} className={INPUT}>
                      <option value="">default</option>
                      {(models.data ?? []).map((m: RuntimeModel) => <option key={m.id} value={m.id}>{modelOptionLabel(m)}</option>)}
                    </select>
                  </label>
                </div>
              ) : null}

              <div className="mt-1 flex items-center justify-end gap-2">
                {step > 0 ? <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>Back</Button> : null}
                <Button
                  variant="primary"
                  disabled={step === 0 ? !name.trim() : step === 1 ? !workspaceValid : step === 2 ? !step3Valid : !runtime}
                  onClick={() => setStep((s) => s + 1)}
                >
                  {step === 2 && projects.length === 0 ? 'Skip for now' : 'Continue'}
                </Button>
              </div>
            </>
          ) : null}

          {step === TOTAL - 1 ? (
            <>
              <WeaverMessage>Here is what I will create.</WeaverMessage>
              {progress.length === 0 ? (
                <div className="flex flex-col gap-4">
                  <dl className="v2-card grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 p-4 text-meta">
                    <Row k="Workspace" v={`${name} · ${id} · ${prefix}-1`} />
                    <Row k="Directory" v={path} mono />
                    <Row k="Models" v={`${runtimes.data?.find((r) => r.id === runtime)?.displayName ?? runtime}${model ? ` · ${model}` : ' · default model'} — weaver and workers`} />
                    <Row k="Approval" v={AUTONOMY.find((a) => a.key === autonomy)?.label ?? 'Ask me before any plan'} />
                    <Row k="Projects" v={projects.length ? projects.map((p) => p.id).join(', ') : 'none yet'} />
                  </dl>
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" onClick={() => setStep(TOTAL - 2)}>Back</Button>
                    <Button variant="primary" onClick={() => void create()}>Create workspace</Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <ol className="v2-card flex flex-col divide-y divide-line-1 p-0">
                    {progress.map((s, i) => (
                      <StepRow key={i} step={s} now={now} workspaceId={workspaceId} onFinish={(state, detail) => finishStep(i, state, detail)} onRetry={s.projectId ? () => void retryStep(i) : undefined} />
                    ))}
                  </ol>
                  <div className="flex items-center justify-end gap-2">
                    {createdId ? (
                      <Button variant="primary" onClick={() => { writeResume(null); go(`/w/${createdId}/needs`, { replace: true }); }}>Open {name}</Button>
                    ) : creating || progress.some((s) => s.state === 'running' || s.state === 'pending') ? (
                      <span className="text-meta text-text-3">Working…</span>
                    ) : (
                      <Button variant="secondary" onClick={() => { writeResume(null); setProgress([]); setStep(0); }}>Fix and retry</Button>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function question(i: number): string {
  switch (i) {
    case 0: return 'Let’s set up your workspace. What should I call this business, and what should I call you?';
    case 1: return 'Where should I keep it on the daemon host? An id, a ticket prefix and a directory — I filled in sensible ones.';
    case 2: return 'Which repositories should I weave together? Paste a git URL and I will clone it, read it, and propose the first role.';
    case 3: return 'Which coding CLI should I think with? This is the default for me and every worker.';
    default: return '';
  }
}

function WeaverMessage({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12.5px] font-semibold text-text-strong">Weaver</span>
      <p className="max-w-[82%] text-[14px] leading-[1.55] text-text-body">{children}</p>
    </div>
  );
}

function HumanMessage({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="self-end max-w-[82%] rounded-[6px_10px_3px_10px] bg-accent px-3 py-2.5 text-[14px] leading-[1.5] text-accent-on">
      {children}
    </div>
  );
}

function Input({ label, value, onChange, placeholder, mono, error, autoFocus }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  error?: string;
  autoFocus?: boolean;
}): React.ReactElement {
  return (
    <label className="flex w-full flex-col gap-1.5">
      <span className="ac-label">{label}</span>
      <input autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cx(INPUT, mono && 'ac-mono')} />
      {error ? <span className="text-micro text-failed">{error}</span> : null}
    </label>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }): React.ReactElement {
  return (
    <>
      <dt className="text-text-3">{k}</dt>
      <dd className={cx('min-w-0 truncate text-text-1', mono && 'ac-mono text-micro')}>{v}</dd>
    </>
  );
}

function describe(e: unknown): string {
  if (e instanceof ApiError) return `${e.code}: ${e.message}`;
  return (e as Error)?.message ?? String(e);
}
