/** The MCP server's own registered name; also the key a run's MCP config uses. */
export const MCP_SERVER_NAME = 'weave-ai';

/** MCP tool names exposed to agents (PLAN §9.2). Stable API. */
export const COMMON_TOOLS = [
  'weave_inbox', 'weave_ticket_get', 'weave_ticket_list', 'weave_ticket_comments', 'weave_ticket_checkout', 'weave_ticket_release', 'weave_ticket_comment',
  'weave_ticket_document_put', 'weave_ticket_document_get', 'weave_ticket_transition', 'weave_ticket_work_product', 'weave_ask', 'weave_report', 'weave_incident', 'weave_knowledge_get', 'weave_knowledge_note',
  'weave_knowledge_replace', 'weave_knowledge_docs', 'weave_knowledge_doc_get', 'weave_knowledge_doc_put', 'weave_knowledge_search', 'weave_openspec_status', 'weave_spec_list', 'weave_spec_get', 'weave_spec_search', 'weave_spec_change_get', 'weave_ticket_merge_done', 'weave_worktree_status', 'weave_artifact_kit', 'weave_ticket_artifact_put',
  // VS-397: a worker may read its own project's roadmap; the three writes are weaver-only (WEAVER_TOOLS).
  'weave_roadmap_list',
] as const;
export const WEAVER_TOOLS = [
  'weave_ticket_create', 'weave_ticket_assign', 'weave_ticket_set_priority', 'weave_role_list', 'weave_role_get', 'weave_role_hire', 'weave_role_update', 'weave_role_update_charter', 'weave_role_set_secrets',
  'weave_role_set_max_workers', 'weave_role_pause', 'weave_role_resume', 'weave_role_retire', 'weave_worker_list', 'weave_worker_get', 'weave_worker_message', 'weave_worker_relaunch', 'weave_worker_cancel',
  'weave_decision_answer', 'weave_decision_review', 'weave_human_send', 'weave_thread_message_get', 'weave_briefing', 'weave_project_list', 'weave_project_add', 'weave_usage',
  'weave_run_inspect', 'weave_run_list', 'weave_worker_models',
  'weave_routine_list', 'weave_routine_create', 'weave_routine_update', 'weave_routine_remove',
  'weave_roadmap_add', 'weave_roadmap_update', 'weave_roadmap_remove',
  'weave_incident_list', 'weave_incident_get', 'weave_incident_resolve',
  'weave_artifact_put',
  /** VS-398: reads a submitted (or in-progress) draft plan back, and records what became of each draft once tickets are created from it. */
  'weave_plan_get', 'weave_plan_draft_link',
] as const;
export const WORKER_ONLY_TOOLS = ['weave_ticket_create', 'weave_schedule_wakeup', 'weave_ticket_open_pull_request'] as const; // project-scoped creation, self-scheduling, and delivery for workers
/**
 * VS-398: the read-only planning agent's whole tool surface — never `COMMON_TOOLS` plus
 * subtractions, since most of `COMMON_TOOLS` is ticket- or worktree-shaped and a planner has neither.
 * Read tools are scoped to the planner's own plan's project (never another project, never
 * workspace-/decision-scope knowledge — enforced server-side, not by this list alone). The only
 * tools that write are the draft-editing ones, each scoped to the calling agent's own plan
 * (`agent.planId`). There is deliberately no submit tool: only captain submits, via an HTTP action.
 */
export const PLANNER_TOOLS = [
  'weave_inbox', 'weave_ticket_list', 'weave_ticket_get',
  'weave_spec_list', 'weave_spec_get', 'weave_spec_search', 'weave_spec_change_get', 'weave_openspec_status',
  'weave_knowledge_docs', 'weave_knowledge_doc_get', 'weave_knowledge_get', 'weave_knowledge_search',
  'weave_role_list', 'weave_role_get',
  'weave_plan_get', 'weave_plan_draft_add', 'weave_plan_draft_update', 'weave_plan_draft_remove', 'weave_plan_draft_reorder',
  /** The planner's own reply tool — `weave_human_send` is weaver-only and `weave_ticket_comment` needs a ticket the planner never has. */
  'weave_plan_reply',
] as const;
/**
 * VS-101, narrowed by VS-462: the tools an interactive session's agent may call on its very first
 * turn — read its ticket and its documents, and post one comment, nothing else. Deliberately no
 * `weave_worktree_status`, no `weave_ticket_transition`, no work product: the opening turn says what
 * it understands and stops. Enforced at the MCP boundary by the run token's `firstTurn` claim, so a
 * runtime that ignores its own tool allowlist still cannot reach past this list.
 */
export const FIRST_TURN_TOOLS = [
  'weave_inbox', 'weave_ticket_get', 'weave_ticket_comments', 'weave_ticket_comment', 'weave_ticket_document_get',
] as const;
export type ToolName = (typeof COMMON_TOOLS)[number] | (typeof WEAVER_TOOLS)[number] | (typeof PLANNER_TOOLS)[number] | (typeof FIRST_TURN_TOOLS)[number];

/** The weaver's tool whose words reach the human; its body is the reply itself. Kept as the single name for backward compatibility — `HUMAN_REPLY_TOOLS` is the full set `isHumanReplyToolEvent` checks against. */
export const HUMAN_REPLY_TOOL = 'weave_human_send' satisfies ToolName;
/** VS-398: every tool whose words reach a human — the weaver's `weave_human_send` and the planner's own `weave_plan_reply`, since it has neither `weave_human_send` (weaver-only) nor a ticket for `weave_ticket_comment`. */
export const HUMAN_REPLY_TOOLS = [HUMAN_REPLY_TOOL, 'weave_plan_reply'] as const satisfies readonly ToolName[];

/** The payload keys the runtime adapters use for a tool's name — they do not agree. */
const TOOL_NAME_KEYS = ['name', 'tool', 'toolName'] as const;

/**
 * True for the `tool.call` / `tool.result` / `tool.denied` events that deliver a reply to the human.
 *
 * A chat surface must drop these before building a transcript: the reply already renders as the
 * thread message the tool created, so showing the call too would put the same text on screen twice.
 * Views that show the raw turn (`attach`, the run page) keep them.
 */
export function isHumanReplyToolEvent(event: { type: string; payload?: Record<string, unknown> | null } | null | undefined): boolean {
  if (!event) return false;
  if (event.type !== 'tool.call' && event.type !== 'tool.result' && event.type !== 'tool.denied') return false;
  const payload = event.payload;
  if (!payload) return false;
  for (const key of TOOL_NAME_KEYS) {
    if (typeof payload[key] === 'string' && (HUMAN_REPLY_TOOLS as readonly string[]).includes(payload[key] as string)) return true;
  }
  return false;
}
export const AC_ENV = {
  API_URL: 'AC_API_URL', RUN_TOKEN: 'AC_RUN_TOKEN', RUN_ID: 'AC_RUN_ID', AGENT_ID: 'AC_AGENT_ID', ROLE_ID: 'AC_ROLE_ID', WORKSPACE_ID: 'AC_WORKSPACE_ID',
  PROJECT_ID: 'AC_PROJECT_ID', TICKET_ID: 'AC_TICKET_ID', WORKTREE: 'AC_WORKTREE', WAKE_REASON: 'AC_WAKE_REASON', AGENT_KIND: 'AC_AGENT_KIND',
} as const;
