export const ERROR_CODES = [
  'not_found', 'conflict', 'forbidden', 'unauthorized', 'validation', 'invalid_disposition', 'missing_action_path', 'not_checked_out',
  'wrong_status', 'budget_exceeded', 'duplicate_entry', 'entry_too_long', 'runtime_unreachable', 'model_unconfigured', 'worktree_dirty', 'worktree_not_landed',
  'openspec_validation_failed', 'openspec_not_found', 'merge_not_approved', 'merge_unverified', 'role_full', 'auth_bad_credentials',
  'auth_locked', 'auth_session_expired', 'auth_totp_required', 'auth_totp_invalid', 'net_daemon_unreachable', 'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export class OcError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly details?: Record<string, unknown>, public readonly retryable = false) {
    super(message);
    this.name = 'OcError';
  }
  toJSON() { return { code: this.code, message: this.message, details: this.details, retryable: this.retryable }; }
  static status(code: ErrorCode): number {
    switch (code) {
      case 'not_found': case 'openspec_not_found': return 404;
      case 'conflict': case 'wrong_status': case 'duplicate_entry': return 409;
      case 'forbidden': case 'merge_not_approved': return 403;
      case 'unauthorized': case 'auth_bad_credentials': case 'auth_session_expired': case 'auth_totp_required': case 'auth_totp_invalid': return 401;
      case 'auth_locked': return 429;
      case 'validation': case 'entry_too_long': case 'budget_exceeded': case 'model_unconfigured': return 400;
      case 'invalid_disposition': case 'missing_action_path': case 'not_checked_out': case 'openspec_validation_failed': case 'worktree_dirty': case 'worktree_not_landed': case 'merge_unverified': case 'role_full': return 422;
      case 'runtime_unreachable': case 'net_daemon_unreachable': return 503;
      default: return 500;
    }
  }
}
/** An MCP tool result's `image` content item (VS-133) — the shape the installed `@modelcontextprotocol/sdk`'s `ImageContentSchema` accepts, and the one the Claude CLI turns into a real vision `tool_result` block (openspec design.md — Decision 4). */
export interface McpImageBlock { type: 'image'; data: string; mimeType: string }
export type ToolResult<T> =
  | { ok: true; data: T; /** Appended after the JSON text block when the MCP endpoint builds `CallToolResult.content` — nothing but `ac_inbox` sets this today. */ mcpContent?: McpImageBlock[] }
  | { ok: false; error: { code: ErrorCode; message: string; retryable: boolean; details?: Record<string, unknown> } };
export const ok = <T>(data: T, mcpContent?: McpImageBlock[]): ToolResult<T> => (mcpContent ? { ok: true, data, mcpContent } : { ok: true, data });
export const fail = (e: OcError): ToolResult<never> => ({ ok: false, error: { code: e.code, message: e.message, retryable: e.retryable, details: e.details } });

/**
 * A `ToolDef.handler`'s escape hatch to attach `mcpContent` (VS-133) through `runTool`'s uniform
 * `ok(await handler(...))` wrapping, without every handler's return shape having to carry an
 * ambiguous `mcpContent` key of its own. Only `ac_inbox` uses this today.
 */
const MCP_CONTENT: unique symbol = Symbol('mcpContent');
export interface WithMcpContent<T> { [MCP_CONTENT]: McpImageBlock[]; data: T }
export const withMcpContent = <T>(data: T, mcpContent: McpImageBlock[]): WithMcpContent<T> => ({ [MCP_CONTENT]: mcpContent, data });
export const isWithMcpContent = (v: unknown): v is WithMcpContent<unknown> => typeof v === 'object' && v !== null && MCP_CONTENT in v;
export const mcpContentOf = (v: WithMcpContent<unknown>): McpImageBlock[] => v[MCP_CONTENT];
