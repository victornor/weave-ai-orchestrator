import { newId, nowIso, ticketRow, type Db } from '@weave-ai/db';
import {
  OcError, LIVENESS_STATUSES, TERMINAL_TICKET_STATUSES, NAMED_CARD_OPTION_KEYS, estimateTokens, landingBranchOf, yoloEnabled, isWorkerOptionConfigured,
  type CommentKind, type Decision, type SourceTrust, type Ticket, type TicketComment, type TicketStatus, type WorkProductType,
} from '@weave-ai/shared';
import type { Actor, CoreServices, Page, TicketCreateInput, TicketFilter, TicketsService, TransitionInput } from '../api.js';
import type { Agent, Project } from '@weave-ai/shared';
import type { WorkspaceContext } from '../context.js';
import { recordActivity } from '../events.js';
import { checkTransition, openspecChangeName, type GuardFacts } from './guards.js';
import { unlandedCommitCount } from '../worktrees/landed.js';
import { tx } from './tx.js';
import { landDelivery, type LandResult } from './land.js';
import { attemptArchiveThenMerge } from './archive-before-merge.js';
import { createMergeQueue } from './merge-queue.js';
import { landLock } from '../util/land-lock.js';
import { git } from '../util/git.js';
import { reconcileProjectKnowledgeFromRepo } from '../knowledge/repoSync.js';
import { reconcileProjectArtifactsFromRepo } from './artifactRepoSync.js';
import { SECRET_SHAPED_RE } from '../knowledge/files.js';
import { effectiveModels } from '../models/resolve.js';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { flattenWakes } from '../prompts/index.js';
import type { Wakeup } from '@weave-ai/shared';

function ticketBranchFor(t: { identifier: string; title: string }): string {
  const slug = t.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return `ac/${t.identifier.toLowerCase()}-${slug}`;
}

/**
 * VS-360: the single enforcement point for the artifact repo-write boundary. Maps a ticket's own
 * identifier and an artifact key to its path under `.weave/artifacts/` in that ticket's worktree —
 * both values are already known to `putDocument` from the ticket and key it is writing, never
 * supplied by a caller as a path, so there is no way to reach this with a different ticket's
 * identifier. `key`'s shape is already enforced by `weave_ticket_artifact_put`'s Zod schema; the
 * re-check here is defense in depth against internal misuse, not a real caller today.
 */
function repoArtifactPath(identifier: string, key: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(key)) {
    throw new OcError('internal', `artifact key ${key} is not the shape weave_ticket_artifact_put already validated; refusing to write it into a repo`, { key });
  }
  return `${identifier}/${key}`;
}

