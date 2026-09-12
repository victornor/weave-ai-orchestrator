/** The MCP server's own registered name; also the key a run's MCP config uses. */
export const MCP_SERVER_NAME = 'weave-ai';

/** MCP tool names exposed to agents (PLAN §9.2). Stable API. */
export const COMMON_TOOLS = [
  'weave_inbox', 'weave_ticket_get', 'weave_ticket_list', 'weave_ticket_comments', 'weave_ticket_checkout', 'weave_ticket_release', 'weave_ticket_comment',
  'weave_ticket_document_put', 'weave_ticket_document_get', 'weave_ticket_transition', 'weave_ticket_work_product', 'weave_ask', 'weave_report', 'weave_incident', 'weave_knowledge_get', 'weave_knowledge_note',
  'weave_knowledge_replace', 'weave_knowledge_docs', 'weave_knowledge_doc_get', 'weave_knowledge_doc_put', 'weave_knowledge_search', 'weave_openspec_status', 'weave_spec_list', 'weave_spec_get', 'weave_spec_search', 'weave_spec_change_get', 'weave_ticket_merge_done', 'weave_worktree_status', 'weave_artifact_kit', 'weave_ticket_artifact_put',
] as const;
export const WEAVER_TOOLS = [
  'weave_ticket_create', 'weave_ticket_assign', 'weave_ticket_set_priority', 'weave_role_list', 'weave_role_get', 'weave_role_hire', 'weave_role_update_charter', 'weave_role_set_secrets',
  'weave_role_set_max_workers', 'weave_role_pause', 'weave_role_resume', 'weave_role_retire', 'weave_worker_list', 'weave_worker_get', 'weave_worker_message', 'weave_worker_relaunch', 'weave_worker_cancel',
  'weave_decision_answer', 'weave_decision_review', 'weave_human_send', 'weave_thread_message_get', 'weave_briefing', 'weave_project_list', 'weave_project_add', 'weave_usage',
  'weave_run_inspect', 'weave_run_list', 'weave_worker_models',
  'weave_routine_list', 'weave_routine_create', 'weave_routine_update', 'weave_routine_remove',
  'weave_incident_list', 'weave_incident_get', 'weave_incident_resolve',
] as const;
export const WORKER_ONLY_TOOLS = ['weave_ticket_create'] as const; // project-scoped creation for workers
export type ToolName = (typeof COMMON_TOOLS)[number] | (typeof WEAVER_TOOLS)[number];

/** The only tool whose words reach the human; its body is the reply itself. */
export const HUMAN_REPLY_TOOL = 'weave_human_send' satisfies ToolName;

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
    if (payload[key] === HUMAN_REPLY_TOOL) return true;
  }
  return false;
}
export const AC_ENV = {
  API_URL: 'AC_API_URL', RUN_TOKEN: 'AC_RUN_TOKEN', RUN_ID: 'AC_RUN_ID', AGENT_ID: 'AC_AGENT_ID', ROLE_ID: 'AC_ROLE_ID', WORKSPACE_ID: 'AC_WORKSPACE_ID',
  PROJECT_ID: 'AC_PROJECT_ID', TICKET_ID: 'AC_TICKET_ID', WORKTREE: 'AC_WORKTREE', WAKE_REASON: 'AC_WAKE_REASON', AGENT_KIND: 'AC_AGENT_KIND',
} as const;
