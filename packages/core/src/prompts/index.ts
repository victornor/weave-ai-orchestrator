import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type * as S from '@openconductor/shared';
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
      ? 'planning artifacts complete and validated → `proposed`; after approval implement every task, commit as you go, open a PR and record it → `in_review`; after the merge approval, sync, resolve conflicts, merge and call `oc_ticket_merge_done`.'
      : 'planning artifacts complete and validated → `proposed`; after approval implement every task and commit → `in_review` with a branch work product; after approval merge into the default branch and call `oc_ticket_merge_done`.';
  }
  if (kind === 'task') return deliveryMode === 'pr'
    ? 'do the work, commit, open a PR and record it as a work product → `in_review`; merge when the ticket reaches `merging`.'
    : 'do the work, commit on the ticket branch → `in_review`; merge when the ticket reaches `merging`.';
  if (kind === 'scout') return 'write the findings as a `report` document (`oc_ticket_document_put`): what you did, what you found, evidence with file:line, recommendation. No code changes, no PR → `done`.';
  return 'answer on the ticket with `oc_ticket_comment`, then transition to `done`.';
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
  worktree: { path: string; branch: string };
  brief: { definitionOfDone: string; relaunchNote: string | null };
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
      id: p?.slug ?? '', name: p?.name ?? '', defaultBranch: p?.defaultBranch ?? 'main', deliveryMode,
      mergeMethod: String(policies.mergeMethod ?? 'squash'), rules: r?.rules ?? [], openspec: p?.openspecEnabled ?? false,
    },
    ticket: {
      identifier: t?.identifier ?? '', title: t?.title ?? '', description: t?.description ?? '', kind: t?.kind ?? 'task',
      priority: t?.priority ?? 'medium', status: t?.status ?? 'todo', acceptance: t ? parseAcceptance(t.description) : [],
      openspecChange: t?.openspecChangeName ?? null, links: t?.parentId ? `parent ${t.parentId}` : '',
    },
    worktree: { path: agent.worktreePath ?? 'work/', branch: agent.branch ?? '' },
    brief: { definitionOfDone: definitionOfDone((t?.kind ?? 'task') as S.TicketKind, deliveryMode), relaunchNote: opts.relaunchNote ?? null },
    knowledge: { shared: knowledgeText(deps, 'shared'), project: agent.projectId ? knowledgeText(deps, 'project', agent.projectId) : '' },
  };
}

// ---------- renderers ----------

