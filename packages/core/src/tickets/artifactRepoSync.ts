/**
 * VS-360: reconciles a stored ticket artifact against what an opted-in project's landing actually
 * changed under `.weave/artifacts/**`, immediately after that ticket lands. Scoped to the landing's
 * own diff (`changedArtifactPaths`) so an unrelated landing never touches a different ticket's
 * artifact, and compared against every already-stored revision of the document — not only the
 * current one — so a worker's own publish (whose committed mirror file lags a later DB write) is
 * recognized as a stale landing and skipped rather than silently reverting the stored artifact
 * (plan review, 2026-09-14).
 */
import type { Actor, CoreServices } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { git } from '../util/git.js';
import type { Project, Ticket } from '@weave-ai/shared';

const SYSTEM: Actor = { kind: 'system', id: null };

/** Ticket documents are otherwise unbounded; an artifact's body is capped well above any realistic
 * hand-authored document — the same cap `weave_ticket_artifact_put` already enforces. */
const ARTIFACT_MAX_CHARS = 2_000_000;

export interface ChangedArtifactPath { ticketIdentifier: string; key: string; status: 'added' | 'modified' | 'deleted' }

/** A trailing-newline-insensitive comparison: `git show`'s stdout has at most one trailing newline
 * trimmed by the exec layer, and an artifact's HTML has no such fixed convention (unlike a knowledge
 * markdown file, which always ends in exactly one) to safely re-add it — so a content comparison that
 * only differs by trailing newlines is treated as identical, both here and when deciding "stale". */
function normalize(s: string): string {
  return s.replace(/\n+$/, '');
}

/** The `.weave/artifacts/`-relative `<ticketIdentifier>/<key>` pairs (added/modified/deleted) a
 * landing's own commits changed. A change to only the `.meta.json` sibling is folded into the same
 * entry as a `modified` status; the `.html` file's own status always wins when both changed. */
