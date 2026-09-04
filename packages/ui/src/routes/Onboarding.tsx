/**
 * First-run onboarding and "new workspace" (PLAN §20 `conductor init`, DESIGN-CONTRACT first-run).
 * Four steps: the workspace, the conductor, projects, then create. Everything here is what
 * `conductor init` + `workspace config` + `project add` do; the daemon has no notion of a default
 * workspace, so a fresh install lands here until the first one exists.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGo } from '../app/link';
import { api, ApiError, setWorkspaceId } from '../api/client';
import { useHealth, useInitWorkspace, useMe, useRuntimeModels, useRuntimes } from '../api/hooks';
import type { RuntimeInfo } from '../api/types';
import { Button } from '../components/Button';
import { Skeleton } from '../components/Skeleton';
import { cx } from '../lib/cx';

type Step = 'workspace' | 'conductor' | 'projects' | 'create';
const STEPS: Array<{ key: Step; label: string }> = [
  { key: 'workspace', label: 'Workspace' },
  { key: 'conductor', label: 'Conductor' },
  { key: 'projects', label: 'Projects' },
  { key: 'create', label: 'Create' },
];

interface ProjectDraft { url: string; id: string; runtime: string; maxWorkers: number; setupCommand: string; idTouched: boolean }

export function slugOf(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function prefixOf(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const raw = words.length >= 2 ? words.map((w) => w[0]!).join('') : (words[0] ?? '').slice(0, 4);
  const up = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const withLetter = /^[A-Z]/.test(up) ? up : `X${up}`;
  return withLetter.slice(0, 5).padEnd(2, 'X');
}

export function slugFromGitUrl(url: string): string {
  const tail = url.trim().replace(/\/+$/, '').split(/[/:]/).pop() ?? '';
  return slugOf(tail.replace(/\.git$/, ''));
}

const INPUT = 'h-9 w-full rounded-r6 border border-line-2 bg-bg-input px-3 text-body text-text-1 outline-none focus:border-accent';
const PREFIX_RE = /^[A-Z][A-Z0-9]{1,9}$/;

export function OnboardingRoute(): React.ReactElement {
  const health = useHealth();
  const me = useMe();
  const runtimes = useRuntimes();
  const go = useGo();
  const qc = useQueryClient();
  const init = useInitWorkspace();

  // Decided once: creating the first workspace must not flip the copy to "new workspace" mid-flow.
  const [isFirstRun, setIsFirstRun] = useState<boolean | null>(null);
  useEffect(() => { if (isFirstRun === null && health.data) setIsFirstRun((health.data.workspaces?.length ?? 0) === 0); }, [health.data, isFirstRun]);
  const [step, setStep] = useState<Step>('workspace');

  // Step 1 — workspace
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [prefix, setPrefix] = useState('');
  const [prefixTouched, setPrefixTouched] = useState(false);
  const [path, setPath] = useState('');
  const [pathTouched, setPathTouched] = useState(false);

  useEffect(() => { if (!idTouched) setId(slugOf(name)); }, [name, idTouched]);
  useEffect(() => { if (!prefixTouched) setPrefix(name ? prefixOf(name) : ''); }, [name, prefixTouched]);
  const root = health.data?.host?.defaultWorkspaceRoot ?? '~/agent-conductor';
  useEffect(() => { if (!pathTouched) setPath(id ? `${root}/${id}` : ''); }, [id, root, pathTouched]);

  // Step 2 — conductor
  const available = useMemo(() => (runtimes.data ?? []).filter(isAvailable), [runtimes.data]);
  const [runtime, setRuntime] = useState<string>('');
  useEffect(() => { if (!runtime && available[0]) setRuntime(available[0].id); }, [available, runtime]);
  const models = useRuntimeModels(runtime || null);
  const [model, setModel] = useState<string>('');
  const [humanName, setHumanName] = useState('');

  // Step 3 — projects
  const [projects, setProjects] = useState<ProjectDraft[]>([]);
  const addProject = (): void => setProjects((p) => [...p, { url: '', id: '', runtime: runtime || available[0]?.id || 'claude', maxWorkers: 2, setupCommand: '', idTouched: false }]);
  const patchProject = (i: number, patch: Partial<ProjectDraft>): void =>
    setProjects((p) => p.map((d, j) => {
      if (j !== i) return d;
      const next = { ...d, ...patch };
      if (patch.url !== undefined && !next.idTouched) next.id = slugFromGitUrl(patch.url);
      return next;
    }));

  // Step 4 — create
  const [progress, setProgress] = useState<Array<{ label: string; state: 'pending' | 'running' | 'done' | 'failed'; detail?: string }>>([]);
  const [creating, setCreating] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const workspaceValid = name.trim().length > 0 && /^[a-z0-9][a-z0-9-]{0,39}$/.test(id) && PREFIX_RE.test(prefix) && path.trim().length > 0;
  const conductorValid = runtime.length > 0;
  const projectsValid = projects.every((p) => p.url.trim().length > 0 && /^[a-z0-9][a-z0-9-]*$/.test(p.id));

  const create = async (): Promise<void> => {
    setCreating(true);
    const steps = [
      { label: `Create workspace ${name}`, state: 'pending' as const },
      { label: `Configure the conductor (${runtime}${model ? ` · ${model}` : ''})`, state: 'pending' as const },
      ...projects.map((p) => ({ label: `Add project ${p.id}`, state: 'pending' as const })),
    ];
    setProgress(steps);
    const mark = (i: number, state: 'running' | 'done' | 'failed', detail?: string): void =>
      setProgress((prev) => prev.map((s, j) => (j === i ? { ...s, state, ...(detail !== undefined ? { detail } : {}) } : s)));
    let wsId: string;
    try {
      mark(0, 'running');
      const r = await init.mutateAsync({ id, name: name.trim(), ticketPrefix: prefix, path: path.trim() });
      wsId = r.id;
      mark(0, 'done', r.path);
    } catch (e) {
      mark(0, 'failed', describe(e));
      setCreating(false);
      return;
    }
    try {
      mark(1, 'running');
      const conductor: Record<string, unknown> = { runtime, model: model || null };
      if (humanName.trim()) conductor['humanName'] = humanName.trim();
      await api.ws(wsId, '/config', { method: 'PATCH', body: { conductor } });
      mark(1, 'done');
    } catch (e) {
      mark(1, 'failed', describe(e));
    }
    for (let i = 0; i < projects.length; i++) {
      const p = projects[i]!;
      try {
        mark(2 + i, 'running');
        await api.ws(wsId, '/projects', {
          method: 'POST',
          body: { url: p.url.trim(), id: p.id, runtime: p.runtime, maxWorkers: p.maxWorkers, ...(p.setupCommand.trim() ? { setupCommand: p.setupCommand.trim() } : {}) },
        });
        mark(2 + i, 'done');
      } catch (e) {
        mark(2 + i, 'failed', describe(e));
      }
    }
    setWorkspaceId(wsId);
    setCreatedId(wsId);
    await qc.invalidateQueries();
    setCreating(false);
  };

  if (health.isLoading || me.isLoading) {
    return (
      <Frame>
        <Skeleton className="h-9 w-full rounded-r6" />
        <Skeleton className="mt-3 h-9 w-full rounded-r6" />
      </Frame>
    );
  }

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <Frame>
      <div className="mb-6">
        <h2 className="text-title font-semibold tracking-title text-text-strong">{isFirstRun ? 'Set up your first workspace' : 'New workspace'}</h2>
        <p className="mt-1 text-meta leading-relaxed text-text-2">
          {isFirstRun
            ? 'A workspace is one business: its projects, the conductor you talk to, the roles it hires, and its knowledge. Everything below can be changed later in Settings.'
            : 'Another business, another conductor. Projects, roles and knowledge stay separate.'}
        </p>
      </div>

      <ol className="mb-6 flex items-center gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className={cx(
                'flex size-5 items-center justify-center rounded-full text-nano font-semibold',
                i < stepIndex ? 'bg-accent text-accent-on' : i === stepIndex ? 'border border-accent text-accent-link' : 'border border-line-2 text-text-3',
              )}
            >
              {i < stepIndex ? '✓' : i + 1}
            </span>
            <span className={cx('text-meta', i === stepIndex ? 'font-medium text-text-1' : 'text-text-3')}>{s.label}</span>
            {i < STEPS.length - 1 ? <span className="mx-1 h-px w-5 bg-line-2" /> : null}
          </li>
        ))}
      </ol>

      {step === 'workspace' ? (
        <section className="flex flex-col gap-4">
          <Field label="Name" hint="How it appears everywhere. Usually the business or product.">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Labs" className={INPUT} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Id" hint="Slug used in URLs and `-w`.">
              <input value={id} onChange={(e) => { setIdTouched(true); setId(slugOf(e.target.value)); }} className={cx(INPUT, 'ac-mono')} />
            </Field>
            <Field label="Ticket prefix" hint="ACME-42 style. 2–10 characters." error={prefix && !PREFIX_RE.test(prefix) ? 'A–Z then A–Z/0–9, 2–10 characters' : undefined}>
              <input value={prefix} onChange={(e) => { setPrefixTouched(true); setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)); }} className={cx(INPUT, 'ac-mono')} />
            </Field>
          </div>
          <Field label="Directory on the daemon host" hint={`Created on ${health.data?.host?.hostname ?? 'the daemon host'}: workspace.yaml, roles, knowledge, project clones, worktrees.`}>
            <input value={path} onChange={(e) => { setPathTouched(true); setPath(e.target.value); }} className={cx(INPUT, 'ac-mono')} />
          </Field>
          <Actions>
            <Button variant="primary" disabled={!workspaceValid} onClick={() => setStep('conductor')}>Continue</Button>
          </Actions>
        </section>
      ) : null}

      {step === 'conductor' ? (
        <section className="flex flex-col gap-4">
          <Field group label="Runtime" hint="The coding CLI the conductor runs on. Only CLIs installed on the daemon host are offered; log in with `conductor runtime login <id>` if a run later fails with auth.">
            {runtimes.isLoading ? <Skeleton className="h-16 w-full rounded-r6" /> : available.length === 0 ? (
              <div className="rounded-r6 border border-blocked/35 bg-blocked/8 p-3 text-meta text-text-1">
                No coding CLI was detected on the daemon host. Install claude, codex, opencode or gemini there, then reload.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {(runtimes.data ?? []).map((r) => {
                  const ok = isAvailable(r);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      disabled={!ok}
                      onClick={() => { setRuntime(r.id); setModel(''); }}
                      className={cx(
                        'flex flex-col items-start gap-0.5 rounded-r6 border p-3 text-left transition-colors',
                        runtime === r.id ? 'border-accent bg-accent/8' : 'border-line-2 bg-bg-input hover:bg-bg-2',
                        !ok && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      <span className="text-ui font-medium text-text-1">{r.displayName}</span>
                      <span className="ac-mono text-micro text-text-3">{ok ? r.detection.version ?? 'available' : 'not installed on the daemon host'}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Field>
          <Field label="Model" hint="Leave on default to let the CLI pick. Change any time in Settings.">
            <select value={model} onChange={(e) => setModel(e.target.value)} className={INPUT}>
              <option value="">default</option>
              {(models.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Your name" hint="How the conductor addresses you. Empty means “captain”.">
            <input value={humanName} onChange={(e) => setHumanName(e.target.value)} placeholder="captain" className={INPUT} />
          </Field>
          <Actions>
            <Button variant="ghost" onClick={() => setStep('workspace')}>Back</Button>
            <Button variant="primary" disabled={!conductorValid} onClick={() => setStep('projects')}>Continue</Button>
          </Actions>
        </section>
      ) : null}

      {step === 'projects' ? (
        <section className="flex flex-col gap-4">
          <p className="text-meta leading-relaxed text-text-2">
            A project is a git repository the workspace works on. Adding one clones it on the daemon host, adopts OpenSpec, seeds its knowledge base and creates a scout ticket that describes the repo. You can add projects later from the conductor or Settings.
          </p>
          {projects.map((p, i) => (
            <div key={i} className="ac-card flex flex-col gap-3 p-3.5">
              <Field label="Git URL">
                <input autoFocus value={p.url} onChange={(e) => patchProject(i, { url: e.target.value })} placeholder="git@github.com:acme/api.git" className={cx(INPUT, 'ac-mono')} />
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Id">
                  <input value={p.id} onChange={(e) => patchProject(i, { id: slugOf(e.target.value), idTouched: true })} className={cx(INPUT, 'ac-mono')} />
                </Field>
                <Field label="Runtime">
                  <select value={p.runtime} onChange={(e) => patchProject(i, { runtime: e.target.value })} className={INPUT}>
                    {(runtimes.data ?? []).map((r) => (
                      <option key={r.id} value={r.id} disabled={!isAvailable(r)}>{r.displayName}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Max workers">
                  <input type="number" min={1} max={32} value={p.maxWorkers} onChange={(e) => patchProject(i, { maxWorkers: Math.max(1, Math.min(32, Number(e.target.value) || 1)) })} className={INPUT} />
                </Field>
              </div>
              <Field label="Setup command" hint="Runs once in every new worktree, e.g. pnpm install. Optional.">
                <input value={p.setupCommand} onChange={(e) => patchProject(i, { setupCommand: e.target.value })} placeholder="pnpm install" className={cx(INPUT, 'ac-mono')} />
              </Field>
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => setProjects((all) => all.filter((_, j) => j !== i))}>Remove</Button>
              </div>
            </div>
          ))}
          <div>
            <Button variant="secondary" onClick={addProject}>{projects.length ? 'Add another project' : 'Add a project'}</Button>
          </div>
          <Actions>
            <Button variant="ghost" onClick={() => setStep('conductor')}>Back</Button>
            <Button variant="primary" disabled={!projectsValid} onClick={() => setStep('create')}>{projects.length ? 'Continue' : 'Skip for now'}</Button>
          </Actions>
        </section>
      ) : null}

      {step === 'create' ? (
        <section className="flex flex-col gap-4">
          {progress.length === 0 ? (
            <>
              <dl className="ac-card grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 p-4 text-meta">
                <Row k="Workspace" v={`${name} · ${id} · ${prefix}-1`} />
                <Row k="Directory" v={path} mono />
                <Row k="Conductor" v={`${runtimes.data?.find((r) => r.id === runtime)?.displayName ?? runtime}${model ? ` · ${model}` : ' · default model'}`} />
                <Row k="Addresses you as" v={humanName.trim() || 'captain'} />
                <Row k="Projects" v={projects.length ? projects.map((p) => `${p.id} (${p.runtime})`).join(', ') : 'none yet'} />
              </dl>
              <Actions>
                <Button variant="ghost" onClick={() => setStep('projects')}>Back</Button>
                <Button variant="primary" onClick={() => void create()}>Create workspace</Button>
              </Actions>
            </>
          ) : (
            <>
              <ol className="ac-card flex flex-col divide-y divide-line-1 p-0">
                {progress.map((s, i) => (
                  <li key={i} className="flex items-start gap-3 px-4 py-3">
                    <span className={cx('ac-mono mt-0.5 w-14 flex-none text-nano uppercase', s.state === 'done' ? 'text-done' : s.state === 'failed' ? 'text-failed' : s.state === 'running' ? 'text-accent-link' : 'text-text-3')}>
                      {s.state}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-meta text-text-1">{s.label}</span>
                      {s.detail ? <span className={cx('ac-mono block truncate text-micro', s.state === 'failed' ? 'text-failed' : 'text-text-3')}>{s.detail}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
              <Actions>
                {createdId ? (
                  <Button variant="primary" onClick={() => go(`/w/${createdId}/needs`, { replace: true })}>Open {name}</Button>
                ) : creating ? (
                  <span className="text-meta text-text-3">Working…</span>
                ) : (
                  <Button variant="secondary" onClick={() => { setProgress([]); setStep('workspace'); }}>Fix and retry</Button>
                )}
              </Actions>
            </>
          )}
        </section>
      ) : null}

      {!isFirstRun ? (
        <div className="mt-8 text-center">
          <Button variant="link" onClick={() => window.history.back()}>Cancel</Button>
        </div>
      ) : null}
    </Frame>
  );
}

function isAvailable(r: RuntimeInfo): boolean {
  return r.detection?.status === 'available' || r.detection?.available === true;
}

function describe(e: unknown): string {
  if (e instanceof ApiError) return `${e.code}: ${e.message}`;
  return (e as Error)?.message ?? String(e);
}

function Frame({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex min-h-dvh items-start justify-center bg-bg-0 p-6 md:items-center">
      <div className="w-full max-w-lg">
        <div className="mb-7 flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-r6 bg-accent">
            <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
              <path d="M6 0.3 L11.7 6 L6 11.7 L0.3 6 Z" fill="var(--accent-on)" />
            </svg>
          </span>
          <h1 className="text-title font-semibold tracking-title text-text-strong">AgentConductor</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A labelled control. `group` renders a div (for a set of buttons) so the children keep their own semantics. */
function Field({ label, hint, error, group, children }: { label: string; hint?: string; error?: string; group?: boolean; children: React.ReactNode }): React.ReactElement {
  const Tag: 'label' | 'div' = group ? 'div' : 'label';
  return (
    <Tag className="flex flex-col gap-1.5" {...(group ? { role: 'group', 'aria-label': label } : {})}>
      <span className="ac-label">{label}</span>
      {children}
      {error ? <span className="text-micro text-failed">{error}</span> : hint ? <span className="text-micro leading-relaxed text-text-3">{hint}</span> : null}
    </Tag>
  );
}

function Actions({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="mt-2 flex items-center justify-end gap-2">{children}</div>;
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }): React.ReactElement {
  return (
    <>
      <dt className="text-text-3">{k}</dt>
      <dd className={cx('min-w-0 truncate text-text-1', mono && 'ac-mono text-micro')}>{v}</dd>
    </>
  );
}
