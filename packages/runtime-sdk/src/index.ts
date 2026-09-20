import type { AccountLimitWindow, AgentKind, BillingType, ProviderProfile, RunErrorFamily, RunEventType, PermissionMode, SessionPolicy } from '@weave-ai/shared';
import type { ContainmentRequest } from './containment.js';
export type { RunErrorFamily, RunEventType };
export type { ContainmentRequest } from './containment.js';

export type JsonSchema = Record<string, unknown>;
export type SessionRef = Record<string, unknown>;

export interface RuntimeCapabilities {
  resumableSessions: boolean; forkSessions: boolean;
  /** True only when this adapter's `TurnHandle` carries `send` — a client reading this can call it. */
  streamingInput: boolean;
  systemPromptInjection: 'system_prompt' | 'append' | 'file_only' | 'none';
  structuredOutput: boolean; mcp: boolean; usageReporting: 'per_turn' | 'session_cumulative' | 'none'; costReporting: boolean; permissionModes: string[];
  /**
   * The fraction of a model's context window at which this CLI compacts the conversation on its
   * own, as a number in 0..1. Omitted by a runtime that does not compact, and by one whose
   * threshold we cannot state — a client then reports context against the window alone rather
   * than inventing a point to count towards.
   */
  contextCompactionAt?: number;
  /**
   * VS-595: what partial output this adapter reports through `TurnSink.onPartial` while a step is
   * being generated. `none` (the default when omitted): whole steps only. `text`: assistant text
   * deltas. `full`: text, reasoning and tool-input deltas. The run page says so in words for `none`.
   */
  partialOutput?: 'none' | 'text' | 'full';
}
export interface RuntimeDetection { status: 'available' | 'missing_binary' | 'broken' | 'unsupported'; version?: string; path?: string; notes?: string }
/** `contextWindowTokens` is the model's own window; a variant with a larger window is its own entry.
 * `efforts` is the thinking levels this model accepts: a non-empty list is a picker, `[]` means
 * known to take none, omitted means unknown (free text). Values come from the same path as `source`. */
export interface RuntimeModel { id: string; label: string; provider: string; source: 'detected' | 'static'; tier?: string; notes?: string; contextWindowTokens?: number; efforts?: string[] }
export interface McpServerConfig { type: 'http' | 'stdio'; url?: string; command?: string; args?: string[]; headers?: Record<string, string>; env?: Record<string, string> }

export interface TurnInput {
  runId: string; turnEpoch: number; cwd: string; worktree: { path: string; branch: string } | null;
  session: { policy: SessionPolicy; ref: SessionRef | null; isFirstTurn: boolean; sessionId?: string };
  systemPrompt: { text: string; mode: 'inject' | 'skip' };
  prompt: string; outputSchema?: JsonSchema; mcpServers: Record<string, McpServerConfig>; env: Record<string, string>;
  options: Record<string, unknown>; limits: { timeoutMs: number; maxBudgetUsd?: number; maxTurns?: number };
  /**
   * VS-462: `firstTurn` marks an interactive session's opening turn. Its `allowedTools` list is
   * exhaustive — the runtime adapters hand it to the CLI where one exists (Claude's `--allowedTools`)
   * and, where a runtime exposes its own tool switch (opencode's `tools` config), disable everything
   * outside it. The MCP server enforces the same list off the run token, so it holds on any runtime.
   */
  permission: { mode: PermissionMode; allowedTools?: string[]; deniedTools?: string[]; bashDeny?: string[]; firstTurn?: boolean };
  model?: string | null; effort?: string | null; configHome?: string;
  /**
   * VS-619: the workspace this run belongs to. A runtime whose provider profiles live in workspace
   * config (`weave`) uses it to resolve the provider profile and its API key from the run's own
   * workspace, never another workspace's. Absent means the caller has no workspace (a catalog
   * request), and the host falls back to its aggregate lookup.
   */
  workspaceId?: string;
  /**
   * VS-579: when set, the adapter spawns this turn inside a memory-limited systemd scope. Absent
   * (a non-worker agent, or a host with no systemd user manager) means a plain spawn as before.
   */
  containment?: ContainmentRequest;
}
export interface RuntimeEvent { seq?: number; ts: string; type: RunEventType; payload: Record<string, unknown> }
/**
 * VS-595: one appended fragment of a part still being generated. Ephemeral: the engine coalesces and
 * broadcasts these but never stores them; the completed event for the same `partId` supersedes them.
 */