export async function changedArtifactPaths(clonePath: string, beforeSha: string, afterSha: string): Promise<ChangedArtifactPath[]> {
  const diff = await git(['diff', '--name-status', `${beforeSha}..${afterSha}`, '--', '.weave/artifacts/'], clonePath, 60_000);
  if (!diff.ok || !diff.stdout.trim()) return [];
  const byKey = new Map<string, ChangedArtifactPath['status']>();
  for (const line of diff.stdout.split('\n').filter(Boolean)) {
    const [code, ...rest] = line.split('\t');
    const path = rest.at(-1); // a rename is treated by its new path, as a modification
    if (!path) continue;
    const rel = path.replace(/^\.weave\/artifacts\//, '');
    const segs = rel.split('/');
    if (segs.length !== 2) continue; // not the `<identifier>/<file>` shape this scheme recognizes
    const [ticketIdentifier, filename] = segs;
    if (!ticketIdentifier || !filename) continue;
    let key: string | null = null;
    let isHtml = false;
    if (filename.endsWith('.html')) { key = filename.slice(0, -'.html'.length); isHtml = true; }
    else if (filename.endsWith('.meta.json')) { key = filename.slice(0, -'.meta.json'.length); }
    if (!key) continue;
    const status: ChangedArtifactPath['status'] = code?.startsWith('A') ? 'added' : code?.startsWith('D') ? 'deleted' : 'modified';
    const mapKey = `${ticketIdentifier}/${key}`;
    if (isHtml || !byKey.has(mapKey)) byKey.set(mapKey, isHtml ? status : 'modified');
  }
  return [...byKey.entries()].map(([mapKey, status]) => {
    const idx = mapKey.indexOf('/');
    return { ticketIdentifier: mapKey.slice(0, idx), key: mapKey.slice(idx + 1), status };
  });
}

async function showArtifactFile(clonePath: string, sha: string, ticketIdentifier: string, filename: string): Promise<string | null> {
  const r = await git(['show', `${sha}:.weave/artifacts/${ticketIdentifier}/${filename}`], clonePath, 30_000);
  return r.ok ? r.stdout : null;
}

function validateLandedHtml(html: string): string | null {
  if (html.trim().length === 0) return 'empty';
  if (html.length > ARTIFACT_MAX_CHARS) return `over the ${ARTIFACT_MAX_CHARS}-character cap`;
  if (!/<html[\s>]/i.test(html)) return 'does not look like an HTML document (no `<html>` tag found)';
  return null;
}

export async function reconcileProjectArtifactsFromRepo(
  ctx: WorkspaceContext,
  deps: () => CoreServices,
  project: Project,
  beforeSha: string,
  afterSha: string,
): Promise<void> {
  const changed = await changedArtifactPaths(project.clonePath, beforeSha, afterSha);
  if (!changed.length) return;
  const tickets = deps().tickets;
  const log = ctx.log('ticket');

  for (const { ticketIdentifier, key, status } of changed) {
    let ticket: Ticket | null;
    try { ticket = tickets.get(ticketIdentifier); } catch { ticket = null; }
    if (!ticket || ticket.projectId !== project.id) {
      log.info({ ticketIdentifier, key, projectId: project.id }, 'artifact repo sync: no matching ticket in this project; skipping');
      continue;
    }
    if (status === 'deleted') {
      log.info({ ticketId: ticket.id, key }, 'artifact repo sync: file deleted in repo; leaving the stored artifact as is (no delete capability)');
      continue;
    }

    const landed = await showArtifactFile(project.clonePath, afterSha, ticketIdentifier, `${key}.html`);
    if (landed === null) continue; // the diff said it changed, but it's gone at afterSha (e.g. a later commit in the same landing removed it) — treated like a deletion
    const invalid = validateLandedHtml(landed);
    if (invalid) {
      log.warn({ ticketId: ticket.id, key, reason: invalid }, 'artifact repo sync: landed body failed validation; skipping');
      continue;
    }

    const docKey = `artifact:${key}`;
    const doc = ctx.db.get<{ id: string; currentRevision: number }>(
      'SELECT id, current_revision AS currentRevision FROM ticket_documents WHERE ticket_id = ? AND key = ?',
      [ticket.id, docKey],
    );
    const revisions = doc
      ? ctx.db.all<{ revision: number; body: string }>('SELECT revision, body FROM ticket_document_revisions WHERE document_id = ?', [doc.id])
      : [];
    const landedNorm = normalize(landed);
    const current = revisions.find((r) => r.revision === doc?.currentRevision);
    if (current && normalize(current.body) === landedNorm) continue; // the ordinary case: the worker's own publish is already exactly this
    const matchesOlder = revisions.some((r) => r.revision !== doc?.currentRevision && normalize(r.body) === landedNorm);
    if (matchesOlder) {
      log.info({ ticketId: ticket.id, key }, 'artifact repo sync: landed body matches an older, non-current revision; stale landing, skipping');
      continue;
    }

    const metaRaw = await showArtifactFile(project.clonePath, afterSha, ticketIdentifier, `${key}.meta.json`);
    let title: string | undefined;
    let kind: string | undefined;
    if (metaRaw !== null) {
      try {
        const meta = JSON.parse(metaRaw) as { title?: string | null; kind?: string | null };
        title = meta.title ?? undefined;
        kind = meta.kind ?? undefined;
      } catch (e) {
        log.warn({ ticketId: ticket.id, key, err: String(e) }, 'artifact repo sync: malformed metadata file; publishing body without title/kind update');
      }
    }

    const { revision } = tickets.putDocument(SYSTEM, ticket.id, docKey, landed, { system: true });
    const existingUrl = `/api/w/${ctx.workspaceId}/tickets/${ticket.id}/artifacts/${key}/raw`;
    tickets.putArtifactWorkProduct(SYSTEM, ticket.id, key, { url: existingUrl, title, kind });
    log.info({ ticketId: ticket.id, key, revision }, 'artifact repo sync: recorded a new revision from the landed repo state');
  }
}