export function renderCharter(ctx: WorkspaceContext, spec: S.RoleSpec): string {
  const tmpl = loadTemplate(ctx, 'charter.md.tmpl', CHARTER_TMPL);
  return renderTemplate(tmpl, {
    workspace: { name: ctx.config.name, id: ctx.config.id },
    human: { name: humanName(ctx) },
    role: {
      id: spec.id, name: spec.name, charterSummary: spec.charterSummary, scope: spec.scope,
      responsibilities: spec.responsibilities, capabilities: spec.capabilities, exclusions: spec.exclusions,
      rules: spec.rules, notes: spec.notes ?? '', runtime: spec.runtime, model: spec.model,
    },
    project: { id: spec.project },
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
  relaunchNote?: string | null;
  interrupted?: boolean;
  turnEpoch?: number;
}

interface BundledWake { source: string; reason: string; payload: Record<string, unknown> }

export function flattenWakes(wakes: S.Wakeup[]): BundledWake[] {
  const out: BundledWake[] = [];
  for (const w of wakes) {
    out.push({ source: w.source, reason: w.reason, payload: (w.payload ?? {}) as Record<string, unknown> });
    const bundle = (w.payload as { bundle?: Array<{ source?: string; reason?: string; payload?: Record<string, unknown> }> } | null)?.bundle;
    if (Array.isArray(bundle)) for (const b of bundle) out.push({ source: String(b.source ?? 'system'), reason: String(b.reason ?? ''), payload: (b.payload ?? {}) as Record<string, unknown> });
  }
  return out;
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
  parts.push(bounded(flat, 12, (w) => `- ${w.source}: ${w.reason || '(no reason given)'}`, 'call `oc_inbox` for the rest'));

  if (agent.kind === 'worker' && agent.ticketId) {
    const t = ticket(ctx, agent.ticketId);
    const p = project(ctx, agent.projectId);
    if (t) {
      let wtLine = '';
      if (agent.worktreePath) {
        const st = await worktreeState(agent.worktreePath, p?.defaultBranch ?? 'main');
        wtLine = st.exists
          ? ` — worktree \`work/\` on \`${st.branch ?? agent.branch}\` (${st.dirty ? `${st.changedFiles} uncommitted change(s)` : 'clean'}, ${st.ahead} ahead / ${st.behind} behind ${p?.defaultBranch ?? 'main'})`
          : ` — worktree missing at ${agent.worktreePath}: stop and report blocked`;
      }
      const lastStatus = ctx.db.get<{ body: string }>("SELECT body FROM ticket_comments WHERE ticket_id = ? AND kind = 'status' ORDER BY created_at DESC LIMIT 1", [t.id]);
      parts.push('\n## Your ticket');
      parts.push(`- ${t.identifier} [${t.status}] ${t.title}${wtLine}${lastStatus ? `; last status: ${lastStatus.body.slice(0, 160)}` : ''}`);
      if (t.openspecChangeName) parts.push(`- OpenSpec change: \`${t.openspecChangeName}\``);
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
      return `- ${t.identifier} [${t.status}] ${t.title}${w ? ` — ${w.name} (${w.status})` : ''}`;
    }, 'call `oc_ticket_list`'));
    const pending = ctx.db.all<S.Decision>("SELECT * FROM decisions WHERE workspace_id = ? AND status = 'open' ORDER BY created_at", [ctx.workspaceId]);
    if (pending.length) {
      parts.push('\n## Open decisions');
      parts.push(bounded(pending, 8, (d) => `- ${d.id} [${d.kind}, owner ${d.owner}] ${d.title}`, 'call `oc_briefing`'));
    }
  }

  const answered = ctx.db.all<S.Decision>(
    "SELECT * FROM decisions WHERE workspace_id = ? AND status = 'answered' AND asked_by_agent_id = ? AND answered_at > COALESCE((SELECT MAX(finished_at) FROM runs WHERE agent_id = ? AND status IN ('succeeded','failed','timed_out','interrupted','cancelled')), '') ORDER BY answered_at",
    [ctx.workspaceId, agent.id, agent.id],
  );
  if (answered.length) {
    parts.push('\n## Answered decisions');
    parts.push(bounded(answered, 8, (d) => `- ${d.id}${d.ticketId ? ` (${ticket(ctx, d.ticketId)?.identifier ?? d.ticketId})` : ''}: "${d.title}" — answered ${d.answerKey ?? ''}${d.answerText ? `: "${d.answerText}"` : ''}`, 'call `oc_inbox`'));
  }

  const notes: string[] = [];
  if (opts.briefUpdated) notes.push('- Your brief was updated since your last turn; re-read `AGENTS.md` in your home.');
  if (opts.charterChanged) notes.push(`- Your role's charter changed: ${opts.charterChanged}`);
  if (opts.relaunchNote) notes.push(`- Relaunch note: ${opts.relaunchNote}`);
  if (opts.interrupted) notes.push('- Your previous turn was interrupted; verify what you had already done before redoing it.');
  if (opts.isFirstTurn || opts.sessionStale) {
    let digest = '';
    try { digest = deps().knowledge.bootstrapDigest(agent.id).text; } catch { digest = ''; }
    if (digest) notes.push(`- Bootstrap:\n\n${digest}`);
  }
  if (notes.length) { parts.push('\n## Notes'); parts.push(notes.join('\n')); }

  parts.push('\n## What to do now');
  parts.push(agent.kind === 'conductor'
    ? 'Call `oc_inbox` if you need details. Handle human messages first, then ticket events. Reply to the human only through `oc_human_send`. Finish with the structured final report.'
    : 'Call `oc_inbox` if you need details, do the phase your ticket status asks for, leave durable progress on the ticket, and finish with the structured final report. Ask with `oc_ask` instead of guessing; report `blocked` with a routable path if you are stuck.');
  return parts.join('\n') + '\n';
}
