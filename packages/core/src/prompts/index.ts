import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { landingBranchOf, yoloEnabled } from '@agent-conductor/shared';
import type * as S from '@agent-conductor/shared';
import type { WorkspaceContext } from '../context.js';
import type { CoreServices } from '../api.js';
import { renderTemplate } from './template.js';
import { BRIEF_TMPL, CHARTER_TMPL, CONDUCTOR_TMPL, WORKER_TMPL } from './defaults.js';
import { worktreeState } from '../util/git.js';

export { renderTemplate, truthy } from './template.js';

/** How the agents address the human (PLAN §23 #9). */
export function humanName(ctx: WorkspaceContext): string {
  return ctx.config.conductor?.humanName ?? 'captain';
}

export function loadTemplate(ctx: WorkspaceContext, name: string, fallback: string): string {
  try {
    const p = join(ctx.templatesDir, name);
    if (existsSync(p)) return readFileSync(p, 'utf8');
  } catch { /* fall through to the built-in */ }
  return fallback;
}

// ---------- data gathering ----------

function role(ctx: WorkspaceContext, id: string | null): S.Role | null {
  if (!id) return null;
  return ctx.db.get<S.Role>('SELECT * FROM roles WHERE id = ?', [id]) ?? null;
}
function project(ctx: WorkspaceContext, id: string | null): S.Project | null {
  if (!id) return null;
  return ctx.db.get<S.Project>('SELECT * FROM projects WHERE id = ?', [id]) ?? null;
}
function ticket(ctx: WorkspaceContext, id: string | null): S.Ticket | null {
  if (!id) return null;
  return ctx.db.get<S.Ticket>('SELECT * FROM tickets WHERE id = ?', [id]) ?? null;
}

/**
 * The project fields a rendered prompt can state without inventing data: the row's default branch,
 * and the delivery mode and merge method its policies resolve to. Shared by `workerData` and
 * `renderCharter` so the charter header and the brief cannot resolve the same policies differently.
 */
function projectHeaders(ctx: WorkspaceContext, p: S.Project | null | undefined): { defaultBranch: string; deliveryMode: string; mergeMethod: string } {
  const policies = (p?.policies ?? {}) as Record<string, unknown>;
  return {
    defaultBranch: p?.defaultBranch ?? 'main',
    deliveryMode: String(policies.deliveryMode ?? ctx.config.defaults.deliveryMode ?? 'pr'),
    mergeMethod: String(policies.mergeMethod ?? 'squash'),
  };
}