export interface RuntimePartial {
  kind: 'text' | 'thinking' | 'tool_input';
  /** Stable per part; the completed `assistant.text` / `assistant.thinking` / `tool.call` carries the same id. */
  partId: string;
  messageId?: string;
  toolCallId?: string;
  /** The appended delta, not the whole text. */
  text: string;
}
export interface TurnSink {
  onSpawn(info: { pid: number; pgid: number | null }): void;
  onEvent(ev: RuntimeEvent): void;
  onRaw(stream: 'stdout' | 'stderr', chunk: string): void;
  /** Optional: a runtime that reports partial output calls this (see `capabilities.partialOutput`). */
  onPartial?(p: RuntimePartial): void;
}
export interface TurnResult {
  exitCode: number | null; signal: string | null; timedOut: boolean; session: SessionRef | null; finalText: string | null; structured?: unknown;
  /**
   * The turn's token counts, summed over every API request it made — what cost and the usage
   * records are computed from. `contextTokens` is the odd one out: the size of the turn's **last**
   * request alone (its input, its cache creation and its cache reads), which is the only one of
   * these numbers that measures how full the context window is. A turn re-sends or cache-reads the
   * whole conversation on every request, so the cumulative fields are roughly the context size
   * multiplied by the request count and are not a context measurement. Omitted by an adapter whose
   * CLI reports no per-request figure — better unreported than a total read as a size.
   */
  usage?: {
    inputTokens: number; outputTokens: number; cachedInputTokens?: number; contextTokens?: number; basis: 'per_turn' | 'session_cumulative';
    /**
     * VS-462: the turn's **first** API request, split into what the provider had to read fresh and
     * what it read from its prompt cache. A turn's first request should hit the cache of the
     * previous turn's context; when it does not, the whole conversation is re-sent uncached and the
     * miss dominates the run's cost. Omitted by an adapter whose CLI reports no per-request figure.
     */
    firstRequest?: { freshTokens: number; cachedTokens: number };
  };
  cost?: { usd: number; status: 'reported' | 'estimated' }; model?: string; provider?: string;
  error?: { code: string; family: RunErrorFamily; message: string; retryAfterMs?: number };
}
/** What became of an attempt to deliver text to a turn already executing. */
export type InputDelivery = 'delivered' | 'closed' | 'unsupported';
export interface TurnHandle {
  pid: number | null;
  cancel(mode: 'interrupt' | 'kill'): Promise<void>;
  /** Deliver text to this turn while it runs. Omitted by an adapter whose turn cannot take live input. */
  send?(text: string): Promise<InputDelivery>;
}
export interface AgentHome { path: string; kind: AgentKind }

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
  /** How the probe was launched, for the daemon's log when it failed. Never stored, never shown. */
  diagnostics?: Record<string, string>;
}
/** Input to `readCredential`: the config home whose credential file is to be described. */
export interface CredentialProbeInput { configHome: string }
/**
 * What a runtime can say about its credential file without opening a session or spawning anything.
 * Deliberately has no field that could carry a token: the type is the guarantee (VS-75).
 */
export interface CredentialFacts {
  /** Is there a credential file at all? */
  present: boolean;
  /** When the credential says it expires, ISO-8601. `null` when it is present but unreadable — never guessed. */
  expiresAt: string | null;
}

export interface InstructionBundle { instructions: string; skills: Array<{ name: string; dir: string }> }

/**
 * What an out-of-band compaction request needs: the resumed session's ref, plus the same cwd, config
 * home and model a turn would run under. `ref` is the same shape the adapter returns in
 * `TurnResult.session`, so a caller passes back what the last turn stored.
 */
export interface CompactSessionInput {
  ref: SessionRef;
  cwd: string;
  configHome?: string;
  /** `provider/model` as the turn ran it. A runtime whose CLI needs the model for the summary uses it. */
  model?: string | null;
  env?: Record<string, string>;
  timeoutMs?: number;
}

/** The outcome of an external compaction request. Branch on `ok`; `via` names the mechanism used. */
export interface CompactSessionResult {
  ok: boolean;
  /** How it was asked: `command` (Claude `/compact`), `rpc` (Codex app-server), `http` (OpenCode). */
  via?: string;
  error?: { code: string; message: string };
  detail?: Record<string, unknown>;
}

/** Input to `resumeCommand` (VS-249): the working context a human's own resume needs to reproduce. */
export interface ResumeCommandInput {
  /** The agent's home — the same `cwd` the daemon's own turn would use. */
  cwd: string;
  /** The worktree, when it is not under `cwd` and needs its own directory-inclusion flag. */
  worktreePath: string | null;
  /** The stored session ref to resume. Callers only call this when one exists. */
  session: SessionRef;
  /** The runtime's own per-workspace config home, when it needs one set as an env var. */
  configHome?: string;
  model?: string | null;
}
/**
 * The bare interactive invocation that resumes `session` in a human's own terminal — never the
 * headless/turn form `buildArgs` produces (no `-p`, no structured output flag, no MCP wiring): a
 * human typing at this needs the runtime's ordinary interactive UI, not one more scripted turn.
 * `env` carries only the overlay keys this runtime's resume needs (its config-dir variable, and for
 * an adapter that relocates `HOME` entirely, the `MISE_*` pin described in `launch.ts`) — never the
 * daemon's full environment, which a human's own shell already has correctly for itself.
 */
