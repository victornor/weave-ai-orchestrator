import type { Project } from '@weave-ai/shared';
import { ApiError } from '../api/client';

export type MoveProjectKind = 'slug_clash' | 'add_failed' | 'archive_failed';

export class MoveProjectError extends Error {
  readonly kind: MoveProjectKind;
  constructor(kind: MoveProjectKind, message: string) {
    super(message);
    this.name = 'MoveProjectError';
    this.kind = kind;
  }
}

/** Same predicate as `projects.remove`: anything not retired or done blocks. */
export function liveWorkerCount(
  workers: ReadonlyArray<{ projectId: string | null; status: string }>,
  projectId: string,
): number {
  return workers.filter((w) => w.projectId === projectId && w.status !== 'retired' && w.status !== 'done').length;
}

/** Matches the DELETE conflict message so the pre-check and a 409 read the same. */
export function liveWorkersReason(slug: string, count: number): string {
  return `project ${slug} still has ${count} live worker(s)`;
}

export function isWorkerConflict(err: unknown): boolean {
  return err instanceof ApiError && (err.code === 'conflict' || err.status === 409);
}

/** Body for `POST /projects` on the destination: git URL plus the source row's settings. */
export function addProjectBody(project: Project): {
  url: string;
  id: string;
  name: string;
  defaultBranch: string;
  landingBranch?: string;
  maxWorkers: number;
  setupCommand?: string;
  policies: Record<string, unknown>;
} {
  return {
    url: project.gitUrl,
    id: project.slug,
    name: project.name,
    defaultBranch: project.defaultBranch,
    ...(project.landingBranch ? { landingBranch: project.landingBranch } : {}),
    maxWorkers: project.maxWorkers,
    ...(project.setupCommand ? { setupCommand: project.setupCommand } : {}),
    policies: project.policies,
  };
}

/**
 * Add on dest, then archive the source. Dest slug clash (including archived dest rows) writes
 * nothing. A failed dest POST never DELETEs. A failed DELETE after dest accepted is
 * `archive_failed` so the operator can Remove here.
 */
export async function moveProject(opts: {
  project: Project;
  listDestProjects: () => Promise<Project[]>;
  addToDest: (body: ReturnType<typeof addProjectBody>) => Promise<unknown>;
  archiveSource: () => Promise<unknown>;
}): Promise<void> {
  let dest: Project[];
  try {
    dest = await opts.listDestProjects();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The destination projects could not be read';
    throw new MoveProjectError('add_failed', message);
  }
  if (dest.some((p) => p.slug === opts.project.slug)) {
    throw new MoveProjectError(
      'slug_clash',
      `The destination already has a project named ${opts.project.slug}`,
    );
  }
  try {
    await opts.addToDest(addProjectBody(opts.project));
  } catch (err) {
    if (err instanceof MoveProjectError) throw err;
    const message = err instanceof Error ? err.message : 'The destination could not add the project';
    throw new MoveProjectError('add_failed', message);
  }
  try {
    await opts.archiveSource();
  } catch (err) {
    if (err instanceof MoveProjectError) throw err;
    const message = err instanceof Error ? err.message : 'Archiving the source failed';
    throw new MoveProjectError('archive_failed', message);
  }
}
