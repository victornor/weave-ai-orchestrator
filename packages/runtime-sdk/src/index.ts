import type { AccountLimitWindow, BillingType, RunErrorFamily, RunEventType, PermissionMode, SessionPolicy } from '@agent-conductor/shared';
export type { RunErrorFamily, RunEventType };

export type JsonSchema = Record<string, unknown>;
export type SessionRef = Record<string, unknown>;

export interface RuntimeCapabilities {
  resumableSessions: boolean; forkSessions: boolean; streamingInput: boolean;
  systemPromptInjection: 'system_prompt' | 'append' | 'file_only' | 'none';
  structuredOutput: boolean; mcp: boolean; usageReporting: 'per_turn' | 'session_cumulative' | 'none'; costReporting: boolean; permissionModes: string[];
}
export interface RuntimeDetection { status: 'available' | 'missing_binary' | 'broken' | 'unsupported'; version?: string; path?: string; notes?: string }
export interface RuntimeModel { id: string; label: string; provider: string; source: 'detected' | 'static'; tier?: string; notes?: string }
export interface McpServerConfig { type: 'http' | 'stdio'; url?: string; command?: string; args?: string[]; headers?: Record<string, string>; env?: Record<string, string> }

export interface TurnInput {
  runId: string; turnEpoch: number; cwd: string; worktree: { path: string; branch: string } | null;
  session: { policy: SessionPolicy; ref: SessionRef | null; isFirstTurn: boolean; sessionId?: string };
  systemPrompt: { text: string; mode: 'inject' | 'skip' };
  prompt: string; outputSchema?: JsonSchema; mcpServers: Record<string, McpServerConfig>; env: Record<string, string>;
  options: Record<string, unknown>; limits: { timeoutMs: number; maxBudgetUsd?: number; maxTurns?: number };
  permission: { mode: PermissionMode; allowedTools?: string[]; deniedTools?: string[] };
  model?: string | null; effort?: string | null; configHome?: string;
}
export interface RuntimeEvent { seq?: number; ts: string; type: RunEventType; payload: Record<string, unknown> }
export interface TurnSink { onSpawn(info: { pid: number; pgid: number | null }): void; onEvent(ev: RuntimeEvent): void; onRaw(stream: 'stdout' | 'stderr', chunk: string): void }
export interface TurnResult {
  exitCode: number | null; signal: string | null; timedOut: boolean; session: SessionRef | null; finalText: string | null; structured?: unknown;
  usage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number; basis: 'per_turn' | 'session_cumulative' };
  cost?: { usd: number; status: 'reported' | 'estimated' }; model?: string; provider?: string;
  error?: { code: string; family: RunErrorFamily; message: string; retryAfterMs?: number };
}
export interface TurnHandle { pid: number | null; cancel(mode: 'interrupt' | 'kill'): Promise<void> }
export interface AgentHome { path: string; kind: 'conductor' | 'worker' }

/** Input to `describeAccount`: the workspace's per-runtime credential home, the env the CLI would run under, and how long the probe may take. */
export interface AccountProbeInput { configHome?: string; env: Record<string, string>; timeoutMs: number }
/**
 * What a runtime can honestly say about the account its credentials belong to.
 * `limits` is empty whenever `limitsAvailable` is false; `note` says why.
 */
export interface AccountDescription {
  billingType: BillingType;
  planLabel: string | null;
  limitsAvailable: boolean;
  limits: AccountLimitWindow[];
  note: string | null;
}
export interface InstructionBundle { instructions: string; skills: Array<{ name: string; dir: string }> }

export interface RuntimeAdapter {
  readonly id: string; readonly displayName: string; readonly capabilities: RuntimeCapabilities;
  detect(): Promise<RuntimeDetection>;
  listModels(): Promise<RuntimeModel[]>;
  configSchema(): JsonSchema;
  installInstructions(home: AgentHome, bundle: InstructionBundle): Promise<void>;
  runTurn(input: TurnInput, sink: TurnSink, onHandle?: (h: TurnHandle) => void): Promise<TurnResult>;
  forkSession?(base: SessionRef, cwd: string): Promise<SessionRef>;
  describeSession?(ref: SessionRef): Promise<{ displayId: string; exists: boolean }>;
  /**
   * The billing mode and plan limit windows of the account these credentials belong to.
   * Optional: an adapter that cannot determine any of it omits the method rather than
   * reporting zeros. Must never spend model tokens or start an agent session, and must
   * resolve (never reject) — a failed probe is an `unknown` description with a note.
   */
  describeAccount?(input: AccountProbeInput): Promise<AccountDescription>;
  /** Directory names for skills per CLI, relative to the home. */
  skillsDir(): string;
  /** Instruction discovery file name at the home root (AGENTS.md, CLAUDE.md, GEMINI.md). */
  instructionFiles(): string[];
}
export * from './process.js';
export * from './testkit.js';
export * from './fsutil.js';
