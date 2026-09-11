/** MCP tool names exposed to agents (PLAN §9.2). Stable API. */
export const COMMON_TOOLS = [
  'ac_inbox', 'ac_ticket_get', 'ac_ticket_list', 'ac_ticket_comments', 'ac_ticket_checkout', 'ac_ticket_release', 'ac_ticket_comment',
  'ac_ticket_document_put', 'ac_ticket_document_get', 'ac_ticket_transition', 'ac_ticket_work_product', 'ac_ask', 'ac_report', 'ac_incident', 'ac_knowledge_get', 'ac_knowledge_note',
  'ac_knowledge_replace', 'ac_knowledge_docs', 'ac_knowledge_doc_get', 'ac_knowledge_doc_put', 'ac_knowledge_search', 'ac_openspec_status', 'ac_spec_list', 'ac_spec_get', 'ac_spec_search', 'ac_spec_change_get', 'ac_ticket_merge_done', 'ac_worktree_status',
] as const;
export const CONDUCTOR_TOOLS = [
  'ac_ticket_create', 'ac_ticket_assign', 'ac_ticket_set_priority', 'ac_role_list', 'ac_role_get', 'ac_role_hire', 'ac_role_update_charter', 'ac_role_set_secrets',
  'ac_role_set_max_workers', 'ac_role_pause', 'ac_role_resume', 'ac_role_retire', 'ac_worker_list', 'ac_worker_get', 'ac_worker_message', 'ac_worker_relaunch', 'ac_worker_cancel',
  'ac_decision_answer', 'ac_human_send', 'ac_briefing', 'ac_project_list', 'ac_project_add', 'ac_usage',
  'ac_run_inspect', 'ac_run_list', 'ac_worker_models',
  'ac_routine_list', 'ac_routine_create', 'ac_routine_update', 'ac_routine_remove',
] as const;
export const WORKER_ONLY_TOOLS = ['ac_ticket_create'] as const; // project-scoped creation for workers
export type ToolName = (typeof COMMON_TOOLS)[number] | (typeof CONDUCTOR_TOOLS)[number];

/** The only tool whose words reach the human; its body is the reply itself. */
export const HUMAN_REPLY_TOOL = 'ac_human_send' satisfies ToolName;

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
