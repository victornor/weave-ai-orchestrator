/** MCP tool names exposed to agents (PLAN §9.2). Stable API. */
export const COMMON_TOOLS = [
  'oc_inbox', 'oc_ticket_get', 'oc_ticket_list', 'oc_ticket_comments', 'oc_ticket_checkout', 'oc_ticket_release', 'oc_ticket_comment',
  'oc_ticket_document_put', 'oc_ticket_transition', 'oc_ticket_work_product', 'oc_ask', 'oc_report', 'oc_knowledge_get', 'oc_knowledge_note',
  'oc_knowledge_replace', 'oc_openspec_status', 'oc_spec_list', 'oc_spec_get', 'oc_spec_search', 'oc_spec_change_get', 'oc_ticket_merge_done', 'oc_worktree_status',
] as const;
export const CONDUCTOR_TOOLS = [
  'oc_ticket_create', 'oc_ticket_assign', 'oc_ticket_set_priority', 'oc_role_list', 'oc_role_get', 'oc_role_hire', 'oc_role_update_charter',
  'oc_role_pause', 'oc_role_resume', 'oc_role_retire', 'oc_worker_list', 'oc_worker_get', 'oc_worker_message', 'oc_worker_relaunch', 'oc_worker_cancel',
  'oc_decision_answer', 'oc_human_send', 'oc_briefing', 'oc_project_list', 'oc_project_add', 'oc_usage',
] as const;
export const WORKER_ONLY_TOOLS = ['oc_ticket_create'] as const; // project-scoped creation for workers
export type ToolName = (typeof COMMON_TOOLS)[number] | (typeof CONDUCTOR_TOOLS)[number];
export const OC_ENV = {
  API_URL: 'OC_API_URL', RUN_TOKEN: 'OC_RUN_TOKEN', RUN_ID: 'OC_RUN_ID', AGENT_ID: 'OC_AGENT_ID', ROLE_ID: 'OC_ROLE_ID', WORKSPACE_ID: 'OC_WORKSPACE_ID',
  PROJECT_ID: 'OC_PROJECT_ID', TICKET_ID: 'OC_TICKET_ID', WORKTREE: 'OC_WORKTREE', WAKE_REASON: 'OC_WAKE_REASON', AGENT_KIND: 'OC_AGENT_KIND',
} as const;