/** Two SHAs name the same object when one is a prefix of the other (workers often pass 7–12 chars). */
function sameGitSha(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (x.length < 7 || y.length < 7) return x === y;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

interface ProjectRow { id: string; slug: string; clonePath: string; openspecEnabled: number; policies: Record<string, unknown> | null }

const TERMINAL = new Set<TicketStatus>(TERMINAL_TICKET_STATUSES);

/**
 * How much of a human comment's body travels in a `ticket_comment` wake payload. Deliberately the
 * same value as threads' `HUMAN_MESSAGE_WAKE_BODY_CHARS` (VS-242): a human reply on a ticket-bound
 * thread is the same prose as one on a free thread, so the two paths should cut at the same place.
 * A comment over this bound is marked `truncated: true` with `bodyLength` set to its real length,
 * and the full comment stays reachable via `weave_ticket_comments` (VS-246).
 */
export const TICKET_COMMENT_WAKE_BODY_CHARS = 8000;

/** Named in a wake reason when its payload was cut, so a worker reading a fragment knows what to call. */
const FULL_COMMENT_HINT = 'full comment via weave_ticket_comments';

/**
 * The `body`, `truncated` and `bodyLength` fields for a `ticket_comment` wake payload, mirroring
 * threads' `wakeBody()` (VS-242): within the bound the body passes through with no new fields, so it
 * reads exactly as it did before this bound existed; over it the slice is marked with the real length.
 */
function commentWakeBody(body: string): { body: string; truncated?: true; bodyLength?: number } {
  if (body.length <= TICKET_COMMENT_WAKE_BODY_CHARS) return { body };
  return { body: body.slice(0, TICKET_COMMENT_WAKE_BODY_CHARS), truncated: true, bodyLength: body.length };
}

/** A wake reason that names the read path when its payload carries only a fragment of the comment. */
function commentWakeReason(prefix: string, truncated: boolean): string {
  return truncated ? `${prefix} (truncated; ${FULL_COMMENT_HINT})` : prefix;
}

/**
 * A one-line excerpt of a comment body for a prose context (the relaunch note, the no-role wake
 * reason). Marks the cut explicitly rather than ending silently — `payload.body` is already bounded,
 * so a second slice here would otherwise be invisible — and names the tool that returns the rest.
 */
function commentExcerpt(body: string, max: number): string {
  if (body.length <= max) return body;
  return `${body.slice(0, max)}… (truncated; ${FULL_COMMENT_HINT})`;
}

export function createTicketsService(ctx: WorkspaceContext, deps: () => CoreServices): TicketsService {
  const db: Db = ctx.db;
  const log = ctx.log('ticket');
  const ws = ctx.workspaceId;
  const mergeQueue = createMergeQueue(ctx, deps);
  /** One delivery landing at a time per project: it mutates the clone every ticket shares (§11.4). */
  const serialize = landLock;

  function resolveWorkerModelId(id: string | null | undefined): string | null {
    if (id == null || id === '') return null;
    const opts = effectiveModels(ctx.daemon, ctx.config).workerOptions ?? [];
    const opt = opts.find((o) => o.id === id);
    if (!opt) throw new OcError('validation', `unknown worker model option '${id}'`);
    if (!isWorkerOptionConfigured(opt)) {
      throw new OcError('model_unconfigured', `worker option '${id}' has no runtime chosen`, { optionId: id });
    }
    return id;
  }

  function claimedWakesForRun(runId: string): Wakeup[] {
    const run = db.get<{ wakeupIds: string[] }>('SELECT wakeup_ids_json FROM runs WHERE id = ?', [runId]);
    const ids = run?.wakeupIds ?? [];
    if (!ids.length) return [];
    return db.all<Wakeup>(`SELECT * FROM wakeups WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  }

  function applyRoutineFilingPolicy(actor: Actor, input: TicketCreateInput): TicketCreateInput {
    if (actor.kind !== 'agent' || !actor.runId) return input;
    const flat = flattenWakes(claimedWakesForRun(actor.runId));
    if (!flat.length) return input;
    const actionOf = (payload: Record<string, unknown>) => (payload['action'] === 'file_work' ? 'file_work' : 'report');
    if (flat.every((w) => w.source === 'routine' && actionOf(w.payload) === 'report')) {
      throw new OcError('forbidden', 'a report scheduled task cannot file tickets; reply to captain with the finding');
    }
    const fileWork = flat.filter((w) => w.source === 'routine' && actionOf(w.payload) === 'file_work');
    if (!fileWork.length) return input;
    const rid = String(fileWork[0]!.payload['routineId'] ?? '');
    const cap = Number(fileWork[0]!.payload['maxTicketsPerFire'] ?? 3);
    const prefix = `routine:${rid}:`;
    let next = input;
    if (!next.originKind) {
      next = { ...next, originKind: 'routine', originFingerprint: next.originFingerprint ?? `${prefix}${newId()}` };
    }
    const n = db.get<{ n: number }>(
      `SELECT COUNT(*) n FROM tickets WHERE workspace_id = ? AND origin_kind = 'routine' AND origin_fingerprint LIKE ? AND (created_run_id = ? OR status NOT IN ('done','cancelled'))`,
      [ws, `${prefix}%`, actor.runId],
    )?.n ?? 0;
    if (n >= cap) throw new OcError('validation', `this scheduled task may file at most ${cap} ticket(s) per fire`);
    return next;
  }

  // Follow-up work a transition schedules but does not wait for. Every timer is tracked so `stop()`
  // can cancel what has not fired and await what has, and the callback runs inside a try/catch: a
  // synchronous throw (an unavailable service, say) would otherwise escape the timer as an uncaught
  // exception and take the process — or a test run — down with it.
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  const inFlight = new Set<Promise<unknown>>();

  function schedule(delayMs: number, label: string, fn: () => Promise<unknown> | void): void {
    const timer = setTimeout(() => {
      pendingTimers.delete(timer);
      let p: Promise<unknown>;
      try {
        p = Promise.resolve(fn());
      } catch (e) {
        log.debug({ err: String(e) }, `${label} failed`);
        return;
      }
      const tracked = p.catch((e: unknown) => log.debug({ err: String(e) }, `${label} failed`)).finally(() => { inFlight.delete(tracked); });
      inFlight.add(tracked);
    }, delayMs);
    timer.unref();
    pendingTimers.add(timer);
  }

  // ---------- reads ----------

  const row = (t: Record<string, unknown>): Ticket => ticketRow(t) as unknown as Ticket;

  function find(idOrIdentifier: string): Ticket | null {
    const r = db.get<Record<string, unknown>>(
      'SELECT * FROM tickets WHERE workspace_id = ? AND (id = ? OR identifier = ?)',
      [ws, idOrIdentifier, idOrIdentifier.toUpperCase()],
    );
    return r ? row(r) : null;
  }
  function get(idOrIdentifier: string): Ticket {
    const t = find(idOrIdentifier);
    if (!t) throw new OcError('not_found', `ticket ${idOrIdentifier} not found`);
    return t;
  }
  function project(id: string | null): ProjectRow | null {
    if (!id) return null;
    return db.get<ProjectRow>('SELECT id, slug, clone_path, openspec_enabled, policies_json FROM projects WHERE id = ?', [id]) ?? null;
  }
  function blockersOf(id: string): Ticket[] {
    return db
      .all<Record<string, unknown>>(
        'SELECT t.* FROM ticket_relations r JOIN tickets t ON t.id = r.related_ticket_id WHERE r.ticket_id = ? AND r.kind = ? ORDER BY t.number',
        [id, 'blocks'],
      )
      .map(row);
  }
  function dependentsOf(id: string): Ticket[] {
    return db
      .all<Record<string, unknown>>(
        'SELECT t.* FROM ticket_relations r JOIN tickets t ON t.id = r.ticket_id WHERE r.related_ticket_id = ? AND r.kind = ? ORDER BY t.number',
        [id, 'blocks'],
      )
      .map(row);
  }
  function childrenOf(id: string): Ticket[] {
    return db.all<Record<string, unknown>>('SELECT * FROM tickets WHERE parent_id = ? ORDER BY number', [id]).map(row);
  }
  function hasOpenDecision(ticketId: string): boolean {
    return !!db.get<{ n: number }>('SELECT COUNT(*) n FROM decisions WHERE ticket_id = ? AND status = ?', [ticketId, 'open'])?.n;
  }
  function hasWorkProduct(ticketId: string): boolean {
    return !!db.get<{ n: number }>('SELECT COUNT(*) n FROM ticket_work_products WHERE ticket_id = ?', [ticketId])?.n;
  }
  function mergeApproved(t: Ticket): boolean {
    if (t.autoMerge) return true;
    const d = db.get<{ n: number }>(
      "SELECT COUNT(*) n FROM decisions WHERE ticket_id = ? AND kind = 'merge_approval' AND status = 'answered' AND answer_key = 'approve'",
      [t.id],
    );
    return !!d?.n;
  }

  // ---------- helpers ----------

  function touch(id: string, patch: Record<string, unknown>): Ticket {
    db.update('tickets', id, { ...patch, updatedAt: nowIso() });
    return get(id);
  }

  /**
   * `requestedBy` matters to the blocked-ticket restore (VS-338): the engine reopens a `blocked`
   * ticket only for a wake a resolving source requested, so a human `ticket_comment` must carry its
   * requester rather than defaulting to `system`.
   */
  function wake(agentId: string | null | undefined, source: Parameters<CoreServices['wake']['enqueue']>[1]['source'], reason: string, payload: Record<string, unknown> = {}, requestedBy?: Actor, idempotencyKey?: string): void {
    if (!agentId) return;
    try {
      deps().wake.enqueue(agentId, { source, reason, payload, ...(requestedBy ? { requestedBy } : {}), ...(idempotencyKey ? { idempotencyKey } : {}) });
    } catch (e) {
      log.warn({ err: e, agentId, source }, 'wake enqueue failed');
    }
  }

  function conductorId(): string | null {
    return db.get<{ id: string }>("SELECT id FROM agents WHERE workspace_id = ? AND kind = 'weaver'", [ws])?.id ?? null;
  }

  /** Reject a blocker graph cycle: `id` must not be reachable from any of `blockedBy`. */
  function assertNoCycle(id: string, blockedBy: string[]): void {
    const seen = new Set<string>();
    const stack = [...blockedBy];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === id) throw new OcError('validation', 'blocker cycle: a ticket cannot block itself, directly or transitively', { ticketId: id });
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const b of db.all<{ relatedTicketId: string }>('SELECT related_ticket_id FROM ticket_relations WHERE ticket_id = ?', [cur])) stack.push(b.relatedTicketId);
    }
  }

  function allocateNumber(): number {
    db.run('UPDATE workspaces SET ticket_counter = ticket_counter + 1, updated_at = ? WHERE id = ?', [nowIso(), ws]);
    const r = db.get<{ ticketCounter: number; ticketPrefix: string }>('SELECT ticket_counter, ticket_prefix FROM workspaces WHERE id = ?', [ws]);
    if (!r) throw new OcError('not_found', 'workspace row missing');
    return r.ticketCounter;
  }
  function prefix(): string {
    return db.get<{ ticketPrefix: string }>('SELECT ticket_prefix FROM workspaces WHERE id = ?', [ws])?.ticketPrefix ?? 'OC';
  }

  function bindOpenspec(t: Ticket): string | null {
    if (t.openspecChangeName) return t.openspecChangeName;
    const p = project(t.projectId);
    if (!p || !p.openspecEnabled) return null;
    if (t.kind === 'scout' || t.kind === 'question' || t.kind === 'operational') return null;
    if (t.kind === 'task' && (p.policies as { taskTicketsUseOpenspec?: boolean } | null)?.taskTicketsUseOpenspec === false) return null;
    const name = openspecChangeName(t.identifier, t.title);
    db.update('tickets', t.id, { openspecChangeName: name, updatedAt: nowIso() });
    return name;
  }

  // `proposalApproval` is `APPROVAL_OWNERS`, not `DECISION_OWNERS` ('human'|'weaver'), so this
  // function's callers hand its result straight to `decisions.create({ owner, ... })` only after this
  // translation. `fromProject` (a project's `policies_json`) can still be the legacy `'conductor'`
  // spelling — VS-263 deliberately keeps writing it under that spelling for rollback safety (Decision
  // 6) — while `ctx.config.defaults.proposalApproval` is always schema-normalized to `'weaver'`
  // already. This one line handles both: unchanged since before VS-263, because it was already
  // correct for both sources.
  function approvalOwner(t: Ticket): 'human' | 'weaver' | 'none' {
    const p = project(t.projectId);
    const fromProject = (p?.policies as { proposalApproval?: 'human' | 'conductor' | 'weaver' | 'none' } | null)?.proposalApproval;
    const raw = fromProject ?? ctx.config.defaults.proposalApproval;
    return raw === 'conductor' ? 'weaver' : raw;
  }

  /**
   * YOLO mode for this ticket (PLAN §15): the daemon grants its plan and merge approvals itself.
   * Read at the moment the approval would be granted, never stamped on the decision, so turning the
   * mode off stops every auto-approval that has not happened yet.
   */
  function yolo(t: Ticket): boolean {
    return yoloEnabled(project(t.projectId)?.policies ?? null);
  }

  /** Answer an approval this ticket is waiting on as the daemon, naming the mode that granted it. */
  async function autoApprove(t: Ticket, decisionId: string): Promise<void> {
    await deps().decisions.answer({ kind: 'system', id: null }, decisionId, {
      key: 'approve',
      text: 'Auto-approved by YOLO mode: this project grants plan and merge approvals without the human.',
    });
  }

  /** The open approval of `kind` on a ticket, if the human has not answered it first. */
  function openApproval(ticketId: string, kind: 'plan_approval' | 'merge_approval' | 'action_approval'): string | null {
    return db.get<{ id: string }>(
      'SELECT id FROM decisions WHERE ticket_id = ? AND kind = ? AND status = ? ORDER BY created_at DESC LIMIT 1',
      [ticketId, kind, 'open'],
    )?.id ?? null;
  }

  /**
   * VS-389: record a failed archive-backfill landing, at most once per (reason, pull request). A
   * repeat is a debug log only, so a standing failure — pending checks, a conflict, an unreachable
   * forge — cannot add a comment to the finished ticket on every reconciliation pass; the once-only
   * wake and comment happen when the failure first appears or changes. `quiet` (pending checks)
   * records the state without commenting or waking at all.
   */
  function recordArchiveLandingFailure(t: Ticket, changeName: string, prUrl: string, reason: string, actor: Actor, quiet = false): void {
    const delivery = (t.delivery ?? {}) as Record<string, unknown>;
    const existing = (delivery['openspecArchive'] ?? {}) as Record<string, unknown>;
    const last = existing['lastFailure'] as { reason?: string; prUrl?: string } | undefined;
    if (last?.reason === reason && last?.prUrl === prUrl) {
      log.debug({ ticketId: t.id, changeName, reason }, 'archive landing still failing');
      return;
    }
    const withFailure = { ...delivery, openspecArchive: { ...existing, lastFailure: { reason, prUrl, at: nowIso() } } };
    if (quiet) { touch(t.id, { deliveryJson: withFailure }); return; }
    tx(db, () => {
      touch(t.id, { deliveryJson: withFailure });
      systemComment(t.id, `spec archive for ${changeName} not landed yet (${reason}); it will be retried.`, actor);
      recordActivity(db, ws, actor, 'ticket.merge_archive_failed', 'ticket', t.id, { error: reason, changeName, prUrl }, t.id);
      const cid = conductorId();
      if (cid) wake(cid, 'system', `openspec archive landing failed for ${t.identifier}: ${reason}`, { ticketId: t.id, changeName, prUrl, error: reason }, actor, `reconcile-archive-failed:${t.id}:${prUrl}`);
    });
  }

  /**
   * VS-472: post an auto-merge waiting comment only when the reason, or the pull request head it is
   * waiting on, is new for this ticket. The sweep runs on every supervisor tick (~15 s), so an
   * unchanged hold would otherwise add an identical comment on every pass — measured at 18 comments
   * in 4 minutes on a single held ticket — burying the worker's own comments. The last hold lives in
   * the ticket's `delivery` JSON (surfaced by `clearAutoMergeHold`) so a daemon restart does not
   * re-post it.
   */
  function recordAutoMergeHold(t: Ticket, reason: string, head: string | null): void {
    const delivery = (t.delivery ?? {}) as Record<string, unknown>;
    const last = delivery['autoMergeHold'] as { reason?: string; head?: string | null } | undefined;
    if (last?.reason === reason && (last['head'] ?? null) === head) {
      log.debug({ ticketId: t.id, reason }, 'auto-merge hold unchanged; not commenting again');
      return;
    }
    tx(db, () => {
      touch(t.id, { deliveryJson: { ...delivery, autoMergeHold: { reason, head, at: nowIso() } } });
      systemComment(t.id, reason, { kind: 'system', id: null });
      ctx.events.emit('ticket.updated', 'ticket', t.id, get(t.id));
    });
  }

  /**
   * Drop the recorded auto-merge hold once the ticket advances, so a ticket that returns to
   * `in_review` and is held again for the same reason comments afresh (VS-472).
   */
  function clearAutoMergeHold(t: Ticket): void {
    const delivery = (t.delivery ?? {}) as Record<string, unknown>;
    if (!delivery['autoMergeHold']) return;
    const rest = { ...delivery };
    delete rest['autoMergeHold'];
    touch(t.id, { deliveryJson: rest });
    ctx.events.emit('ticket.updated', 'ticket', t.id, get(t.id));
  }

  /**
   * Whether this `action` revision already has an `open` or `answered` `action_approval`. A
   * missing `target` still counts as covering so a legacy/test row cannot re-enter the repair loop
   * (VS-225). Plan and merge repairs do not use this: they terminate because answering changes the
   * ticket's status (`proposed` → `approved`, `in_review` → `merging`). Operational approve/revise
   * leave `in_progress` on purpose (VS-216), so status cannot be the filter here.
   */
  function actionApprovalCoversRevision(ticketId: string, documentId: string, revision: number): boolean {
    const rows = db.all<{ status: string; target: { documentId?: string; revision?: number } | null }>(
      "SELECT status, target_json FROM decisions WHERE ticket_id = ? AND kind = 'action_approval' AND status IN ('open', 'answered')",
      [ticketId],
    );
    return rows.some((r) => {
      const target = r.target;
      if (!target || target.revision == null) return true;
      return target.documentId === documentId && target.revision === revision;
    });
  }

  const actionApprovalOptions = [
    { key: NAMED_CARD_OPTION_KEYS.action_approval.approve, label: 'Approve', description: 'The worker runs the stated action.', recommended: true },
    { key: NAMED_CARD_OPTION_KEYS.action_approval.revise, label: 'Revise', description: 'Send it back with feedback.' },
    { key: NAMED_CARD_OPTION_KEYS.action_approval.reject, label: 'Reject', description: 'Cancel the ticket.' },
  ];

  const planApprovalOptions = [
    { key: NAMED_CARD_OPTION_KEYS.plan_approval.approve, label: 'Approve', description: 'The worker implements the plan.', recommended: true },
    { key: NAMED_CARD_OPTION_KEYS.plan_approval.revise, label: 'Revise', description: 'Send it back with feedback.' },
    { key: NAMED_CARD_OPTION_KEYS.plan_approval.reject, label: 'Reject', description: 'Cancel the ticket.' },
  ];

  /** The context line every plan-approval card carries; a caller may append its own suffix. */
  function planApprovalContext(t: Ticket): string {
    return `OpenSpec change \`${t.openspecChangeName ?? ''}\` is planning-complete and validates. Review the plan document.`;
  }

  /**
   * Raise the plan approval for a planning-complete change ticket. Shared by the `proposing →
   * proposed` transition, the stranded-approval repair and the turn-end republish, so all three
   * publish a card with the same owner, options, correlation key, document target and asking agent.
   * YOLO is not applied here: each caller decides whether to auto-answer, because its ticket and
   * actor differ.
   */
  function raisePlanApproval(actor: Actor, t: Ticket, opts: { context?: string } = {}) {
    const owner = approvalOwner(t);
    if (owner === 'none') throw new OcError('validation', `plan approval for ${t.identifier} has no owner`);
    const doc = db.get<{ id: string; currentRevision: number }>('SELECT id, current_revision FROM ticket_documents WHERE ticket_id = ? AND key = ?', [t.id, 'plan']);
    return deps().decisions.create(actor, {
      ticketId: t.id, kind: 'plan_approval', owner,
      title: `Approve the plan for ${t.identifier}: ${t.title}`,
      context: opts.context ?? planApprovalContext(t),
      options: planApprovalOptions,
      allowFreeText: true,
      correlationKey: `plan_approval:${t.id}`,
      target: doc ? { documentId: doc.id, revision: doc.currentRevision } : undefined,
      askedByAgentId: t.workerId,
      askedInRunId: actor.runId ?? null,
    });
  }

  /** Human-owned, never YOLO, never `proposalApproval: none`. */
  function raiseActionApproval(
    actor: Actor,
    t: Ticket,
    doc: { id: string; currentRevision: number } | undefined,
    repaired: boolean,
  ): { id: string } {
    return deps().decisions.create(actor, {
      ticketId: t.id, kind: 'action_approval', owner: 'human',
      title: `Approve the action for ${t.identifier}: ${t.title}`,
      context: repaired
        ? `Review the action document below — approve to run it; revise to send feedback; reject to cancel. (Re-raised: the previous approval was lost — this card is the one to answer.)`
        : `Review the action document below — approve to run it; revise to send feedback; reject to cancel.`,
      options: actionApprovalOptions,
      allowFreeText: true,
      correlationKey: `action_approval:${t.id}`,
      target: doc ? { documentId: doc.id, revision: doc.currentRevision } : undefined,
      askedByAgentId: t.workerId,
      askedInRunId: actor.runId ?? null,
    });
  }

  function systemComment(ticketId: string, body: string, actor: Actor, kind: CommentKind = 'status'): void {
    const id = newId();
    db.insert('ticket_comments', {
      id, ticketId, authorKind: actor.kind === 'human' ? 'human' : 'system', authorId: actor.id, runId: actor.runId ?? null,
      body, kind, sourceTrust: actor.kind === 'human' ? 'trusted' : 'trusted', createdAt: nowIso(),
    });
    ctx.events.emit('ticket.comment', 'ticket', ticketId, { id, ticketId, body, kind });
  }

  /** After a ticket becomes terminal: wake dependents and the parent (PLAN §7.1). */
  function propagateTerminal(t: Ticket, actor: Actor): void {
    for (const dep of dependentsOf(t.id)) {
      if (TERMINAL.has(dep.status)) continue;
      const open = blockersOf(dep.id).filter((b) => b.status !== 'done');
      if (open.length) continue;
      if (dep.status === 'blocked') {
        const back: TicketStatus = dep.blockedFromStatus ?? (dep.assigneeRoleId || dep.workerId ? 'todo' : 'backlog');
        db.update('tickets', dep.id, { status: back, unblockJson: null, blockedTransitionAt: null, blockedFromStatus: null, updatedAt: nowIso() });
        recordActivity(db, ws, actor, 'ticket.unblocked', 'ticket', dep.id, { from: 'blocked', to: back }, dep.id);
        ctx.events.emit('ticket.status', 'ticket', dep.id, get(dep.id));
      }
      wake(dep.workerId, 'blockers_resolved', `blockers resolved for ${dep.identifier}`, { ticketId: dep.id, resolvedBy: t.identifier });
    }
    if (t.parentId) {
      const kids = childrenOf(t.parentId);
      if (kids.length && kids.every((k) => TERMINAL.has(k.status))) {
        const parent = find(t.parentId);
        if (parent && !TERMINAL.has(parent.status)) {
          wake(parent.workerId, 'children_completed', `all children of ${parent.identifier} are complete`, { ticketId: parent.id });
        }
      }
    }
    // A decision still open on a ticket that just finished has nothing left to decide (VS-142) —
    // closing it here covers every path that reaches a terminal status (transition, cancel, mergeDone).
    try {
      deps().decisions.withdrawForTicket(actor, t.id, `${t.identifier} reached ${t.status}`);
    } catch (e) {
      log.warn({ err: e, ticketId: t.id }, 'closing open decisions for a terminal ticket failed');
    }
    // VS-172: leave the live set in this same transition so Live cannot keep a leftover cell.
    try { releaseWorkersForTerminal(t, actor); }
    catch (e) { log.warn({ err: e, ticketId: t.id }, 'releasing workers for a terminal ticket failed'); }
  }

  function releaseWorkersForTerminal(t: Ticket, actor: Actor): void {
    const workers = db.all<Agent>(
      "SELECT * FROM agents WHERE ticket_id = ? AND kind = 'worker' AND status NOT IN ('retired','done')",
      [t.id],
    );
    const reason = `${t.identifier} reached ${t.status}`;
    for (const w of workers) {
      try { deps().wake.cancelForAgent(w.id, reason); }
      catch (e) { log.warn({ err: e, workerId: w.id }, 'cancelling wakes for a terminal ticket worker failed'); }
      db.update('agents', w.id, { status: 'done', updatedAt: nowIso() });
      db.run("UPDATE worktrees SET status = 'dirty' WHERE agent_id = ? AND status = 'active'", [w.id]);
      ctx.events.emit('worker.status', 'agent', w.id, { status: 'done', reason });
      const running = db.get<{ id: string }>("SELECT id FROM runs WHERE agent_id = ? AND status = 'running' LIMIT 1", [w.id]);
      if (running) {
        const runId = running.id;
        schedule(0, 'interrupt run for terminal ticket', () => deps().runs.cancel(actor, runId, 'interrupt'));
      }
      const workerId = w.id;
      schedule(50, 'retire worker for terminal ticket', () => deps().workers.retireIfLanded(actor, workerId));
    }
  }

  function facts(t: Ticket, input: TransitionInput): GuardFacts {
    const declared = input.blockedBy ?? [];
    const existing = blockersOf(t.id);
    const openBlockers = declared.length
      ? declared.filter((id) => find(id)?.status !== 'done').length
      : existing.filter((b) => b.status !== 'done').length;
    return {
      openBlockers,
      hasBlockers: declared.length > 0 || existing.length > 0,
      hasOpenDecision: hasOpenDecision(t.id),
      hasUnblockPath: !!input.unblock,
      hasWorkProduct: hasWorkProduct(t.id),
      mergeApproved: mergeApproved(t),
      hasEndingNote: !!input.note?.trim(),
    };
  }

  /**
   * Commits on the ticket's branch that its landing branch does not contain (VS-215) — 0 when there
   * is no worktree, no project clone, or anything cannot be read: the gate refuses only what it can
   * prove, and the landed-work test plus the discard rules still protect the tree itself.
   */
  async function unlandedCommitsFor(t: Ticket): Promise<number> {
    try {
      const wt = db.get<{ path: string; branch: string }>('SELECT path, branch FROM worktrees WHERE ticket_id = ? AND status != ? ORDER BY created_at DESC LIMIT 1', [t.id, 'removed']);
      if (!wt) return 0;
      let project: Project | null = null;
      try { project = t.projectId ? deps().projects.get(t.projectId) : null; } catch { project = null; }
      if (!project) return 0;
      return await unlandedCommitCount({ repoPath: project.clonePath, worktreePath: wt.path, branch: wt.branch, landingBranch: landingBranchOf(project, t) }, log);
    } catch (e) {
      log.warn({ err: String(e), ticketId: t.id }, 'task-done unlanded-commit check failed; allowing');
      return 0;
    }
  }

  // ---------- documents ----------

  /**
   * `opts.system` is set only by `transition()`'s own write of the generated plan digest — the one
   * legitimate writer of the `plan` key — and by `putArtifactWorkProduct`'s caller,
   * `weave_ticket_artifact_put`, the one legitimate writer of an `artifact:`-prefixed key. Every other
   * external entry point (the agent tool, the HTTP route) rejects both before reaching here, so this
   * is not an authorization check on `actor`; `actorFor()` never produces a `system` actor for a real
   * request in the first place.
   *
   * `opts.mirror` (VS-360) is set only by `weave_ticket_artifact_put`'s handler, and only when the
   * publishing worker has a worktree and the ticket's project has opted in to `knowledgeRepo`. It is
   * used only for the `artifact:`-prefixed path — never for `plan` — and only ever names the path
   * `repoArtifactPath` computes from this ticket's own identifier and the key being written.
   */
  function putDocument(actor: Actor, id: string, key: string, body: string, opts?: { system?: boolean; mirror?: { worktreePath: string; title?: string; kind?: string } }): { documentId: string; revision: number } {
    if (key === 'plan' && !opts?.system) {
      throw new OcError('forbidden', "the `plan` document key is reserved for the daemon-generated plan digest; use `report` (or another key) for your own notes", { key });
    }
    if (key.startsWith('artifact:') && !opts?.system) {
      throw new OcError('forbidden', 'the `artifact:` key prefix is reserved for published artifacts; use `weave_ticket_artifact_put` instead of writing this key directly', { key });
    }
    // VS-360: refuse before anything is recorded — matching `putDoc`'s existing secret refusal —
    // only on the path that would otherwise commit this HTML into a repo. An opted-out project's
    // publish (no `mirror`) is unaffected: an artifact is already sandboxed, reviewed content on
    // every project, opted in or not, unlike a knowledge note.
    if (key.startsWith('artifact:') && opts?.mirror && SECRET_SHAPED_RE.test(body)) {
      throw new OcError('validation', 'artifact body looks like it contains a secret; refusing to publish it', { key });
    }
    const t = get(id);
    // Computed — and, on a boundary violation, thrown — before the transaction opens: a caller
    // reaching this with a key `weave_ticket_artifact_put`'s own Zod schema could never have let
    // through refuses the whole write, the same as the secret check above, rather than being folded
    // into the "log and continue" treatment a genuine filesystem failure gets below.
    const mirrorRel = key.startsWith('artifact:') && opts?.mirror ? repoArtifactPath(t.identifier, key.slice('artifact:'.length)) : null;
    const written = tx(db, () => {
      let doc = db.get<{ id: string; currentRevision: number }>('SELECT id, current_revision FROM ticket_documents WHERE ticket_id = ? AND key = ?', [t.id, key]);
      if (!doc) {
        const docId = newId();
        db.insert('ticket_documents', { id: docId, ticketId: t.id, key, currentRevision: 0 });
        doc = { id: docId, currentRevision: 0 };
      }
      const revision = doc.currentRevision + 1;
      db.insert('ticket_document_revisions', {
        id: newId(), documentId: doc.id, revision, body, authorKind: actor.kind, authorId: actor.id, runId: actor.runId ?? null, createdAt: nowIso(),
      });
      db.run('UPDATE ticket_documents SET current_revision = ? WHERE id = ?', [revision, doc.id]);
      if (mirrorRel !== null && opts?.mirror) {
        const mirror = opts.mirror;
        try {
          const dir = join(mirror.worktreePath, '.weave', 'artifacts', dirname(mirrorRel));
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(mirror.worktreePath, '.weave', 'artifacts', `${mirrorRel}.html`), body, 'utf8');
          writeFileSync(
            join(mirror.worktreePath, '.weave', 'artifacts', `${mirrorRel}.meta.json`),
            `${JSON.stringify({ title: mirror.title ?? null, kind: mirror.kind ?? null }, null, 2)}\n`,
            'utf8',
          );
        } catch (e) {
          // The DB write above already succeeded and is the tool's documented contract; a mirror
          // I/O failure (disk full, permission) is surfaced to the worker as an unexpected `git
          // status` before it delivers, not as a failed publish (VS-358 design.md accepts the same
          // trade-off for knowledge). A boundary violation is not caught here — see `mirrorRel` above.
          log.warn({ err: String(e), ticketId: t.id, key }, 'artifact mirror write failed');
        }
      }
      recordActivity(db, ws, actor, 'ticket.document', 'ticket_document', doc.id, { key, revision, tokens: estimateTokens(body) }, t.id);
      ctx.events.emit('ticket.document', 'ticket', t.id, { ticketId: t.id, documentId: doc.id, key, revision });
      // A newer plan revision supersedes a pending plan approval (PLAN §12.2).
      if (key === 'plan') {
        try {
          deps().decisions.supersedeForTarget(actor, t.id, `plan_approval:${t.id}`);
        } catch (e) {
          log.warn({ err: e, ticketId: t.id }, 'plan approval supersession failed');
        }
      }
      return { documentId: doc.id, revision };
    });
    // An operational ticket's `action` document is the pre-action gate: each write supersedes
    // (via create's correlation key) and raises a human-owned `action_approval`. YOLO and
    // `proposalApproval: none` do not grant it.
    if (key === 'action' && t.kind === 'operational') {
      raiseActionApproval(actor, t, { id: written.documentId, currentRevision: written.revision }, false);
    }
    return written;
  }

  // ---------- transitions ----------

  /**
   * `opts.quiet` is set only by `resumeIfBlocked` (VS-338): the transition is returning a blocked
   * ticket to the status it already held, not entering that status for the first time, so the wakes
   * and decisions that belong to a first entry — the `in_review` merge card, the `approved`
   * hand-off wake — are suppressed. Everything observable (status event, activity, board, weaver)
   * still happens.
   */
  async function transition(actor: Actor, id: string, input: TransitionInput, opts: { quiet?: true } = {}): Promise<Ticket> {
    {
      const cur = get(id);
      if ((cur.status === 'done' || cur.status === 'cancelled') && actor.kind !== 'human') {
        throw new OcError('forbidden', `only a human reopens a ${cur.status} ticket (reply to it, or \`weave ticket reopen\`)`);
      }
    }
    const t = get(id);
    const to = input.to;
    checkTransition(t.kind, t.status, to, facts(t, input));

    // Async gates run before the write transaction opens.
    // VS-215 / VS-216: a task or operational ticket finishes at `done` only when nothing it
    // produced needs landing. That holds for human actors too — it is the same protection the
    // discard rules provide. The task-only note requirement stays in checkTransition.
    if (to === 'done' && (t.kind === 'task' || t.kind === 'operational')) {
      const commits = await unlandedCommitsFor(t);
      if (commits > 0) {
        const hint = t.kind === 'task'
          ? 'deliver through in_review instead'
          : 'an operational ticket must not finish with unlanded commits';
        throw new OcError('worktree_not_landed', `${t.identifier}'s branch carries ${commits} commit(s) not contained in its landing branch; ${hint}`, { commits });
      }
    }
    let planBody: string | null = null;
    if (to === 'proposed' && t.kind === 'change') {
      const res = await deps().openspec.validateForProposed(t.id);
      if (!res.ok) {
        throw new OcError('openspec_validation_failed', 'OpenSpec planning is not complete or validation failed', { issues: res.issues });
      }
      planBody = res.plan;
    }

    const now = nowIso();
    const patch: Record<string, unknown> = { status: to };
    if (input.blockedBy) {
      assertNoCycle(t.id, input.blockedBy);
      tx(db, () => {
        db.run('DELETE FROM ticket_relations WHERE ticket_id = ? AND kind = ?', [t.id, 'blocks']);
        for (const b of input.blockedBy!) db.insert('ticket_relations', { ticketId: t.id, relatedTicketId: b, kind: 'blocks' });
      });
    }
    if (to === 'blocked') {
      patch.blockedTransitionAt = now;
      // The status this ticket is about to lose, recorded so resuming or unblocking it later can
      // restore exactly this rather than guessing from a signal that will already be gone by then
      // (VS-118).
      patch.blockedFromStatus = t.status;
      if (input.unblock) patch.unblockJson = input.unblock;
    } else {
      patch.unblockJson = null;
      patch.blockedTransitionAt = null;
      patch.blockedFromStatus = null;
    }
    if (!t.startedAt && (to === 'proposing' || to === 'in_progress')) patch.startedAt = now;
    if (to === 'done') patch.completedAt = now;
    if (to === 'cancelled') patch.cancelledAt = now;

    const next = tx(db, () => {
      const updated = touch(t.id, patch);
      if (planBody !== null) putDocument(actor, t.id, 'plan', planBody, { system: true });
      if (input.note) systemComment(t.id, input.note, actor);
      recordActivity(db, ws, actor, 'ticket.transition', 'ticket', t.id, { from: t.status, to, note: input.note ?? null }, t.id);
      ctx.events.emit('ticket.status', 'ticket', t.id, updated);
      return updated;
    });

    // Post-transition side effects (decisions and wakes; both are idempotent-ish and coalesce).
    if (to === 'proposed' && t.kind === 'change') {
      if (approvalOwner(next) === 'none') return transition(actor, t.id, { to: 'approved', note: 'plan auto-approved by policy' });
      // VS-474: the plan approval is raised and left open and unseen. Under YOLO the daemon no longer
      // answers it here: it grants only after the weaver marks the card looked at, through
      // `onReviewLooked` on the mark, so the review cannot be skipped.
      raisePlanApproval(actor, next);
    }
    if (to === 'in_review' && !next.autoMerge && !opts.quiet) {
      const wp = db.get<{ url: string | null; title: string | null }>('SELECT url, title FROM ticket_work_products WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1', [t.id]);
      deps().decisions.create(actor, {
        ticketId: t.id, kind: 'merge_approval', owner: 'human',
        title: `Approve the merge for ${next.identifier}: ${next.title}`,
        context: wp?.url ? `Work product: ${wp.url}` : 'The worker delivered its work product.',
        options: [
          { key: NAMED_CARD_OPTION_KEYS.merge_approval.approve, label: 'Approve merge', recommended: true },
          { key: NAMED_CARD_OPTION_KEYS.merge_approval.changes, label: 'Request changes', description: 'Send it back to the worker.' },
        ],
        allowFreeText: true,
        correlationKey: `merge_approval:${t.id}`,
        askedByAgentId: next.workerId,
        askedInRunId: actor.runId ?? null,
      });
    }
    // A YOLO ticket's merge decision stays open until its work is ready to land; the sweep is what
    // knows how to wait for that, so it runs for a YOLO ticket as well as an `autoMerge` one.
    if (to === 'in_review' && (next.autoMerge || yolo(next))) schedule(50, 'auto-merge sweep after in_review', () => service.autoMergeSweep());
    if (to === 'approved' && !opts.quiet) wake(next.workerId, 'ticket_assigned', `plan approved for ${next.identifier}`, { ticketId: t.id });
    // A ticket blocked on the conductor is not left for the next digest to notice (VS-127): the
    // digest is a periodic, batched sweep, and a stuck worker's unblock action deserves the same
    // immediate wake a gate finding already gets the moment it is raised.
    if (to === 'blocked' && input.unblock?.owner === 'weaver') {
      wake(conductorId(), 'ticket_blocked', `${next.identifier} is blocked on you: ${input.unblock.action}`, { ticketId: t.id });
    }
    // Entering `merging` joins the project's merge queue instead of starting the merge (PLAN §11.4);
    // leaving it gives the slot back. Either way the queue decides who merges next, and it is the
    // queue — never this transition — that wakes a worker to merge.
    let queued = false;
    if (to === 'merging') { await mergeQueue.join(next.id); queued = true; }
    else if (t.status === 'merging') { await mergeQueue.leave(next.id); queued = true; }
    if (to === 'proposing' && t.status === 'proposed') wake(next.workerId, 'ticket_comment', `revision requested for ${next.identifier}`, { ticketId: t.id });
    if (TERMINAL.has(to)) propagateTerminal(next, actor);
    // The queue, or an auto-approval that moved the ticket on, wrote to the row after it was read,
    // so the caller gets the ticket as it now stands rather than as it was mid-transition.
    return queued ? get(t.id) : next;
  }

  // ---------- service ----------

  function latestWorkerFor(ticketId: string): Agent | null {
    return db.get<Agent>("SELECT * FROM agents WHERE ticket_id = ? AND kind = 'worker' ORDER BY created_at DESC LIMIT 1", [ticketId]) ?? null;
  }

  /**
   * A human replied to a ticket that has no live worker (PLAN §6, "a ticket is a conversation"):
   * done/cancelled → reopen and bring a worker back on the ticket's branch; a parked or failed
   * worker → relaunch it with the comment; an unassigned ticket → the conductor hears about it.
   */
  async function followUpWithoutWorker(actor: Actor, ticketId: string, payload: { ticketId: string; commentId: string; body: string; truncated?: true; bodyLength?: number }): Promise<void> {
    const t = get(ticketId);
    if (t.workerId) return;
    if (t.status === 'done' || t.status === 'cancelled') {
      await transition(actor, t.id, { to: t.status === 'done' ? 'in_progress' : 'todo', note: 'reopened by a reply' });
    }
    const fresh = get(t.id);
    const worker = latestWorkerFor(fresh.id);
    if (worker && worker.status !== 'retired') {
      await deps().workers.relaunch(actor, worker.id, `The human replied on ${fresh.identifier}: ${commentExcerpt(payload.body, 300)}`);
      return;
    }
    if (fresh.assigneeRoleId) {
      // A fresh worker of the same role: same branch, same PR, the full ticket record in its brief.
      if (fresh.status === 'in_progress' || fresh.status === 'todo' || fresh.status === 'approved' || fresh.status === 'in_review') {
        await deps().workers.spawnForTicket(actor, fresh.id);
        const spawned = get(fresh.id);
        if (spawned.workerId) wake(spawned.workerId, 'ticket_comment', commentWakeReason(`new comment on ${fresh.identifier}`, payload.truncated === true), payload, actor);
      }
      return;
    }
    try {
      const conductor = deps().workers.conductor();
      wake(conductor.id, 'ticket_comment', `${fresh.identifier} got a reply but has no role: ${commentExcerpt(payload.body, 160)}`, payload);
    } catch { /* no conductor yet */ }
  }

  /**
   * VS-365: a ticket's current delivery head, resolved generally so a fix pushed to a held merge card
   * can be noticed without a comment. In order: the pull request's head when the ticket has a PR and
   * its forge reports one; else the worker worktree's `HEAD` (covers `local-branch` delivery and a
   * committed-but-unpushed fix); else the project clone's branch ref, local then `origin/`. Returns
   * null when nothing resolves and never throws — the caller is a notification, not a gate.
   */
  async function resolveDeliveryHead(t: Ticket): Promise<string | null> {
    try {
      const wt = db.get<{ path: string; branch: string }>(
        "SELECT path, branch FROM worktrees WHERE ticket_id = ? AND status != 'removed' ORDER BY created_at DESC LIMIT 1",
        [t.id],
      );
      const p = project(t.projectId);
      const wp = db.get<{ url: string }>(
        "SELECT url FROM ticket_work_products WHERE ticket_id = ? AND type = 'pull_request' AND url IS NOT NULL ORDER BY created_at DESC LIMIT 1",
        [t.id],
      );
      if (wp?.url && p && existsSync(p.clonePath)) {
        const forge = ctx.registries.forges.get('github');
        const state = forge ? await forge.prState(p.clonePath, wp.url).catch(() => null) : null;
        if (state?.headSha) return state.headSha;
      }
      if (wt && existsSync(wt.path)) {
        const r = await git(['rev-parse', 'HEAD'], wt.path, 15_000);
        if (r.ok && r.stdout.trim()) return r.stdout.trim();
      }
      const branch = wt?.branch ?? ticketBranchFor(t);
      if (p && existsSync(p.clonePath)) {
        for (const ref of [branch, `origin/${branch}`]) {
          const r = await git(['rev-parse', '--verify', '--quiet', ref], p.clonePath, 15_000);
          if (r.ok && r.stdout.trim()) return r.stdout.trim();
        }
      }
    } catch (e) {
      log.warn({ err: String(e), ticketId: t.id }, 'delivery head resolution failed');
    }
    return null;
  }

  /** The `archive` target a merge card carries when it lands an archive-backfill pull request (VS-389). */
  function archiveTargetOf(target: Record<string, unknown> | null | undefined): { prUrl: string } | null {
    const raw = target?.['archive'];
    if (!raw || typeof raw !== 'object') return null;
    const prUrl = (raw as Record<string, unknown>)['prUrl'];
    return typeof prUrl === 'string' && prUrl ? { prUrl } : null;
  }

  /**
   * VS-474: the head a merge card is about to land — the archive pull request's own head for an
   * archive-backfill card, otherwise the ticket's delivery head. The review mark records this and the
   * grant hold compares against it, so a YOLO merge can never land a head the weaver did not review.
   * The archive case matters: the finished ticket's `deliveryHead` is its original pull request, not
   * the archive pull request the card exists to land.
   */
  async function resolveApprovalHead(ticketId: string | null, target: Record<string, unknown> | null | undefined): Promise<string | null> {
    const archive = archiveTargetOf(target);
    if (archive) {
      const t = ticketId ? get(ticketId) : null;
      const p = t ? project(t.projectId) : null;
      const forge = ctx.registries.forges.get('github');
      if (!p || !forge) return null;
      const state = await forge.prState(p.clonePath, archive.prUrl).catch(() => null);
      return state?.headSha ?? null;
    }
    return ticketId ? resolveDeliveryHead(get(ticketId)) : null;
  }

  /** The pull request a merge card is about to land, named in the re-review wake (VS-474). */
  function approvalPrUrl(ticketId: string, target: Record<string, unknown> | null | undefined): string | null {
    const archive = archiveTargetOf(target);
    if (archive) return archive.prUrl;
    return db.get<{ url: string }>(
      "SELECT url FROM ticket_work_products WHERE ticket_id = ? AND type = 'pull_request' AND url IS NOT NULL ORDER BY created_at DESC LIMIT 1",
      [ticketId],
    )?.url ?? null;
  }

  const service: TicketsService = {
    create(actor, input: TicketCreateInput) {
      if (input.projectId) {
        // Accept a project slug as well as its id.
        let resolved: string | null = null;
        try { resolved = deps().projects.get(input.projectId).id; } catch { resolved = project(input.projectId) ? input.projectId : null; }
        if (!resolved) throw new OcError('not_found', `project ${input.projectId} not found`);
        input = { ...input, projectId: resolved };
      }
      input = applyRoutineFilingPolicy(actor, input);
      if (input.parentId && !find(input.parentId)) throw new OcError('not_found', `parent ticket ${input.parentId} not found`);
      const blockedBy = input.blockedBy ?? [];
      for (const b of blockedBy) if (!find(b)) throw new OcError('not_found', `blocker ${b} not found`);
      if (input.assigneeRoleId && !db.get('SELECT id FROM roles WHERE id = ?', [input.assigneeRoleId])) {
        throw new OcError('not_found', `role ${input.assigneeRoleId} not found`);
      }
      const workerModelId = resolveWorkerModelId(input.workerModelId);
      return tx(db, () => {
        const number = allocateNumber();
        const identifier = `${prefix()}-${number}`;
        const id = newId();
        const now = nowIso();
        const openBlockers = blockedBy.filter((b) => get(b).status !== 'done');
        const status: TicketStatus = openBlockers.length ? 'blocked' : input.assigneeRoleId ? 'todo' : 'backlog';
        try {
          db.insert('tickets', {
            id, workspaceId: ws, projectId: input.projectId ?? null, number, identifier, kind: input.kind, title: input.title,
            description: input.description ?? '', summary: input.summary ?? null, status, priority: input.priority ?? 'medium', autoMerge: input.autoMerge ?? false,
            assigneeRoleId: input.assigneeRoleId ?? null, assigneeHuman: false, interactiveSession: input.interactiveSession ?? false, landingBranch: input.landingBranch ?? null, workerModelId, parentId: input.parentId ?? null,
            createdByKind: actor.kind, createdById: actor.id, createdRunId: actor.runId ?? null, originKind: input.originKind ?? null,
            originFingerprint: input.originFingerprint ?? null, blockedTransitionAt: openBlockers.length ? now : null,
            createdAt: now, updatedAt: now,
          });
        } catch (e) {
          if (input.originFingerprint && /UNIQUE/i.test(String(e))) {
            throw new OcError('conflict', 'an open ticket with the same origin fingerprint already exists', { originFingerprint: input.originFingerprint });
          }
          throw e;
        }
        for (const b of blockedBy) {
          assertNoCycle(id, [b]);
          db.insert('ticket_relations', { ticketId: id, relatedTicketId: b, kind: 'blocks' });
        }
        const t = get(id);
        if (input.assigneeRoleId) bindOpenspec(t);
        const created = get(id);
        recordActivity(db, ws, actor, 'ticket.create', 'ticket', id, { kind: input.kind, identifier, status }, id);
        ctx.events.emit('ticket.created', 'ticket', id, created);
        return created;
      });
    },

    get,

    list(filter: TicketFilter = {}) {
      const where: string[] = ['workspace_id = ?'];
      const params: Array<string | number> = [ws];
      if (filter.projectId) { where.push('project_id = ?'); params.push(filter.projectId); }
      if (filter.roleId) { where.push('assignee_role_id = ?'); params.push(filter.roleId); }
      if (filter.workerId) { where.push('worker_id = ?'); params.push(filter.workerId); }
      if (filter.status?.length) { where.push(`status IN (${filter.status.map(() => '?').join(',')})`); params.push(...filter.status); }
      else if (!filter.includeTerminal) { where.push("status NOT IN ('done','cancelled')"); }
      if (filter.kind?.length) { where.push(`kind IN (${filter.kind.map(() => '?').join(',')})`); params.push(...filter.kind); }
      if (filter.search) { where.push('(title LIKE ? OR description LIKE ? OR identifier LIKE ?)'); const q = `%${filter.search}%`; params.push(q, q, q.toUpperCase()); }
      const clause = where.join(' AND ');
      const total = db.get<{ n: number }>(`SELECT COUNT(*) n FROM tickets WHERE ${clause}`, params)?.n ?? 0;
      const limit = Math.min(filter.limit ?? 100, 500);
      const offset = filter.offset ?? 0;
      // A terminal ticket's number says when it was filed, not when it landed, so a page of
      // finished tickets ordered by number can miss what actually finished today.
      const order = filter.sort === 'finished'
        ? 'COALESCE(completed_at, cancelled_at, updated_at) DESC, number DESC'
        : 'number DESC';
      const items = db.all<Record<string, unknown>>(`SELECT * FROM tickets WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`, [...params, limit, offset]).map(row)
        .map((t) => (filter.fields === 'label' ? { ...t, description: '' } : t));
      return { items, total } satisfies Page<Ticket>;
    },

    update(actor, id, patch) {
      const t = get(id);
      const clean: Record<string, unknown> = {};
      for (const k of ['title', 'description', 'summary', 'priority', 'autoMerge', 'parentId', 'projectId'] as const) {
        if (patch[k] !== undefined) clean[k] = patch[k];
      }
      if (!Object.keys(clean).length) return t;
      if (clean.parentId && clean.parentId === t.id) throw new OcError('validation', 'a ticket cannot be its own parent');
      return tx(db, () => {
        const next = touch(t.id, clean);
        recordActivity(db, ws, actor, 'ticket.update', 'ticket', t.id, { keys: Object.keys(clean) }, t.id);
        ctx.events.emit('ticket.updated', 'ticket', t.id, next);
        return next;
      });
    },

    assign(actor, id, roleId, workerModelId) {
      const t = get(id);
      if (roleId) {
        const role = db.get<{ id: string; projectId: string; status: string }>('SELECT id, project_id, status FROM roles WHERE id = ?', [roleId]);
        if (!role) throw new OcError('not_found', `role ${roleId} not found`);
        if (role.status === 'retired') throw new OcError('validation', 'cannot assign a retired role');
        if (t.projectId && role.projectId !== t.projectId) throw new OcError('validation', 'role belongs to a different project', { roleId, projectId: t.projectId });
      }
      if (workerModelId !== undefined && t.workerId) {
        throw new OcError('validation', 'cannot change a ticket\'s worker model after its worker has spawned');
      }
      const resolvedModelId = workerModelId === undefined ? undefined : resolveWorkerModelId(workerModelId);
      return tx(db, () => {
        const patch: Record<string, unknown> = { assigneeRoleId: roleId, assigneeHuman: false };
        if (roleId && t.status === 'backlog') patch.status = 'todo';
        if (!roleId) patch.workerId = null;
        if (resolvedModelId !== undefined) patch.workerModelId = resolvedModelId;
        const next = touch(t.id, patch);
        if (roleId) bindOpenspec(next);
        const out = get(t.id);
        recordActivity(db, ws, actor, 'ticket.assign', 'ticket', t.id, { roleId, status: out.status }, t.id);
        ctx.events.emit('ticket.assigned', 'ticket', t.id, out);
        if (patch.status === 'todo') ctx.events.emit('ticket.status', 'ticket', t.id, out);
        return out;
      });
    },

    setWorkerModelFromQuotaCard(actor, id, optionId) {
      const t = get(id);
      const resolved = resolveWorkerModelId(optionId);
      if (resolved == null) throw new OcError('validation', `unknown worker model option '${optionId}'`);
      return tx(db, () => {
        const next = touch(t.id, { workerModelId: resolved });
        recordActivity(db, ws, actor, 'ticket.update', 'ticket', t.id, { workerModelId: resolved, from: 'quota_card' }, t.id);
        ctx.events.emit('ticket.updated', 'ticket', t.id, next);
        return next;
      });
    },

    setBlockers(actor, id, blockedBy) {
      const t = get(id);
      for (const b of blockedBy) if (!find(b)) throw new OcError('not_found', `blocker ${b} not found`);
      assertNoCycle(t.id, blockedBy);
      return tx(db, () => {
        db.run('DELETE FROM ticket_relations WHERE ticket_id = ? AND kind = ?', [t.id, 'blocks']);
        for (const b of blockedBy) db.insert('ticket_relations', { ticketId: t.id, relatedTicketId: b, kind: 'blocks' });
        const open = blockersOf(t.id).filter((b) => b.status !== 'done');
        const patch: Record<string, unknown> = {};
        if (open.length && !TERMINAL.has(t.status) && t.status !== 'blocked') {
          patch.status = 'blocked';
          patch.blockedTransitionAt = nowIso();
          patch.blockedFromStatus = t.status;
        } else if (!open.length && t.status === 'blocked') {
          patch.status = t.blockedFromStatus ?? (t.assigneeRoleId || t.workerId ? 'todo' : 'backlog');
          patch.unblockJson = null;
          patch.blockedTransitionAt = null;
          patch.blockedFromStatus = null;
        }
        const next = touch(t.id, patch);
        recordActivity(db, ws, actor, 'ticket.blockers', 'ticket', t.id, { blockedBy, status: next.status }, t.id);
        ctx.events.emit('ticket.updated', 'ticket', t.id, next);
        if (patch.status) {
          ctx.events.emit('ticket.status', 'ticket', t.id, next);
          if (patch.status !== 'blocked') wake(next.workerId, 'blockers_resolved', `blockers cleared for ${next.identifier}`, { ticketId: t.id });
        }
        return next;
      });
    },

    blockers: (id) => blockersOf(get(id).id),
    children: (id) => childrenOf(get(id).id),

    checkout(actor, id, runId, agentId) {
      const t = get(id);
      if (t.workerId && t.workerId !== agentId) {
        throw new OcError('conflict', `${t.identifier} is checked out by another worker`, { workerId: t.workerId });
      }
      if (t.executionRunId && t.executionRunId !== runId) {
        const holder = db.get<{ agentId: string }>('SELECT agent_id FROM runs WHERE id = ?', [t.executionRunId]);
        if (holder && holder.agentId !== agentId) {
          throw new OcError('conflict', `${t.identifier} is locked by run ${t.executionRunId}`, { runId: t.executionRunId, agentId: holder.agentId });
        }
      }
      return tx(db, () => {
        const next = touch(t.id, { checkoutRunId: runId, executionRunId: runId, executionLockedAt: nowIso() });
        recordActivity(db, ws, actor, 'ticket.checkout', 'ticket', t.id, { runId, agentId }, t.id);
        ctx.events.emit('ticket.updated', 'ticket', t.id, next);
        return next;
      });
    },

    release(actor, id, runId, note) {
      const t = get(id);
      return tx(db, () => {
        const patch: Record<string, unknown> = {};
        if (t.executionRunId === runId) { patch.executionRunId = null; patch.executionLockedAt = null; }
        if (t.checkoutRunId === runId) patch.checkoutRunId = null;
        const next = touch(t.id, patch);
        if (note) systemComment(t.id, note, actor);
        recordActivity(db, ws, actor, 'ticket.release', 'ticket', t.id, { runId, note: note ?? null }, t.id);
        ctx.events.emit('ticket.updated', 'ticket', t.id, next);
        return next;
      });
    },

    transition,

    cancel(actor, id, reason) {
      const t = get(id);
      if (TERMINAL.has(t.status)) throw new OcError('wrong_status', `${t.identifier} is already ${t.status}`);
      return tx(db, () => {
        const next = touch(t.id, { status: 'cancelled', cancelledAt: nowIso(), unblockJson: null });
        systemComment(t.id, `Cancelled: ${reason}`, actor);
        recordActivity(db, ws, actor, 'ticket.cancel', 'ticket', t.id, { from: t.status, reason }, t.id);
        ctx.events.emit('ticket.status', 'ticket', t.id, next);
        propagateTerminal(next, actor);
        return next;
      });
    },

    comment(actor, id, body, kind: CommentKind = 'comment', sourceTrust?: SourceTrust) {
      const t = get(id);
      const trust: SourceTrust = sourceTrust ?? (actor.kind === 'human' ? 'trusted' : actor.kind === 'agent' ? 'agent' : 'trusted');
      const c: TicketComment = {
        id: newId(), ticketId: t.id, authorKind: actor.kind, authorId: actor.id, runId: actor.runId ?? null,
        body, kind, sourceTrust: trust, createdAt: nowIso(),
      };
      const wakeBody = commentWakeBody(body);
      return tx(db, () => {
        db.insert('ticket_comments', { ...c });
        recordActivity(db, ws, actor, 'ticket.comment', 'ticket_comment', c.id, { kind }, t.id);
        ctx.events.emit('ticket.comment', 'ticket', t.id, c);
        if (actor.kind === 'human' && t.workerId) {
          wake(t.workerId, 'ticket_comment', commentWakeReason(`new comment on ${t.identifier}`, wakeBody.truncated === true), { ticketId: t.id, commentId: c.id, ...wakeBody }, actor);
        } else if (actor.kind === 'human' && kind === 'comment') {
          // A reply with nobody listening: reopen a finished ticket, bring a worker back, or tell the conductor.
          const followUp = { ticketId: t.id, commentId: c.id, ...wakeBody };
          setImmediate(() => { void followUpWithoutWorker(actor, t.id, followUp).catch((e) => log.warn({ err: String(e), ticket: t.identifier }, 'follow-up after a comment failed')); });
        } else if (actor.kind === 'agent' && actor.id && actor.id !== conductorId()) {
          // VS-275: a held review (VS-266) is answered by the worker's fix, which arrives as an
          // ordinary comment. Wake the weaver so it can re-read and mark the decision; the mark
          // itself stays the weaver's judgement, so nothing here touches the review state. One wake
          // per comment however many decisions are marked — the wake makes the weaver look, not enumerate.
          const held = db.get<{ id: string; title: string }>(
            "SELECT id, title FROM decisions WHERE ticket_id = ? AND status = 'open' AND weaver_review_status = 'concerns' ORDER BY created_at DESC LIMIT 1",
            [t.id],
          );
          if (held) wake(conductorId(), 'ticket_comment', `${t.identifier}: a worker answered the held review "${held.title}"`, { ticketId: t.id, commentId: c.id, decisionId: held.id });
        }
        return c;
      });
    },

    async retry(actor, id, note) {
      const t = get(id);
      if (t.status === 'done' || t.status === 'cancelled') throw new OcError('wrong_status', `${t.identifier} is ${t.status}; reply to it or reopen it instead`);
      const worker = t.workerId ? deps().workers.get(t.workerId) : latestWorkerFor(t.id);
      if (worker && worker.status !== 'retired') {
        await deps().workers.relaunch(actor, worker.id, note ?? 'retry requested');
      } else if (t.assigneeRoleId) {
        await deps().workers.spawnForTicket(actor, t.id);
      } else {
        throw new OcError('validation', `${t.identifier} has no role; assign one first`);
      }
      if (t.status === 'blocked') {
        const back = t.blockedFromStatus ?? 'todo';
        try { await service.transition(actor, t.id, { to: back as TicketStatus, note: note ?? 'retrying' }); } catch { /* keep blocked if the machine says so */ }
      }
      recordActivity(db, ws, actor, 'ticket.retry', 'ticket', t.id, { note: note ?? null }, t.id);
      return get(t.id);
    },

    /**
     * VS-338: a resolving wake starting a worker's turn means the `{owner, action}` block was
     * answered — but nothing used to move the ticket off `blocked`, so the board stayed wrong while
     * the worker ran. Restore `blockedFromStatus` through the normal transition, quietly (no merge
     * card churn, no second-turn wake). A ticket still waiting on an unfinished `blockedBy` ticket is
     * not resolved by a turn starting, and a refused restore is logged rather than thrown: it must
     * never break the worker's turn.
     */
    async resumeIfBlocked(actor, id, reason) {
      const t = get(id);
      if (t.status !== 'blocked') return t;
      if (blockersOf(t.id).some((b) => b.status !== 'done')) return t;
      const back = (t.blockedFromStatus ?? (t.assigneeRoleId || t.workerId ? 'todo' : 'backlog')) as TicketStatus;
      try {
        return await transition(actor, t.id, { to: back, note: reason }, { quiet: true });
      } catch (e) {
        log.warn({ err: String(e), ticketId: t.id, to: back }, 'could not restore a blocked ticket when its worker resumed');
        return get(t.id);
      }
    },

    comments(id, after) {
      const t = get(id);
      const params: Array<string> = [t.id];
      let sql = 'SELECT * FROM ticket_comments WHERE ticket_id = ? AND deleted_at IS NULL';
      if (after) { sql += ' AND created_at > ?'; params.push(after); }
      sql += ' ORDER BY created_at, rowid';
      return db.all<TicketComment>(sql, params);
    },

    deliveryHead(id) {
      return resolveDeliveryHead(get(id));
    },

    /**
     * VS-474: the head a given approval will land — the archive pull request's head for an
     * archive-backfill card, otherwise the ticket's delivery head. The review mark records it and
     * the daemon's grant hold compares against it.
     */
    approvalDeliveryHead(d) {
      return resolveApprovalHead(d.ticketId, d.target);
    },

    /**
     * VS-474: under YOLO, grant a card the weaver has just marked **looked at**. Called from
     * `decisions.review()` on the mark, so the grant is prompt and the "YOLO grants only after
     * review" invariant lives at the single mark path rather than at each auto-approve caller. A plan
     * approval is granted at once; an archive-backfill merge is granted at once (it has no sweep of
     * its own); an ordinary merge is left to `autoMergeSweep`, which owns the CI-readiness gate.
     * Never throws: a grant failure must not fail the review write.
     */
    async onReviewLooked(decisionId) {
      let d: Decision;
      try {
        d = deps().decisions.get(decisionId);
      } catch {
        return;
      }
      if (d.status !== 'open' || (d.kind !== 'plan_approval' && d.kind !== 'merge_approval')) return;
      if ((d.weaverReviewStatus ?? 'unseen') !== 'looked') return;
      const t = d.ticketId ? find(d.ticketId) : null;
      if (!t || !yolo(t)) return;
      const archive = archiveTargetOf(d.target);
      // An ordinary merge is granted by the sweep once the checks pass; only plans and archive-backfill
      // merges have no sweep to grant them.
      if (d.kind === 'merge_approval' && !archive) return;
      try {
        await autoApprove(t, d.id);
      } catch (e) {
        if (archive && e instanceof OcError && e.code === 'revision_pending') {
          // An archive card has no sweep, so a head that moved between the mark and the grant must be
          // surfaced here or it would sit silently held with no comment.
          recordAutoMergeHold(t, 'auto-merge is waiting: the weaver has not reviewed the current head yet', await resolveApprovalHead(d.ticketId, d.target));
          return;
        }
        log.warn({ err: String(e), decisionId }, 'granting a reviewed YOLO approval failed');
      }
    },

    /**
     * VS-365 / VS-474: a commit pushed to a merge card the weaver reviewed must wake it to re-review
     * by itself — a comment was the only signal before this. When the ticket has an open
     * `merge_approval` marked **looked at** (VS-474: a YOLO grant is now held on a head mismatch) or
     * **looked at, with concerns**, and the head the card will land differs from the head recorded at
     * review, wake the weaver once per new head, naming the pull request and the old and new heads.
     * `head` defaults to the approval's own head (the archive pull request for an archive card). A
     * concerns card with no recorded head is baselined without waking; a looked card with no recorded
     * head is left alone, since overwriting its recorded head would authorise a head nobody reviewed.
     * Notification only: no review state is touched, and the wake is idempotent under
     * `held-review:<decisionId>:<sha>`.
     */
    async noteHeldReviewHead(actor, id, head) {
      const t = get(id);
      try {
        const held = db.get<{ id: string; title: string; reviewedHead: string | null; reviewStatus: string; target: Record<string, unknown> | null }>(
          "SELECT id, title, weaver_reviewed_head_sha AS reviewedHead, weaver_review_status AS reviewStatus, target_json FROM decisions WHERE ticket_id = ? AND kind = 'merge_approval' AND status = 'open' AND weaver_review_status IN ('concerns','looked') ORDER BY created_at DESC LIMIT 1",
          [t.id],
        );
        if (!held) return { woken: false };
        const current = head === undefined ? await resolveApprovalHead(t.id, held.target) : head;
        if (!current) return { woken: false, decisionId: held.id };
        if (held.reviewedHead === null) {
          // A `concerns` card with no recorded head (marked before VS-365) is baselined, so it does not
          // wake on a head that has not moved. A `looked` card is never baselined: overwriting its
          // recorded head would make the head-match hold grant a head that was never reviewed.
          if (held.reviewStatus === 'concerns') db.update('decisions', held.id, { weaverReviewedHeadSha: current });
          return { woken: false, decisionId: held.id };
        }
        if (sameGitSha(held.reviewedHead, current)) return { woken: false, decisionId: held.id };
        const cid = conductorId();
        if (!cid) return { woken: false, decisionId: held.id };
        const key = `held-review:${held.id}:${current}`;
        // Mirror the wake service's Gate 0 so the result is honest: a live wake already carrying this
        // (decision, head) key means the weaver has been told about this commit, however many times the
        // turn-end and reconcile checks run. A dead one (skipped/cancelled/failed) does not.
        const live = db.get<{ status: string }>('SELECT status FROM wakeups WHERE agent_id = ? AND idempotency_key = ?', [cid, key]);
        if (live && ['queued', 'claimed', 'coalesced', 'completed'].includes(live.status)) {
          return { woken: false, decisionId: held.id, headSha: current };
        }
        const prUrl = approvalPrUrl(t.id, held.target);
        const reason = held.reviewStatus === 'concerns'
          ? `${t.identifier}: the merge review moved to ${current.slice(0, 12)} since your concerns on "${held.title}"`
          : `${t.identifier}: reviewed head ${held.reviewedHead.slice(0, 12)}, now ${current.slice(0, 12)} — re-review${prUrl ? ` ${prUrl}` : ''}`;
        wake(
          cid,
          'system',
          reason,
          { ticketId: t.id, decisionId: held.id, headSha: current, reviewedHeadSha: held.reviewedHead, reviewStatus: held.reviewStatus, ...(prUrl ? { prUrl } : {}) },
          actor,
          key,
        );
        return { woken: true, decisionId: held.id, headSha: current };
      } catch (e) {
        log.warn({ err: String(e), ticketId: t.id }, 'held-review head check failed');
        return { woken: false };
      }
    },

    lastWorker(id) {
      const t = get(id);
      return latestWorkerFor(t.id);
    },

    putDocument,

    getDocument(id, key, revision) {
      const t = get(id);
      const doc = db.get<{ id: string; currentRevision: number }>('SELECT id, current_revision FROM ticket_documents WHERE ticket_id = ? AND key = ?', [t.id, key]);
      if (!doc) return null;
      const rev = revision ?? doc.currentRevision;
      const r = db.get<{ body: string; createdAt: string }>('SELECT body, created_at FROM ticket_document_revisions WHERE document_id = ? AND revision = ?', [doc.id, rev]);
      if (!r) return null;
      return { documentId: doc.id, revision: rev, body: r.body, createdAt: r.createdAt };
    },

    // VS-224: how a decision's document target is followed — the target carries the id, not the
    // key, so decisions raised before any key was known (all of today's) stay readable. Joined
    // against the ticket so one ticket's card can never read another ticket's document by id.
    getDocumentById(id, documentId, revision) {
      const t = get(id);
      const doc = db.get<{ id: string; key: string; currentRevision: number }>(
        'SELECT id, key, current_revision FROM ticket_documents WHERE ticket_id = ? AND id = ?',
        [t.id, documentId],
      );
      if (!doc) return null;
      const rev = revision ?? doc.currentRevision;
      const r = db.get<{ body: string; createdAt: string }>('SELECT body, created_at FROM ticket_document_revisions WHERE document_id = ? AND revision = ?', [doc.id, rev]);
      if (!r) return null;
      return { key: doc.key, documentId: doc.id, revision: rev, currentRevision: doc.currentRevision, body: r.body, createdAt: r.createdAt };
    },

    documents(id) {
      const t = get(id);
      return db.all<{ key: string; revision: number; updatedAt: string }>(
        `SELECT d.key AS key, d.current_revision AS revision, COALESCE(r.created_at, '') AS updated_at
           FROM ticket_documents d
           LEFT JOIN ticket_document_revisions r ON r.document_id = d.id AND r.revision = d.current_revision
          WHERE d.ticket_id = ? AND d.current_revision > 0
          ORDER BY d.key`,
        [t.id],
      );
    },

    documentRevisions(id, key) {
      const t = get(id);
      const doc = db.get<{ id: string }>('SELECT id FROM ticket_documents WHERE ticket_id = ? AND key = ?', [t.id, key]);
      if (!doc) return [];
      return db.all<{ revision: number; authorKind: string; createdAt: string }>(
        'SELECT revision, author_kind, created_at FROM ticket_document_revisions WHERE document_id = ? ORDER BY revision',
        [doc.id],
      );
    },

    addWorkProduct(actor, id, wp) {
      const t = get(id);
      const wpId = newId();
      const now = nowIso();
      return tx(db, () => {
        if (wp.isPrimary) db.run('UPDATE ticket_work_products SET is_primary = 0 WHERE ticket_id = ?', [t.id]);
        db.insert('ticket_work_products', {
          id: wpId, ticketId: t.id, runId: actor.runId ?? null, type: wp.type as WorkProductType, provider: wp.provider ?? null,
          externalId: wp.externalId ?? null, url: wp.url ?? null, title: wp.title ?? null, state: wp.state ?? null,
          isPrimary: wp.isPrimary ?? false, metadataJson: wp.metadata ?? {}, createdAt: now, updatedAt: now,
        });
        if (wp.type === 'pull_request' || wp.type === 'branch') {
          const delivery = { ...(t.delivery ?? {}), ...(wp.type === 'pull_request' ? { prUrl: wp.url, prState: wp.state } : { branch: wp.title ?? wp.externalId }) };
          db.update('tickets', t.id, { deliveryJson: delivery, updatedAt: now });
        }
        recordActivity(db, ws, actor, 'ticket.work_product', 'ticket_work_product', wpId, { type: wp.type, url: wp.url ?? null }, t.id);
        ctx.events.emit('ticket.work_product', 'ticket', t.id, { ticketId: t.id, id: wpId, ...wp });
        return { id: wpId };
      });
    },

    workProducts(id) {
      const t = get(id);
      return db.all<Record<string, unknown>>('SELECT * FROM ticket_work_products WHERE ticket_id = ? ORDER BY created_at', [t.id]);
    },

    // VS-393: the one path a ticket's pull request is opened by, so the draft flag and the work
    // product are the daemon's job, not each worker's memory. Draft only where the daemon lands it.
    async openPullRequest(actor, id, input) {
      const t = get(id);
      if (!t.projectId) throw new OcError('validation', `${t.identifier} has no project to open a pull request against`, { ticketId: t.id });
      const project = deps().projects.get(t.projectId);
      const mode = (project.policies as { deliveryMode?: string } | null)?.deliveryMode ?? ctx.config.defaults.deliveryMode;
      if (mode !== 'pr') {
        throw new OcError('validation', `${t.identifier}'s project uses ${mode} delivery, not pull requests; deliver per your delivery mode`, { deliveryMode: mode, ticketId: t.id });
      }
      const forge = ctx.registries.forges.get('github');
      if (!forge?.createPullRequest) {
        throw new OcError('validation', `no forge is available to open ${t.identifier}'s pull request`, { ticketId: t.id });
      }
      const wt = db.get<{ branch: string }>('SELECT branch FROM worktrees WHERE ticket_id = ? AND status != ? ORDER BY created_at DESC LIMIT 1', [t.id, 'removed']);
      const branch = wt?.branch ?? ticketBranchFor(t);
      // A retry (or a worker that opens one itself) must never create a second pull request for the
      // same branch, and must never flip an existing non-draft one back to draft.
      const existing = forge.pullRequestForBranch ? await forge.pullRequestForBranch(project.clonePath, branch) : null;
      const pr = existing ?? await forge.createPullRequest(project.clonePath, {
        branch, base: landingBranchOf(project, t), title: input.title, body: input.body ?? '', draft: true,
      });
      service.addWorkProduct(actor, t.id, { type: 'pull_request', url: pr.url, title: input.title, state: 'open', provider: forge.id });
      recordActivity(db, ws, actor, 'ticket.pr_opened', 'ticket', t.id, { url: pr.url, number: pr.number, reused: Boolean(existing) }, t.id);
      return pr;
    },

    putArtifactWorkProduct(actor, id, key, wp) {
      const t = get(id);
      const now = nowIso();
      return tx(db, () => {
        const existing = db.get<{ id: string }>(
          "SELECT id FROM ticket_work_products WHERE ticket_id = ? AND type = 'artifact' AND external_id = ?",
          [t.id, key],
        );
        if (existing) {
          db.update('ticket_work_products', existing.id, {
            url: wp.url, title: wp.title ?? null, metadataJson: { kind: wp.kind ?? null }, updatedAt: now,
          });
          recordActivity(db, ws, actor, 'ticket.work_product', 'ticket_work_product', existing.id, { type: 'artifact', url: wp.url }, t.id);
          ctx.events.emit('ticket.work_product', 'ticket', t.id, { ticketId: t.id, id: existing.id, type: 'artifact', url: wp.url, title: wp.title ?? null });
          return { id: existing.id };
        }
        const wpId = newId();
        db.insert('ticket_work_products', {
          id: wpId, ticketId: t.id, runId: actor.runId ?? null, type: 'artifact', provider: null,
          externalId: key, url: wp.url, title: wp.title ?? null, state: null,
          isPrimary: false, metadataJson: { kind: wp.kind ?? null }, createdAt: now, updatedAt: now,
        });
        recordActivity(db, ws, actor, 'ticket.work_product', 'ticket_work_product', wpId, { type: 'artifact', url: wp.url }, t.id);
        ctx.events.emit('ticket.work_product', 'ticket', t.id, { ticketId: t.id, id: wpId, type: 'artifact', url: wp.url, title: wp.title ?? null });
        return { id: wpId };
      });
    },

    artifacts(projectId) {
      return db.all<{
        id: string; ticketId: string; ticketIdentifier: string; ticketTitle: string; key: string;
        title: string | null; metadata: Record<string, unknown>; url: string | null; updatedAt: string;
        previewable: number;
      }>(
        // VS-331: a row is previewable only when VS-269 actually stored its `artifact:<key>` document;
        // a link-only row recorded through the general work-product tool has no document and must not
        // be treated as a published artifact. Existing rows (e.g. VS-68's `file://` folder) are kept
        // listed but flagged false, so the explorer and ticket page can render them as plain links.
        `SELECT wp.id AS id, wp.ticket_id AS ticket_id, t.identifier AS ticket_identifier, t.title AS ticket_title,
                wp.external_id AS key, wp.title AS title, wp.metadata_json AS metadata_json, wp.url AS url, wp.updated_at AS updated_at,
                EXISTS(SELECT 1 FROM ticket_documents d
                        WHERE d.ticket_id = wp.ticket_id
                          AND d.key = 'artifact:' || wp.external_id
                          AND d.current_revision > 0) AS previewable
           FROM ticket_work_products wp JOIN tickets t ON t.id = wp.ticket_id
          WHERE wp.type = 'artifact' AND (? IS NULL OR t.project_id = ?)
          ORDER BY wp.updated_at DESC`,
        [projectId, projectId],
      ).map((r) => ({ ...r, previewable: r.previewable === 1 }));
    },

    async mergeDone(actor, id, info) {
      const t = get(id);
      if (t.status !== 'merging') throw new OcError('wrong_status', `${t.identifier} is ${t.status}, not merging`);
      // Land the delivery into the primary clone first (ff for local-branch; verify containment for pr). Not landed → the worker keeps the ticket in merging.
      let landInfo: LandResult | null = null;
      let trustedMerge: string | undefined;
      // VS-327: true once the archive-then-merge sequence below has already archived (or determined
      // there was nothing to archive for) this ticket, so the old post-merge `archiveAfterMerge` path
      // — which pushes straight to the landing branch — is only reached for a PR merged out of band.
      let archivedByNewFlow = false;
      let newFlowArchivedAs: string | null = null;
      if (t.projectId) {
        let project: Project | null = null;
        try { project = deps().projects.get(t.projectId); } catch { project = null; }
        if (project && existsSync(project.clonePath)) {
          const wt = db.get<{ branch: string }>('SELECT branch FROM worktrees WHERE ticket_id = ? AND status != ? ORDER BY created_at DESC LIMIT 1', [t.id, 'removed']);
          const branch = wt?.branch ?? ticketBranchFor(t);
          // One landing at a time per project: this checks out and fast-forwards the clone every
          // ticket of the project shares, and reconciliation can call mergeDone outside the queue.
          const p = project;
          const mode = ((p.policies as { deliveryMode?: string } | null)?.deliveryMode ?? ctx.config.defaults.deliveryMode) as 'pr' | 'local-branch';
          // VS-327 design.md Decision 2: freshness check, daemon rebase, archive, push, merge,
          // verify and fast-forward are all one project-serialized critical section — never two
          // separate ones either side of the merge, or a ticket landing on the same project
          // concurrently could archive against a base this ticket's own merge has since moved past.
          landInfo = await serialize(project.id, async () => {
            // VS-358: read inside the lock, immediately before landing — not before `serialize(...)`
            // is even called, or a ticket that queued behind another landing for this project would
            // scope its reconciliation diff to more than its own landing actually changed.
            const beforeSha = (await git(['rev-parse', 'HEAD'], p.clonePath, 15_000)).stdout.trim() || null;
            let mergeCommit: string | undefined;
            if (mode === 'pr') {
              const pr = db.get<{ url: string | null }>("SELECT url FROM ticket_work_products WHERE ticket_id = ? AND type = 'pull_request' ORDER BY created_at DESC LIMIT 1", [t.id]);
              if (pr?.url) {
                const forge = ctx.registries.forges.get('github');
                const state = forge ? await forge.prState(p.clonePath, pr.url).catch(() => null) : null;
                if (state && state.state === 'closed') {
                  throw new OcError('merge_unverified', `pull request is closed, not merged`, { forgeState: state.state, prUrl: pr.url });
                }
                if (forge && state && state.state !== 'merged') {
                  // Not yet merged: the daemon lands it now (VS-327), archiving the ticket's own
                  // OpenSpec change onto its branch first (if it has one) and merging with the
                  // project's configured method — the worker no longer runs `gh pr merge` itself.
                  const method = info.method ?? String((p.policies as { mergeMethod?: string } | null)?.mergeMethod ?? 'squash');
                  // A landing failure other than "checks still pending" is real: the worker already
                  // learns of it synchronously (this call's own thrown error), but a comment leaves a
                  // durable trail for anyone reviewing the ticket later too (task 2.7). No `unblock`
                  // and no weaver wake — the worker is expected to resolve and retry on its own, the
                  // same way it already handles a plain rebase conflict.
                  const failLanding = (action: string): never => {
                    systemComment(t.id, action, actor);
                    recordActivity(db, ws, actor, 'ticket.merge_archive_failed', 'ticket', t.id, { error: action }, t.id);
                    throw new OcError('merge_unverified', action, { branch, prUrl: pr.url });
                  };
                  let outcome: Awaited<ReturnType<typeof attemptArchiveThenMerge>>;
                  try {
                    outcome = await attemptArchiveThenMerge({
                      clonePath: p.clonePath, branch, landingBranch: landingBranchOf(p, t), changeName: t.openspecChangeName, forge, prUrl: pr.url, method,
                      requiresCi: (p.policies as { requireCi?: boolean } | null)?.requireCi !== false,
                      // VS-393: the forge could not tell the repo has no CI, and no rollup appeared
                      // within the wait limit — merge anyway, with one line on the ticket saying so.
                      onNoCiTimeout: () => systemComment(t.id, 'no checks appeared within the wait limit; the forge could not confirm the repository has CI, so the merge proceeds as for a project with none', actor),
                      // VS-467: the head had no usable run for a CI repository; one empty trigger
                      // commit was pushed to start a fresh pull_request run. The landing still waits
                      // for its success, never merging on the trigger.
                      onChecksRetriggered: () => systemComment(t.id, 'no usable CI run existed for the landing head; pushed a trigger commit to start a fresh pull_request run and is still waiting for it to succeed before merging', actor),
                      scratch: { stateDir: ctx.paths.state, projectSlug: p.slug, label: t.identifier },
                    });
                  } catch (e) {
                    const action = `landing failed: ${e instanceof Error ? e.message : String(e)}`;
                    systemComment(t.id, action, actor);
                    recordActivity(db, ws, actor, 'ticket.merge_archive_failed', 'ticket', t.id, { error: action }, t.id);
                    throw e instanceof OcError ? new OcError(e.code, action, { ...(e.details ?? {}), ticketId: t.id }) : new OcError('internal', action, { ticketId: t.id });
                  }
                  if (outcome.kind === 'conflict') {
                    return failLanding(`branch ${branch} conflicts with ${landingBranchOf(p, t)}; re-sync and retry. ${outcome.detail}`);
                  }
                  if (outcome.kind === 'rebuild_failed') {
                    // Unreachable here (the rebuild opt is off for a ticket's own branch); handled so
                    // the outcome union is exhausted and a future caller cannot fall through.
                    return failLanding(`rebuilding the archive failed: ${outcome.detail}`);
                  }
                  if (outcome.kind === 'checks_pending') {
                    throw new OcError('merge_checks_pending', 'required checks are pending on the archived branch; retry once they resolve', { prUrl: pr.url }, true);
                  }
                  if (outcome.kind === 'checks_failed') {
                    return failLanding('required checks failed on the archived branch');
                  }
                  mergeCommit = outcome.mergeCommit;
                  trustedMerge = outcome.mergeCommit;
                  archivedByNewFlow = true;
                  newFlowArchivedAs = outcome.archivedAs;
                } else if (state?.state === 'merged' && state.mergeCommit) {
                  // Already merged out of band, or a previous attempt reached the merge but crashed
                  // before finishing the bookkeeping below — trust the forge, same as before VS-327.
                  if (info.mergeCommit && !sameGitSha(info.mergeCommit, state.mergeCommit)) {
                    throw new OcError(
                      'merge_unverified',
                      `reported merge commit ${info.mergeCommit.slice(0, 12)} is not the forge's ${state.mergeCommit.slice(0, 12)} for this pull request`,
                      { reported: info.mergeCommit, forge: state.mergeCommit, prUrl: pr.url },
                    );
                  }
                  mergeCommit = state.mergeCommit;
                  trustedMerge = state.mergeCommit;
                }
              }
            }
            // VS-232 — both halves are load-bearing, do not simplify:
            // 1. Use the forge's merge commit for this PR (caller SHA is a cross-check; omitting it is fine).
            // 2. When the forge is unreachable, do not forward the worker's SHA: ancestry of any
            //    commit already on the landing branch would close a ticket that never merged.
            const result = await landDelivery(ctx.config, p, t, branch, mergeCommit ? { mergeCommit } : undefined);
            if (p.knowledgeRepoEnabled && beforeSha) {
              try {
                const afterSha = (await git(['rev-parse', 'HEAD'], p.clonePath, 15_000)).stdout.trim();
                if (afterSha && afterSha !== beforeSha) {
                  await reconcileProjectKnowledgeFromRepo(ctx, deps, p, beforeSha, afterSha, t.id);
                  // VS-360: same before/after pair, same per-project critical section — kept next to
                  // the knowledge reconcile call above rather than a second lookup or a separate hook.
                  await reconcileProjectArtifactsFromRepo(ctx, deps, p, beforeSha, afterSha);
                }
              } catch (e) {
                // A reconciliation failure never blocks the landing that already succeeded — the
                // workspace copy simply stays as it was until the next opportunity to reconcile it.
                log.warn({ err: e, projectId: p.id, ticketId: t.id }, 'knowledge repo sync after merge failed');
              }
            }
            return result;
          });
          recordActivity(db, ws, actor, 'ticket.delivery_landed', 'ticket', t.id, { ...landInfo }, t.id);
        } else log.warn({ ticketId: t.id }, 'mergeDone: no project clone available; skipping delivery landing');
      }
      let archivedAs: string | null = archivedByNewFlow ? newFlowArchivedAs : null;
      let skipped: string | null = null;
      // VS-327: the sequence above already archived this ticket's change (or established it had
      // none) as part of landing it. Only a PR merged out of band — the one case that sequence never
      // ran for — still needs the old primary-clone archive path, kept for that edge case and for
      // reconciliation's backfill of tickets merged before this change shipped.
      try {
        if (!archivedByNewFlow) {
          const res = await deps().openspec.archiveAfterMerge(t.id);
          archivedAs = res.archivedAs;
          skipped = res.skipped;
          // VS-389: a backfill for a PR-delivery project opens a pull request instead of archiving
          // in place; surface it as a merge card on the (already finished) ticket.
          if (res.pendingPrUrl) {
            try {
              await service.raiseArchiveBackfillCard(actor, t.id, {
                changeName: res.changeName ?? t.openspecChangeName ?? '',
                branch: res.branch ?? `ac/archive-${res.changeName ?? t.openspecChangeName}`,
                prUrl: res.pendingPrUrl,
                number: res.pendingPrNumber ?? null,
              });
            } catch (e) { log.warn({ err: e, ticketId: t.id }, 'raising the archive backfill card failed'); }
          }
        }
      } catch (e) {
        const action = `openspec archive failed: ${e instanceof Error ? e.message : String(e)}`;
        tx(db, () => {
          touch(t.id, { unblockJson: { owner: 'weaver', action } });
          systemComment(t.id, action, actor);
          recordActivity(db, ws, actor, 'ticket.merge_archive_failed', 'ticket', t.id, { error: action }, t.id);
          ctx.events.emit('ticket.updated', 'ticket', t.id, get(t.id));
        });
        wake(conductorId(), 'system', `openspec archive failed for ${t.identifier}`, { ticketId: t.id, error: action });
        // VS-298: a refusal openspec itself explained (e.g. `openspec_archive_blocked`) carries a
        // code and details worth keeping — flattening every archive failure to `internal` here is
        // what threw that reason away for the agent that has to act on it.
        throw e instanceof OcError ? new OcError(e.code, action, { ...(e.details ?? {}), ticketId: t.id }) : new OcError('internal', action, { ticketId: t.id });
      }

      const next = tx(db, () => {
        const recordedSha = trustedMerge ?? info.mergeCommit ?? null;
        if (recordedSha) {
          db.insert('ticket_work_products', {
            id: newId(), ticketId: t.id, runId: actor.runId ?? null, type: 'commit', provider: 'git', externalId: recordedSha,
            url: null, title: `merge ${recordedSha.slice(0, 12)}`, state: 'merged', isPrimary: false,
            metadataJson: { method: info.method ?? null }, createdAt: nowIso(), updatedAt: nowIso(),
          });
        }
        const delivery = { ...(t.delivery ?? {}), merged: true, mergeCommit: recordedSha ?? landInfo?.head ?? null, method: info.method ?? landInfo?.mode ?? null, archivedAs, landed: landInfo?.detail ?? null };
        const updated = touch(t.id, { status: 'done', completedAt: nowIso(), deliveryJson: delivery, unblockJson: null, mergeQueuedAt: null, mergeStartedAt: null });
        recordActivity(db, ws, actor, 'ticket.merged', 'ticket', t.id, { mergeCommit: recordedSha, archivedAs, skipped }, t.id);
        ctx.events.emit('ticket.merged', 'ticket', t.id, { ticketId: t.id, mergeCommit: recordedSha, archivedAs, skipped });
        ctx.events.emit('ticket.status', 'ticket', t.id, updated);
        return updated;
      });
      propagateTerminal(next, actor);
      // The slot this ticket held is free: the next ticket in the project's queue merges now (§11.4).
      await mergeQueue.pump(t.projectId);
      if (t.projectId) { const pid = t.projectId; schedule(100, 'spec reindex after merge', () => deps().specs.index(pid)); }
      log.info({ ticketId: t.id, archivedAs, skipped }, 'ticket merged');
      return next;
    },

    async autoMergeSweep(): Promise<number> {
      // Two kinds of ticket advance without a human: one carrying `auto_merge`, which never had a
      // merge decision raised for it, and one under YOLO mode, whose decision is open and waiting.
      const rows = db.all<Record<string, unknown>>("SELECT * FROM tickets WHERE workspace_id = ? AND status = 'in_review'", [ws])
        .map((r) => ticketRow(r) as unknown as Ticket)
        .filter((t) => t.autoMerge || yolo(t));
      let advanced = 0;
      for (const t of rows) {
        // VS-472: the pull request head this pass is waiting on, so an unchanged hold can be told
        // apart from one the worker pushed anew. Resolved in the CI check, or from the delivery head.
        let prHead: string | null = null;
        try {
          const project = t.projectId ? deps().projects.get(t.projectId) : null;
          const policies = (project?.policies ?? {}) as { deliveryMode?: string; requireCi?: boolean };
          const mode = policies.deliveryMode ?? ctx.config.defaults.deliveryMode;
          if (mode === 'pr' && policies.requireCi !== false && project) {
            const pr = db.get<{ url: string | null }>("SELECT url FROM ticket_work_products WHERE ticket_id = ? AND type = 'pull_request' ORDER BY created_at DESC LIMIT 1", [t.id]);
            const forge = ctx.registries.forges.get('github');
            if (pr?.url && forge) {
              const state = await forge.prState(project.clonePath, pr.url).catch(() => null);
              if (!state) continue;
              prHead = state.headSha ?? null;
              if (state.ciState === 'pending') continue;
              if (state.ciState === 'failure') { recordAutoMergeHold(t, 'auto-merge is waiting: CI is red on the PR', prHead); continue; }
            }
          }
          // The work is ready to land. A YOLO ticket has a real merge decision waiting: answer it,
          // and `applyMergeApproval` puts the ticket into `merging` through the same door a human
          // approval opens. An `auto_merge` ticket has none, so it transitions directly as before.
          const pending = openApproval(t.id, 'merge_approval');
          if (pending) await autoApprove(t, pending);
          else await service.transition({ kind: 'system', id: null }, t.id, { to: 'merging', note: 'auto-merge: no approval required for this ticket' });
          // The hold is gone: a ticket that comes back held for the same reason comments again.
          clearAutoMergeHold(t);
          advanced++;
        } catch (e) {
          // VS-266: a YOLO ticket's merge approval can be held by a weaver concern exactly like a
          // human-owned one — surfaced on the ticket the same way the CI-red wait is, rather than
          // only a log line, so the human sees why auto-merge stalled here.
          if (e instanceof OcError && e.code === 'revision_pending') {
            // VS-474: the daemon's own grant is now held in three cases — an unreviewed card, a card
            // whose reviewed head has moved, and a weaver concern. Name the one that applies.
            const details = (e.details ?? {}) as { weaverReviewStatus?: string; weaverReviewHeadMismatch?: boolean };
            const reason = details.weaverReviewHeadMismatch
              ? 'auto-merge is waiting: the weaver has not reviewed the current head yet'
              : details.weaverReviewStatus === 'concerns'
                ? 'auto-merge is waiting: the weaver has concerns'
                : 'auto-merge is waiting: the weaver has not reviewed it yet';
            recordAutoMergeHold(t, reason, prHead ?? await resolveDeliveryHead(t));
            continue;
          }
          log.warn({ ticket: t.identifier, err: String(e) }, 'auto-merge advance failed');
        }
      }
      return advanced;
    },

    /**
     * VS-389: land an archive-backfill pull request a merge card approved, under the project's
     * one-landing-at-a-time lock, reusing the ticket flow's archive-then-merge machinery. The ticket
     * is already `done`, so nothing here transitions it. Never throws: a deferred landing is
     * recorded and retried by the reconciliation sweep.
     */
    async landArchiveBackfill(actor, input) {
      const t = get(input.ticketId);
      const fail = (reason: string, quiet = false): { landed: false; reason: string } => {
        recordArchiveLandingFailure(t, input.changeName, input.prUrl, reason, actor, quiet);
        return { landed: false, reason };
      };
      const project = t.projectId ? deps().projects.get(t.projectId) : null;
      if (!project || !existsSync(project.clonePath)) return fail('no project clone');
      const forge = ctx.registries.forges.get('github');
      if (!forge?.mergePr) return fail('no forge available to merge');
      // A retry after the pull request already merged, or was closed, must not try to merge it again.
      const state = await forge.prState(project.clonePath, input.prUrl).catch(() => null);
      if (state?.state === 'closed') return { landed: false, closed: true, reason: 'the archive pull request is closed, not merged' };
      if (state?.state !== 'merged') {
        const landing = landingBranchOf(project, t);
        const method = String((project.policies as { mergeMethod?: string } | null)?.mergeMethod ?? 'squash');
        let outcome: Awaited<ReturnType<typeof attemptArchiveThenMerge>>;
        try {
          outcome = await serialize(project.id, () => attemptArchiveThenMerge({
            clonePath: project.clonePath, branch: input.branch, landingBranch: landing, changeName: input.changeName, forge, prUrl: input.prUrl, method,
            rebuildArchiveOnConflict: true,
            scratch: { stateDir: ctx.paths.state, projectSlug: project.slug, label: t.identifier },
          }));
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
        if (outcome.kind === 'conflict') return fail(`rebase conflict: ${outcome.detail}`);
        if (outcome.kind === 'rebuild_failed') return fail(outcome.detail);
        // Pending checks are expected to resolve; waiting is not a failure worth a comment or a wake.
        if (outcome.kind === 'checks_pending') return fail('required checks are pending', true);
        if (outcome.kind === 'checks_failed') return fail('required checks failed');
      }
      tx(db, () => {
        const delivery = { ...(t.delivery ?? {}), openspecArchive: { changeName: input.changeName, branch: input.branch, state: 'landed' as const, prUrl: input.prUrl } };
        touch(t.id, { deliveryJson: delivery });
        systemComment(t.id, `spec archive for ${input.changeName} merged`, actor);
        recordActivity(db, ws, actor, 'openspec.archived', 'ticket', t.id, { changeName: input.changeName, prUrl: input.prUrl }, t.id);
        ctx.events.emit('ticket.updated', 'ticket', t.id, get(t.id));
      });
      return { landed: true };
    },

    /**
     * VS-389: raise the one open merge approval for a finished ticket's archive-backfill pull
     * request. A pull request a `changes` answer declined is not re-raised; under YOLO the daemon
     * answers the card itself, exactly as it does for a ticket merge.
     */
    async raiseArchiveBackfillCard(actor, ticketId, a) {
      const t = get(ticketId);
      const correlationKey = `merge_approval:archive:${t.id}:${a.changeName}`;
      const open = db.get<{ id: string }>(
        "SELECT id FROM decisions WHERE workspace_id = ? AND ticket_id = ? AND correlation_key = ? AND status = 'open'",
        [ws, t.id, correlationKey],
      );
      if (open) return { raised: false };
      const existing = ((t.delivery ?? {}) as Record<string, unknown>)['openspecArchive'] as Record<string, unknown> | undefined;
      if (existing?.['declinedPrUrl'] === a.prUrl) return { raised: false };
      const d = deps().decisions.create(actor, {
        ticketId: t.id, kind: 'merge_approval', owner: 'human',
        title: `Approve the spec archive for ${t.identifier}`,
        context: `The OpenSpec change ${a.changeName} was left behind when ${t.identifier} merged. This pull request archives it: ${a.prUrl}`,
        options: [
          { key: NAMED_CARD_OPTION_KEYS.merge_approval.approve, label: 'Approve merge', recommended: true },
          { key: NAMED_CARD_OPTION_KEYS.merge_approval.changes, label: 'Request changes', description: 'Leave the archive pull request open.' },
        ],
        allowFreeText: true,
        correlationKey,
        target: { archive: { changeName: a.changeName, branch: a.branch, prUrl: a.prUrl, number: a.number ?? null } },
        attachToTerminal: true,
      });
      // VS-474: the archive card is left open and unseen; under YOLO it is granted only after the
      // weaver marks it looked at, through `onReviewLooked`.
      return { raised: true, decisionId: d.id };
    },

    /** VS-389: record that a human declined an archive-backfill merge; the pull request stays open. */
    declineArchiveBackfill(actor, input) {
      const t = get(input.ticketId);
      tx(db, () => {
        const delivery = (t.delivery ?? {}) as Record<string, unknown>;
        const existing = (delivery['openspecArchive'] ?? {}) as Record<string, unknown>;
        const next = {
          ...delivery,
          openspecArchive: { ...existing, changeName: input.changeName, branch: input.branch, state: 'pending' as const, pendingPrUrl: input.prUrl, declinedPrUrl: input.prUrl },
        };
        touch(t.id, { deliveryJson: next });
        systemComment(t.id, `spec archive merge declined${input.text ? `: ${input.text}` : ''}; the pull request stays open.`, actor);
        recordActivity(db, ws, actor, 'openspec.archive_declined', 'ticket', t.id, { changeName: input.changeName, prUrl: input.prUrl }, t.id);
        ctx.events.emit('ticket.updated', 'ticket', t.id, get(t.id));
      });
    },

    mergeQueue,

    livenessViolations() {
      const candidates = db
        .all<Record<string, unknown>>(
          `SELECT * FROM tickets WHERE workspace_id = ? AND status IN (${LIVENESS_STATUSES.map(() => '?').join(',')})`,
          [ws, ...LIVENESS_STATUSES],
        )
        .map(row);
      return candidates.filter((t) => {
        if (t.assigneeHuman) return false;
        // An interactive session that ends in conversation is complete success, not unfinished work (VS-213).
        if (t.interactiveSession) return false;
        if (hasOpenDecision(t.id)) return false;
        if (t.monitorNextCheckAt) return false;
        // Waiting in the merge queue is an action path: the queue wakes it when a slot frees (§11.4).
        if (t.status === 'merging' && !t.mergeStartedAt) return false;
        const worker = db.get<{ id: string; status: string }>(
          "SELECT id, status FROM agents WHERE ticket_id = ? AND kind = 'worker' AND status NOT IN ('retired','done') ORDER BY created_at DESC LIMIT 1",
          [t.id],
        );
        if (!worker) return !t.assigneeRoleId; // no role at all ⇒ nothing will ever spawn; a role means a pending spawn
        const liveRun = db.get<{ n: number }>("SELECT COUNT(*) n FROM runs WHERE agent_id = ? AND status IN ('queued','running')", [worker.id])?.n ?? 0;
        const queuedWake = db.get<{ n: number }>("SELECT COUNT(*) n FROM wakeups WHERE agent_id = ? AND status IN ('queued','claimed')", [worker.id])?.n ?? 0;
        return liveRun === 0 && queuedWake === 0;
      });
    },

    /**
     * A `proposed` change ticket or an `in_review` ticket without `auto_merge` is supposed to have
     * an open decision — that decision is its action path, which is why `livenessViolations` leaves
     * those tickets alone. Whatever closed the decision without moving the ticket on (VS-104: an
     * overloaded document key) raises a fresh one here. An operational ticket is repaired only when
     * the current `action` revision has no `open` or `answered` `action_approval` targeting it:
     * answering leaves the ticket `in_progress` (VS-216), so this branch cannot terminate by status
     * the way plan and merge do. An operational repair is never YOLO-answered.
     */
    async repairApprovals() {
      const SYSTEM: Actor = { kind: 'system', id: null };
      const repaired: Array<{ id: string; identifier: string; kind: 'plan_approval' | 'merge_approval' | 'action_approval' }> = [];

      const proposed = db
        .all<Record<string, unknown>>("SELECT * FROM tickets WHERE workspace_id = ? AND status = 'proposed' AND kind = 'change'", [ws])
        .map(row);
      for (const t of proposed) {
        if (openApproval(t.id, 'plan_approval')) continue;
        const owner = approvalOwner(t);
        if (owner === 'none') {
          await transition(SYSTEM, t.id, { to: 'approved', note: 'plan auto-approved by policy (repaired: no approval was open)' });
          repaired.push({ id: t.id, identifier: t.identifier, kind: 'plan_approval' });
          continue;
        }
        raisePlanApproval(SYSTEM, t, { context: `${planApprovalContext(t)} (Re-raised: the previous approval was lost.)` });
        // VS-474: under YOLO the repaired card is left open and unseen; it is granted only once the
        // weaver marks it looked at, never here at raise time.
        repaired.push({ id: t.id, identifier: t.identifier, kind: 'plan_approval' });
      }

      const inReview = db
        .all<Record<string, unknown>>("SELECT * FROM tickets WHERE workspace_id = ? AND status = 'in_review'", [ws])
        .map(row)
        .filter((t) => !t.autoMerge);
      for (const t of inReview) {
        if (openApproval(t.id, 'merge_approval')) continue;
        const wp = db.get<{ url: string | null }>("SELECT url FROM ticket_work_products WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1", [t.id]);
        deps().decisions.create(SYSTEM, {
          ticketId: t.id, kind: 'merge_approval', owner: 'human',
          title: `Approve the merge for ${t.identifier}: ${t.title}`,
          context: `${wp?.url ? `Work product: ${wp.url}` : 'The worker delivered its work product.'} (Re-raised: the previous approval was lost.)`,
          options: [
            { key: NAMED_CARD_OPTION_KEYS.merge_approval.approve, label: 'Approve merge', recommended: true },
            { key: NAMED_CARD_OPTION_KEYS.merge_approval.changes, label: 'Request changes', description: 'Send it back to the worker.' },
          ],
          allowFreeText: true,
          correlationKey: `merge_approval:${t.id}`,
          askedByAgentId: t.workerId,
          askedInRunId: null,
        });
        // Not auto-answered here even under YOLO: `autoMergeSweep` already answers a pending
        // merge_approval on a YOLO ticket every tick, so it picks this one up on its own next pass.
        repaired.push({ id: t.id, identifier: t.identifier, kind: 'merge_approval' });
      }

      // Plan/merge terminate because answering changes ticket status. Operational cannot.
      const operational = db
        .all<Record<string, unknown>>("SELECT * FROM tickets WHERE workspace_id = ? AND kind = 'operational' AND status NOT IN ('done','cancelled')", [ws])
        .map(row);
      for (const t of operational) {
        if (openApproval(t.id, 'action_approval')) continue;
        const doc = db.get<{ id: string; currentRevision: number }>('SELECT id, current_revision FROM ticket_documents WHERE ticket_id = ? AND key = ?', [t.id, 'action']);
        if (!doc) continue;
        if (actionApprovalCoversRevision(t.id, doc.id, doc.currentRevision)) continue;
        raiseActionApproval(SYSTEM, t, doc, true);
        repaired.push({ id: t.id, identifier: t.identifier, kind: 'action_approval' });
      }

      return repaired;
    },

    /**
     * VS-364: a worker can revise the plan while the ticket stays `proposed` — answering weaver
     * concerns or steering, neither of which moves the ticket — and until this ran, nothing published
     * the new artifacts, so the card kept the old revision and a held approval had no revision to lift
     * on. Called at the end of a worker's turn: re-render the plan from the worker's worktree, and when
     * it differs from the stored document, publish it and raise a fresh approval exactly as the
     * `proposing → proposed` transition does — the write supersedes the open card. Invalid artifacts
     * publish nothing and surface their issues; an unchanged plan is a no-op. Never throws: a
     * republish failure must not fail the finished run.
     */
    async republishRevisedPlan(actor: Actor, ticketId: string) {
      const t = get(ticketId);
      if (t.status !== 'proposed' || t.kind !== 'change' || !t.openspecChangeName) {
        return { republished: false, reason: 'not proposed' } as const;
      }
      try {
        const res = await deps().openspec.validateForProposed(t.id);
        if (!res.ok) {
          systemComment(t.id, `the plan was revised but does not validate, so it was not republished:\n${res.issues.map((i) => `- ${i.message}`).join('\n')}`, actor);
          wake(conductorId(), 'system', `${t.identifier}: a revised plan failed validation and was not republished`, { ticketId: t.id });
          return { republished: false, reason: 'validation failed' } as const;
        }
        const current = db.get<{ body: string }>(
          `SELECT r.body FROM ticket_documents d JOIN ticket_document_revisions r ON r.document_id = d.id AND r.revision = d.current_revision
            WHERE d.ticket_id = ? AND d.key = 'plan'`,
          [t.id],
        );
        if (current?.body === res.plan) return { republished: false, reason: 'unchanged' } as const;
        // `validateForProposed` shells out and takes seconds; the human can approve the still-open card
        // during that await, moving the ticket to `approved` (or beyond). Re-read the status *inside*
        // the write transaction, so a republish can never land a new plan revision or a fresh card on a
        // ticket that has moved on — which would also re-run YOLO's auto-approval a second time.
        const written = tx(db, () => {
          const still = db.get<{ status: string }>('SELECT status FROM tickets WHERE id = ?', [t.id])?.status;
          if (still !== 'proposed') return null;
          const w = putDocument(actor, t.id, 'plan', res.plan, { system: true });
          recordActivity(db, ws, actor, 'ticket.plan_republished', 'ticket', t.id, { revision: w.revision }, t.id);
          return w;
        });
        if (!written) return { republished: false, reason: 'no longer proposed' } as const;
        // VS-474: the fresh card is raised and left open and unseen; under YOLO it is granted only
        // after the weaver marks it looked at, through `onReviewLooked`.
        raisePlanApproval(actor, t, {
          context: `${planApprovalContext(t)} The worker revised the plan while the ticket was still proposed; this is revision ${written.revision}.`,
        });
        systemComment(t.id, `a revised plan was published as revision ${written.revision}; the previous approval is superseded and a fresh one is open.`, actor);
        return { republished: true, reason: 'republished' } as const;
      } catch (e) {
        log.warn({ err: e, ticketId: t.id }, 'republishing a revised plan failed');
        return { republished: false, reason: `failed: ${String(e)}` } as const;
      }
    },

    nextIdentifier() {
      return `${prefix()}-${allocateNumber()}`;
    },

    async stop() {
      for (const timer of pendingTimers) clearTimeout(timer);
      pendingTimers.clear();
      // Every tracked promise already absorbs its own failure, but allSettled keeps `stop` a promise
      // that resolves however the work ended — a caller draining before shutdown has nothing to catch.
      await Promise.allSettled([...inFlight]);
    },
  };

  return service;
}