/** Bullets under an "Acceptance criteria" heading in the ticket description, if any. */
export function parseAcceptance(description: string): string[] {
  const lines = description.split('\n');
  const out: string[] = [];
  let inside = false;
  for (const l of lines) {
    if (/^#{1,6}\s*acceptance|^\*\*acceptance/i.test(l.trim())) { inside = true; continue; }
    if (inside) {
      if (/^#{1,6}\s/.test(l.trim()) || /^\*\*[A-Z]/.test(l.trim())) break;
      const m = l.trim().match(/^[-*]\s+(.*)$/);
      if (m) out.push(m[1]!.trim());
    }
  }
  return out;
}

export function definitionOfDone(kind: S.TicketKind, deliveryMode: string): string {
  if (kind === 'change') {
    return deliveryMode === 'pr'
      ? 'planning artifacts complete and validated → `proposed`; after approval implement every task, commit as you go, open a PR and record it → `in_review`; after the merge approval, sync, resolve conflicts, merge and call `ac_ticket_merge_done`.'
      : 'planning artifacts complete and validated → `proposed`; after approval implement every task and commit → `in_review` with a branch work product; after approval merge into the default branch and call `ac_ticket_merge_done`.';
  }
  if (kind === 'task') return deliveryMode === 'pr'
    ? 'choose the ending that matches what you produced: with a diff to land, commit, open a PR and record it as a work product → `in_review`, then merge when the ticket reaches `merging`; with nothing that needs landing, state the ending and why in the transition note → `done` (no PR, no merge approval — and `done` is refused while commits are unlanded).'
    : 'choose the ending that matches what you produced: with a diff to land, commit on the ticket branch → `in_review` with a branch work product, then merge when the ticket reaches `merging`; with nothing that needs landing, state the ending and why in the transition note → `done` (no PR — and `done` is refused while commits are unlanded).';
  if (kind === 'scout') return 'write the findings as a `report` document (`ac_ticket_document_put`): what you did, what you found, evidence with file:line, recommendation. No code changes, no PR → `done`.';
  if (kind === 'operational') return 'write the action as an `action` document (`ac_ticket_document_put`) stating the concrete commands, host or service, and expected outcome; wait for the human to approve (`action_approval` — YOLO does not grant it); then execute, write a `report` of what actually happened (including if it differed), and update the knowledge base where applicable. A later `approve` of an `action` revision that already has a `report` is not a second authorisation to run. Repo docs are a follow-up `change` ticket. No PR → `done` (`done` is refused while commits are unlanded).';
  return 'answer on the ticket with `ac_ticket_comment`, then transition to `done`.';
}

function knowledgeText(deps: () => CoreServices, scope: S.KnowledgeScope, projectId?: string | null): string {
  try { return deps().knowledge.get(scope, projectId ?? null).body ?? ''; } catch { return ''; }
}

export interface WorkerTemplateData extends Record<string, unknown> {
  workspace: { name: string; id: string };
  human: { name: string };
  worker: { name: string; id: string; homePath: string };
  role: Record<string, unknown>;
  project: Record<string, unknown>;
  ticket: Record<string, unknown>;
  worktree: { path: string; branch: string; hasAgentsFile: boolean; hasOpenspecConfig: boolean; verifiedFreshAt: string | null };
  brief: { definitionOfDone: string; relaunchNote: string | null; noWorktree: boolean };
  knowledge: { shared: string; project: string };
}

export function workerData(ctx: WorkspaceContext, deps: () => CoreServices, agent: S.Agent, opts: { relaunchNote?: string | null } = {}): WorkerTemplateData {
  const r = role(ctx, agent.roleId);
  const p = project(ctx, agent.projectId);
  const t = ticket(ctx, agent.ticketId);
  const policies = (p?.policies ?? {}) as Record<string, unknown>;
  const deliveryMode = String(policies.deliveryMode ?? ctx.config.defaults.deliveryMode ?? 'pr');
  return {
    workspace: { name: ctx.config.name, id: ctx.config.id },
    human: { name: humanName(ctx) },
    worker: { name: agent.name, id: agent.id, homePath: agent.homePath },
    role: {
      id: r?.id ?? '', name: r?.name ?? 'Worker', charterSummary: r?.charterSummary ?? '', scope: r?.scopeText ?? '',
      responsibilities: r?.responsibilities ?? [], capabilities: r?.capabilities ?? [], rules: r?.rules ?? [],
      exclusions: (r as unknown as { exclusions?: string[] })?.exclusions ?? [], notes: (r as unknown as { notes?: string })?.notes ?? '',
    },
    project: {
      id: p?.slug ?? '', name: p?.name ?? '', ...projectHeaders(ctx, p), landingBranch: p ? landingBranchOf(p, t) : 'main',
      rules: r?.rules ?? [], openspec: p?.openspecEnabled ?? false,
      yolo: yoloEnabled(policies, ctx.config.defaults.yolo),
    },
    ticket: {
      identifier: t?.identifier ?? '', title: t?.title ?? '', description: t?.description ?? '', kind: t?.kind ?? 'task',
      priority: t?.priority ?? 'medium', status: t?.status ?? 'todo', acceptance: t ? parseAcceptance(t.description) : [],
      openspecChange: t?.openspecChangeName ?? null, links: t?.parentId ? `parent ${t.parentId}` : '',
      interactiveSession: Boolean(t?.interactiveSession),
    },
    worktree: {
      // A curation ticket has no worktree of its own (VS-256): its `work/` is the project's primary
      // clone, verified current for this turn by the engine's freshness gate before the brief is
      // ever rendered — the real absolute path, never the unbacked literal string `work/`.
      path: agent.worktreePath ?? (t?.originKind === 'curation' && p ? p.clonePath : 'work/'),
      branch: agent.branch ?? '',
      // The brief must never claim a project-repo file exists that the daemon has not actually
      // checked for (VS-211) — many projects have no AGENTS.md or OpenSpec config of their own.
      hasAgentsFile: Boolean(agent.worktreePath && existsSync(join(agent.worktreePath, 'AGENTS.md'))),
      hasOpenspecConfig: Boolean(agent.worktreePath && existsSync(join(agent.worktreePath, 'openspec', 'config.yaml'))),
      verifiedFreshAt: t?.originKind === 'curation' ? (p?.lastFetchedAt ?? null) : null,
    },
    brief: { definitionOfDone: definitionOfDone((t?.kind ?? 'task') as S.TicketKind, deliveryMode), relaunchNote: opts.relaunchNote ?? null, noWorktree: !agent.worktreePath },
    knowledge: { shared: knowledgeText(deps, 'shared'), project: agent.projectId ? knowledgeText(deps, 'project', agent.projectId) : '' },
  };
}

// ---------- renderers ----------

export function renderCharter(ctx: WorkspaceContext, spec: S.RoleSpec): string {
  const tmpl = loadTemplate(ctx, 'charter.md.tmpl', CHARTER_TMPL);
  const p = ctx.db.get<S.Project>('SELECT * FROM projects WHERE workspace_id = ? AND slug = ?', [ctx.workspaceId, spec.project]);
  return renderTemplate(tmpl, {
    workspace: { name: ctx.config.name, id: ctx.config.id },
    human: { name: humanName(ctx) },
    role: {
      id: spec.id, name: spec.name, charterSummary: spec.charterSummary, scope: spec.scope,
      responsibilities: spec.responsibilities, capabilities: spec.capabilities, exclusions: spec.exclusions,
      rules: spec.rules, notes: spec.notes ?? '',
    },
    project: { id: spec.project, ...projectHeaders(ctx, p) },
  });
}

export function renderBrief(ctx: WorkspaceContext, deps: () => CoreServices, agent: S.Agent, opts: { relaunchNote?: string | null } = {}): string {
  const tmpl = loadTemplate(ctx, 'brief.md.tmpl', BRIEF_TMPL);
  return renderTemplate(tmpl, workerData(ctx, deps, agent, opts));
}

/** Worker AGENTS.md = role charter + ticket brief. */
export function renderWorkerInstructions(ctx: WorkspaceContext, deps: () => CoreServices, agent: S.Agent, opts: { charter?: string; relaunchNote?: string | null } = {}): string {
  const data = workerData(ctx, deps, agent, opts);
  let charter = opts.charter ?? '';
  if (!charter && agent.roleId) {
    try { charter = deps().roles.charter(agent.roleId); } catch { charter = ''; }
  }
  const tmpl = loadTemplate(ctx, 'worker.AGENTS.md.tmpl', WORKER_TMPL);
  // The shipped template renders charter and brief inline from the same data; the built-in fallback uses
  // {{charter}} / {{briefText}} slots, so both are supplied.
  return renderTemplate(tmpl, { ...data, charter, briefText: renderBrief(ctx, deps, agent, opts) } as Record<string, unknown>);
}

export function renderConductorInstructions(ctx: WorkspaceContext, deps: () => CoreServices): string {
  const tmpl = loadTemplate(ctx, 'conductor.AGENTS.md.tmpl', CONDUCTOR_TMPL);
  const projects = ctx.db.all<S.Project>('SELECT * FROM projects WHERE workspace_id = ? AND status != ?', [ctx.workspaceId, 'archived']);
  const roles = ctx.db.all<S.Role>('SELECT * FROM roles WHERE workspace_id = ? AND status != ?', [ctx.workspaceId, 'retired']);
  const workers = ctx.db.all<S.Agent>("SELECT * FROM agents WHERE workspace_id = ? AND kind = 'worker' AND status NOT IN ('retired','done')", [ctx.workspaceId]);
  const projectLines = projects.length
    ? projects.map((p) => `- \`${p.slug}\` — ${p.name}${p.defaultBranch ? ` (default branch \`${p.defaultBranch}\`)` : ''}`).join('\n')
    : '- (none yet)';
  const roleLines = roles.length
    ? roles.map((r) => {
        const live = workers.filter((w) => w.roleId === r.id).length;
        return `- **${r.name}** [${r.status}] in \`${projects.find((p) => p.id === r.projectId)?.slug ?? '?'}\` — ${r.charterSummary} (${live}/${r.maxWorkers} workers live)`;
      }).join('\n')
    : '- (none hired yet)';
  return renderTemplate(tmpl, {
    workspace: { name: ctx.config.name, id: ctx.config.id, ticketPrefix: ctx.config.ticketPrefix },
    human: { name: humanName(ctx) },
    projects: projectLines,
    roles: roleLines,
    agents: roleLines,
    policies: ctx.config.defaults,
    deps: undefined,
  });
}

// ---------- turn prompt (PLAN §9.3) ----------

export interface TurnPromptOptions {
  isFirstTurn?: boolean;
  sessionStale?: boolean;
  briefUpdated?: boolean;
  charterChanged?: string | null;
  /** Whether `ensureHomeCurrent` re-rendered AGENTS.md this turn (VS-244): tells the worker
   * bootstrap-digest exclusion below whether the brief it excuses is actually current. */
  homeRerendered?: boolean;
  relaunchNote?: string | null;
  interrupted?: boolean;
  turnEpoch?: number;
  /** The run this prompt is being built for (VS-110): lets the bootstrap digest record its knowledge context against the right run. */
  runId?: string;
}

interface BundledWake { source: string; reason: string; payload: Record<string, unknown>; requestedByKind: string; requestedById: string | null }

export function flattenWakes(wakes: S.Wakeup[]): BundledWake[] {
  const out: BundledWake[] = [];
  for (const w of wakes) {
    out.push({
      source: w.source, reason: w.reason, payload: (w.payload ?? {}) as Record<string, unknown>,
      requestedByKind: w.requestedByKind ?? 'system', requestedById: w.requestedById ?? null,
    });
    const bundle = (w.payload as { bundle?: Array<{ source?: string; reason?: string; payload?: Record<string, unknown>; requestedByKind?: string; requestedById?: string | null }> } | null)?.bundle;
    if (Array.isArray(bundle)) for (const b of bundle) {
      out.push({
        source: String(b.source ?? 'system'), reason: String(b.reason ?? ''), payload: (b.payload ?? {}) as Record<string, unknown>,
        requestedByKind: b.requestedByKind ?? 'system', requestedById: b.requestedById ?? null,
      });
    }
  }
  return out;
}

/**
 * What the merge queue means for this ticket's turn (PLAN §11.4): the admitted ticket is told it holds
 * the project's merge slot and that its base moved while it waited; a waiting one is told to sit still.
 */
export function mergeQueueLine(ctx: WorkspaceContext, t: S.Ticket, landingBranch: string): string | null {
  if (t.status !== 'merging') return null;
  if (t.mergeStartedAt) {
    return `- **You hold the merge slot for this project.** Only one ticket merges at a time, and it is now yours. Your base moved while you waited: sync \`work/\` with \`${landingBranch}\`, resolve the conflicts yourself, re-run the project's tests and lint, then merge and call \`ac_ticket_merge_done\`. The next ticket starts when you are done, so do not hold the slot longer than the merge needs.`;
  }
  if (!t.projectId) return null;
  const ahead = ctx.db.get<{ n: number }>(
    "SELECT COUNT(*) n FROM tickets WHERE project_id = ? AND status = 'merging' AND merge_started_at IS NULL AND (merge_queued_at < ? OR (merge_queued_at = ? AND number < ?))",
    [t.projectId, t.mergeQueuedAt, t.mergeQueuedAt, t.number],
  )?.n ?? 0;
  return `- Waiting in this project's merge queue at position ${ahead + 1}. Nothing to merge until the queue admits you; you will be woken then.`;
}

/**
 * How a worker reads in the conductor's open-work list. A worker parked after a failure is waiting
 * on the human, not stalled: say what stopped it and who owns the next move, so the conductor does
 * not answer a quota limit by relaunching into it (VS-56).
 */
function workerStatusLine(w: S.Agent): string {
  if (w.status !== 'paused' || !w.pauseDetail) return w.status;
  const d = w.pauseDetail;
  const why = [d.family ?? d.code, d.message ? d.message.slice(0, 120) : null].filter(Boolean).join(' — ');
  return `paused: ${why || 'a failure'}; the human owns the resume`;
}

function bounded<T>(items: T[], max: number, render: (t: T) => string, more: string): string {
  const head = items.slice(0, max).map(render);
  if (items.length > max) head.push(`- +${items.length - max} more, ${more}`);
  return head.length ? head.join('\n') : '- (none)';
}

export async function buildTurnPrompt(
  ctx: WorkspaceContext,
  deps: () => CoreServices,
  agent: S.Agent,
  wakes: S.Wakeup[],
  opts: TurnPromptOptions = {},
): Promise<string> {
  const now = new Date().toISOString();
  const epoch = opts.turnEpoch ?? agent.turnEpoch + 1;
  const parts: string[] = [];
  parts.push(`# Turn ${epoch} for ${agent.name} (${agent.kind}) — ${now}`);

  const flat = flattenWakes(wakes);
  parts.push('\n## Why you were woken');
  parts.push(bounded(flat, 12, (w) => `- ${w.source}: ${w.reason || '(no reason given)'}`, 'call `ac_inbox` for the rest'));

  let workerTicket: S.Ticket | null = null;
  if (agent.kind === 'worker' && agent.ticketId) {
    const t = ticket(ctx, agent.ticketId);
    workerTicket = t;
    const p = project(ctx, agent.projectId);
    if (t) {
      let wtLine = '';
      const landing = p ? landingBranchOf(p, t) : 'main';
      if (agent.worktreePath) {
        const st = await worktreeState(agent.worktreePath, landing);
        wtLine = st.exists
          ? ` — worktree \`work/\` on \`${st.branch ?? agent.branch}\` (${st.dirty ? `${st.changedFiles} uncommitted change(s)` : 'clean'}, ${st.ahead} ahead / ${st.behind} behind ${landing})`
          : ` — worktree missing at ${agent.worktreePath}: stop and report blocked`;
      }
      const lastStatus = ctx.db.get<{ body: string }>("SELECT body FROM ticket_comments WHERE ticket_id = ? AND kind = 'status' ORDER BY created_at DESC LIMIT 1", [t.id]);
      parts.push('\n## Your ticket');
      parts.push(`- ${t.identifier} [${t.status}] ${t.title}${wtLine}${lastStatus ? `; last status: ${lastStatus.body.slice(0, 160)}` : ''}`);
      if (t.openspecChangeName) parts.push(`- OpenSpec change: \`${t.openspecChangeName}\``);
      const queue = mergeQueueLine(ctx, t, landing);
      if (queue) parts.push(queue);
    }
  }

  if (agent.kind === 'conductor') {
    const open = ctx.db.all<S.Ticket>(
      "SELECT * FROM tickets WHERE workspace_id = ? AND status NOT IN ('done','cancelled') ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, updated_at DESC",
      [ctx.workspaceId],
    );
    const workers = ctx.db.all<S.Agent>("SELECT * FROM agents WHERE workspace_id = ? AND kind = 'worker' AND status NOT IN ('retired')", [ctx.workspaceId]);
    parts.push('\n## Open work');
    parts.push(bounded(open, 10, (t) => {
      const w = workers.find((x) => x.ticketId === t.id);
      return `- ${t.identifier} [${t.status}] ${t.title}${w ? ` — ${w.name} (${workerStatusLine(w)})` : ''}`;
    }, 'call `ac_ticket_list`'));
    const pending = ctx.db.all<S.Decision>("SELECT * FROM decisions WHERE workspace_id = ? AND status = 'open' ORDER BY created_at", [ctx.workspaceId]);
    if (pending.length) {
      parts.push('\n## Open decisions');
      parts.push(bounded(pending, 8, (d) => `- ${d.id} [${d.kind}, owner ${d.owner}] ${d.title}`, 'call `ac_briefing`'));
    }
  }

  const answered = ctx.db.all<S.Decision>(
    "SELECT * FROM decisions WHERE workspace_id = ? AND status = 'answered' AND asked_by_agent_id = ? AND answered_at > COALESCE((SELECT MAX(finished_at) FROM runs WHERE agent_id = ? AND status IN ('succeeded','failed','timed_out','interrupted','cancelled')), '') ORDER BY answered_at",
    [ctx.workspaceId, agent.id, agent.id],
  );
  if (answered.length) {
    parts.push('\n## Answered decisions');
    parts.push(bounded(answered, 8, (d) => `- ${d.id}${d.ticketId ? ` (${ticket(ctx, d.ticketId)?.identifier ?? d.ticketId})` : ''}: "${d.title}" — answered ${d.answerKey ?? ''}${d.answerText ? `: "${d.answerText}"` : ''}`, 'call `ac_inbox`'));
  }

  const notes: string[] = [];
  if (opts.briefUpdated) notes.push('- Your brief was updated since your last turn; re-read `AGENTS.md` in your home.');
  if (opts.charterChanged) notes.push(`- Your role's charter changed: ${opts.charterChanged}`);
  if (opts.relaunchNote) notes.push(`- Relaunch note: ${opts.relaunchNote}`);
  if (opts.interrupted) notes.push('- Your previous turn was interrupted; verify what you had already done before redoing it.');
  // VS-254: a human's live message on a runtime that cannot take mid-turn input interrupted the
  // previous turn instead of queuing behind it — the message itself is already the `live_interrupt`
  // wake's reason, above under "Why you were woken". Established by testing real interrupts against
  // scratch git repos (design.md): the process group unwinds cleanly, but a `git` command that fails
  // with "Unable to create '.../index.lock'" is a stale lock the interrupt left behind, not a real
  // conflict — `git status` alone will not show it.
  if (flat.some((w) => w.source === 'live_interrupt')) {
    notes.push(
      '- Your previous turn was interrupted to deliver the live message above; verify what you had already done before redoing it or acting on the message. If a `git` command now fails with "Unable to create \'.../index.lock\': File exists", that is a stale lock left by the interrupt — remove it and retry, it is not a real conflict.',
    );
  }
  if (opts.isFirstTurn || opts.sessionStale) {
    let digest = '';
    try {
      const d = deps().knowledge.bootstrapDigest(agent.id);
      digest = d.text;
      // Recording the knowledge context this run was bootstrapped with must never affect the
      // prompt itself (VS-110: it measures, it does not gate) — isolated in its own try so a
      // recording failure can never wipe out a digest that was already built successfully.
      try { if (opts.runId) deps().knowledgeUsage.recordBootstrap(opts.runId, agent.id, agent.ticketId ?? null, d.parts ?? []); } catch { /* measurement only */ }
    } catch { digest = ''; }
    // Workers already inline SHARED + PROJECT in AGENTS.md, so pasting the digest too would double
    // the bill (VS-161) — but only when that inline copy is actually current. A stale session whose
    // home was NOT re-rendered this turn has no other way to see knowledge that moved on since its
    // AGENTS.md was last written, so the exclusion holds only when the home render is fresh (VS-244).
    const workerNeedsDigest = agent.kind === 'worker' && Boolean(opts.sessionStale) && !opts.homeRerendered;
    if (digest && (agent.kind !== 'worker' || workerNeedsDigest)) notes.push(`- Bootstrap:\n\n${digest}`);
  }
  if (notes.length) { parts.push('\n## Notes'); parts.push(notes.join('\n')); }

  parts.push('\n## What to do now');
  parts.push(whatToDoNow(agent, workerTicket));
  return parts.join('\n') + '\n';
}

const CONDUCTOR_NOW = 'Call `ac_inbox` if you need details. Handle human messages first, then ticket events. Reply to the human only through `ac_human_send`. Finish with the structured final report.';
const WORKER_DELIVERY_NOW = 'Call `ac_inbox` if you need details, do the phase your ticket status asks for, leave durable progress on the ticket, and finish with the structured final report. Ask with `ac_ask` instead of guessing; report `blocked` with a routable path if you are stuck.';
const INTERACTIVE_FIRST_TURN_NOW = 'This is an interactive session: a human is about to work with you directly on this ticket. Read the ticket and its existing context, then post exactly one `ac_ticket_comment` stating what you understand the ticket to be and what you are ready to do. Do not edit anything, run anything, transition the ticket, or take any other action this turn — only the tools needed to read and to post that one comment are available to you right now. Stop after posting it and wait for the human\'s first message; the tools you need for the rest return on your next turn.';
const INTERACTIVE_CONVERSATION_NOW = 'This is an interactive session: a conversation with the human on this ticket. Answer, investigate, read and explain. Do not write code, transition the ticket toward delivery, or create a plan or merge approval unless the human asked for changes in this conversation. If you think a change is warranted and they have not asked, say so in the conversation and wait — do not start planning while you ask. A conversation that ends with a good answer and nothing delivered is complete success; the ticket is a container, not a mandate. The ordinary plan-approval and merge-approval gates still apply if they ask you to make a change.';

function whatToDoNow(agent: S.Agent, workerTicket: S.Ticket | null): string {
  if (agent.kind === 'conductor') return CONDUCTOR_NOW;
  if (workerTicket && Boolean(workerTicket.interactiveSession)) {
    return agent.turnCount === 0 ? INTERACTIVE_FIRST_TURN_NOW : INTERACTIVE_CONVERSATION_NOW;
  }
  return WORKER_DELIVERY_NOW;
}