export interface ResumeCommand { cmd: string; args: string[]; env: Record<string, string> }

/**
 * VS-607: what the daemon offers a runtime that is not a wrapped CLI and so needs workspace
 * configuration to know what it can talk to. Read lazily: the workspaces load after the adapters register.
 */
export interface RuntimeHost {
  /**
   * The model providers a runtime may talk to, by provider id. Given a `workspaceId`, only that
   * workspace's providers; without one, every workspace's with the first defining an id winning —
   * the aggregate a caller with no run (the runtime catalog, `detect()`) needs.
   */
  providers(workspaceId?: string): Record<string, ProviderProfile>;
  /**
   * The API key of a provider, read from the secret store of the named workspace, or — when no
   * workspace is named — the first workspace defining the id (VS-619). Undefined when there is none.
   */
  providerKey?(providerId: string, workspaceId?: string): string | undefined;
}

export interface RuntimeAdapter {
  readonly id: string; readonly displayName: string; readonly capabilities: RuntimeCapabilities;
  /** Optional: called once when the daemon registers the adapter, before any workspace loads. */
  attach?(host: RuntimeHost): void;
  detect(): Promise<RuntimeDetection>;
  /**
   * The models this runtime offers. `workspaceId` scopes a runtime whose catalog is workspace
   * config (VS-619); a runtime with a fixed catalog ignores it.
   */
  listModels(workspaceId?: string): Promise<RuntimeModel[]>;
  configSchema(): JsonSchema;
  installInstructions(home: AgentHome, bundle: InstructionBundle): Promise<void>;
  runTurn(input: TurnInput, sink: TurnSink, onHandle?: (h: TurnHandle) => void): Promise<TurnResult>;
  forkSession?(base: SessionRef, cwd: string): Promise<SessionRef>;
  describeSession?(ref: SessionRef): Promise<{ displayId: string; exists: boolean }>;
  /**
   * Ask this runtime's CLI to compact the session now, out of band of a turn — the same summarise
   * the CLI does for itself at its own threshold, but at a point the daemon chooses. Optional: a
   * runtime with no external trigger omits it, and a caller must check for the method. Must never
   * throw — a request that cannot be made or is refused resolves `{ ok: false }` so the caller can
   * log and carry on.
   */
  compactSession?(input: CompactSessionInput): Promise<CompactSessionResult>;
  /**
   * The context window of one of this runtime's models, in tokens, when the runtime can state it —
   * what a percentage compaction policy is a fraction of. Optional: a runtime whose models carry no
   * window (OpenCode) omits it, and a percentage policy is then reported as unavailable for it
   * rather than measured against a window nobody declared. `workspaceId` scopes a runtime whose
   * catalog is workspace config (VS-619). Never throws; unknown resolves undefined.
   */
  modelContextWindow?(model: string | null | undefined, workspaceId?: string): Promise<number | undefined>;
  /**
   * The billing mode and plan limit windows of the account these credentials belong to.
   * Optional: an adapter that cannot determine any of it omits the method rather than
   * reporting zeros. Must never spend model tokens or start an agent session, and must
   * resolve (never reject) — a failed probe is an `unknown` description with a note.
   */
  describeAccount?(input: AccountProbeInput): Promise<AccountDescription>;
  /**
   * Facts about the credential file in a config home, read from the file itself (VS-75).
   * Synchronous and spawn-free by contract: this is how the daemon learns a credential's expiry
   * without launching the CLI, so it may be called from the dispatcher's path. Must never throw —
   * an unreadable or absent credential is `{present, expiresAt: null}`, never an exception — and
   * must never return the token or any part of it.
   */
  readCredential?(input: CredentialProbeInput): CredentialFacts;
  /**
   * Tools this runtime's own CLI exposes for scheduling a future turn inside its process (VS-317).
   * They cannot outlive the turn, so a worker that used one is never actually woken; the run engine
   * denies them on worker turns only. Omitted by an adapter whose CLI has no such tool, or whose
   * CLI offers no clean way to deny one.
   */
  workerDeniedTools?: string[];
  /** Directory names for skills per CLI, relative to the home. */
  skillsDir(): string;
  /** Instruction discovery file name at the home root (AGENTS.md, CLAUDE.md, GEMINI.md). */
  instructionFiles(): string[];
  /**
   * The bare interactive command that resumes `input.session` in a human's own terminal (VS-249).
   * Omitted by an adapter whose CLI has no interactive form to hand a session to, even when
   * `capabilities.resumableSessions` is true for the daemon's own (headless) resume. Pure: no I/O,
   * no spawning — the caller resolves the binary path with `launchCommand`.
   */
  resumeCommand?(input: ResumeCommandInput): ResumeCommand;
}
export * from './launch.js';
export * from './process.js';
export * from './containment.js';
export * from './testkit.js';
export * from './fsutil.js';
