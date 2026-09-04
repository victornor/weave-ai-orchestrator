/** MCP tool names exposed to agents (PLAN §9.2). Stable API. */
export const COMMON_TOOLS = [
  'ac_inbox', 'ac_ticket_get', 'ac_ticket_list', 'ac_ticket_comments', 'ac_ticket_checkout', 'ac_ticket_release', 'ac_ticket_comment',
  'ac_ticket_document_put', 'ac_ticket_transition', 'ac_ticket_work_product', 'ac_ask', 'ac_report', 'ac_knowledge_get', 'ac_knowledge_note',
  'ac_knowledge_replace', 'ac_openspec_status', 'ac_spec_list', 'ac_spec_get', 'ac_spec_search', 'ac_spec_change_get', 'ac_ticket_merge_done', 'ac_worktree_status',
] as const;
export const CONDUCTOR_TOOLS = [
  'ac_ticket_create', 'ac_ticket_assign', 'ac_ticket_set_priority', 'ac_role_list', 'ac_role_get', 'ac_role_hire', 'ac_role_update_charter',
  'ac_role_pause', 'ac_role_resume', 'ac_role_retire', 'ac_worker_list', 'ac_worker_get', 'ac_worker_message', 'ac_worker_relaunch', 'ac_worker_cancel',
  'ac_decision_answer', 'ac_human_send', 'ac_briefing', 'ac_project_list', 'ac_project_add', 'ac_usage',
] as const;
export const WORKER_ONLY_TOOLS = ['ac_ticket_create'] as const; // project-scoped creation for workers
export type ToolName = (typeof COMMON_TOOLS)[number] | (typeof CONDUCTOR_TOOLS)[number];
export const AC_ENV = {
  API_URL: 'AC_API_URL', RUN_TOKEN: 'AC_RUN_TOKEN', RUN_ID: 'AC_RUN_ID', AGENT_ID: 'AC_AGENT_ID', ROLE_ID: 'AC_ROLE_ID', WORKSPACE_ID: 'AC_WORKSPACE_ID',
  PROJECT_ID: 'AC_PROJECT_ID', TICKET_ID: 'AC_TICKET_ID', WORKTREE: 'AC_WORKTREE', WAKE_REASON: 'AC_WAKE_REASON', AGENT_KIND: 'AC_AGENT_KIND',
} as const;
