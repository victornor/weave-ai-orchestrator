/**
 * The clone-diff fallback (VS-107): a pull request's diff computed in the daemon's own clone rather
 * than read from a forge, and the base-revision read behind the "expand a collapsed region" control.
 * Both run one of a fixed, named allowlist of read-only `git` subcommands through the existing
 * `git()` helper (`execFile`, no shell, `GIT_TERMINAL_PROMPT=0`, a timeout) — `diff.test.ts`
 * enumerates every argv this module can build and refuses anything that is not one of these two.
 */
import { OcError } from '@weave-ai/shared';
import { git } from '../util/git.js';

/** The only git subcommands this module ever runs. Named so the allowlist test can assert against it directly. */
export const DIFF_GIT_SUBCOMMANDS = ['diff', 'show'] as const;

/**
 * `base` and `head` are already-resolved refs (`origin/main`, a local branch name, a sha) — resolving
 * which ref to use, and whether `head` exists in this clone at all, is the caller's job
 * (`PullRequestsService`), because that decision also decides whether to try the forge instead.
 */
export async function computeCloneDiff(clonePath: string, base: string, head: string): Promise<string> {
  const r = await git(['diff', '--no-color', `${base}...${head}`, '--'], clonePath, 60_000);
  if (!r.ok) throw new OcError('internal', `git diff failed: ${r.stderr.trim().slice(0, 300)}`, { clonePath, base, head });
  return r.stdout;
}

/**
 * A file's content at a revision, one line per array entry, or `null` when that file does not exist
 * there — an added file has nothing on the base side, and that is not an error.
 */
export async function readFileAtRef(clonePath: string, ref: string, path: string): Promise<string[] | null> {
  const r = await git(['show', `${ref}:${path}`], clonePath, 20_000);
  if (!r.ok) return null;
  return r.stdout.replace(/\r\n/g, '\n').split('\n');
}
