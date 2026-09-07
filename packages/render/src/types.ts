/** View models produced by this package. The web widget layer and the TUI widget layer render these and nothing else. */
import type { BillingType, DecisionKind, DecisionStatus, TicketKind, TicketPriority, TicketStatus, UiStatus, AgentStatus, CostStatus } from '@agent-conductor/shared';

// ---------------------------------------------------------------- transcript

export type TranscriptBlockKind = 'text' | 'thinking' | 'tool' | 'file' | 'status' | 'phase' | 'error';

export interface TranscriptBlockBase {
  /** Stable across re-renders: derived from the first run event folded into the block. */
  id: string;
  kind: TranscriptBlockKind;
  /** ISO timestamp of the first event in the block. */
  ts: string;
  /** Sequence of the first event in the block; blocks are always ordered by this. */
  seq: number;
  /** Every run event id folded into this block, for "show raw" affordances. */
  eventIds: string[];
}

export interface TextBlock extends TranscriptBlockBase {
  kind: 'text' | 'thinking';
  text: string;
}

export interface ToolBlock extends TranscriptBlockBase {
  kind: 'tool';
  name: string;
  /** The one thing the tool acted on: a path, a command, a pattern, a url. */
  target: string | null;
  status: 'pending' | 'ok' | 'error' | 'denied';
  durationMs: number | null;
  /** One line shown when collapsed, without the leading glyph: `Read src/theme/tokens.ts 0.4s`. */
  collapsed: string;
  /** Result body shown when expanded; already redacted and truncated. */
  detail: string | null;
  detailTruncated: boolean;
  /** `+18 −2` when the tool reported a diff stat. */
  diffStat: string | null;
}

export interface FileBlock extends TranscriptBlockBase {
  kind: 'file';
  path: string;
  changeType: 'created' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  diffStat: string | null;
  /** Unified-diff-ish body when the runtime gave us one; already redacted and truncated. */
  diff: string | null;
  diffTruncated: boolean;
  collapsed: string;
}

export interface StatusBlock extends TranscriptBlockBase {
  kind: 'status';
  text: string;
  tone: 'info' | 'warn' | 'error';
  /** Optional expandable body (a proposed plan, a supervisor rationale). */
  detail: string | null;
}

export interface PhaseBlock extends TranscriptBlockBase {
  kind: 'phase';
  phase: string;
  durationMs: number | null;
  tokens: number | null;
  /** `phase: implementing · 4m12s · 18.4k tok` */
  text: string;
}

export interface ErrorBlock extends TranscriptBlockBase {
  kind: 'error';
  code: string | null;
  message: string;
  retryable: boolean;
}

export type TranscriptBlock = TextBlock | ToolBlock | FileBlock | StatusBlock | PhaseBlock | ErrorBlock;

export interface TranscriptOptions {
  /** Default true. Set false only where the consumer redacts itself. */
  redact?: boolean;
  /** Cap on tool output / diff bodies kept in the model. Default 4000 characters. */
  maxDetailChars?: number;
  /** Used for "waiting 2m" style status lines. */
  now?: Date;
}

// ---------------------------------------------------------------- decision cards

export type CardVariant = 'plan_approval' | 'merge_approval' | 'hire_approval' | 'question' | 'discard_approval' | 'approval' | 'gate_finding';

export interface CardOption {
  key: string;
  label: string;
  description: string | null;
  recommended: boolean;
  tone: 'primary' | 'default' | 'danger';
  /** One-line consequence shown under the option in the question variant. */
  consequence: string | null;
}

export interface CardBodyLine {
  label: string | null;
  value: string;
  /** `link` renders as a url, `mono` as a machine value, `text` as prose. */
  format: 'text' | 'mono' | 'link' | 'diff';
}

export interface CardModel {
  id: string;
  kind: DecisionKind;
  variant: CardVariant;
  /** Always "Needs you" for human-owned decisions, "Conductor" for conductor-owned ones. */
  header: string;
  title: string;
  /** `ACME-42 · api` */
  subtitle: string | null;
  /** The one-line rationale under the title. */
  rationale: string | null;
  body: CardBodyLine[];
  options: CardOption[];
  allowFreeText: boolean;
  freeTextLabel: string | null;
  /** Destructive variants require the human to type this exact string. */
  confirm: { expect: string; prompt: string } | null;
  destructive: boolean;
  status: DecisionStatus;
  uiStatus: UiStatus;
  ticketId: string | null;
  createdAt: string;
  age: string;
  /** Set once answered, so an answered card still reads correctly in history. */
  answer: { key: string | null; text: string | null; at: string | null } | null;
  /**
   * The decision collects values this surface cannot take (VS-92) — a secret cannot be typed into
   * a chat message, and a channel has no controls for a multi-select. A surface that sees this
   * shows the question and points at the web app rather than offering an answer it cannot complete.
   */
  answerElsewhere: boolean;
}

// ---------------------------------------------------------------- tickets / workers

export interface TicketSummary {
  id: string;
  identifier: string;
  title: string;
  kind: TicketKind;
  status: TicketStatus;
  uiStatus: UiStatus;
  glyph: string;
  priority: TicketPriority;
  project: string | null;
  worker: string | null;
  autoMerge: boolean;
  age: string;
  tokens: string | null;
  cost: string | null;
  /** `ACME-42 · 18.4k tok · $0.41` */
  meta: string;
  /** One dense row for tables and chips. */
  line: string;
}

export interface WorktreeView {
  status: string;
  dirty: boolean;
  ahead: number;
  behind: number;
  /** `● dirty ↑3 ↓0` */
  label: string;
}

export interface WorkerCardModel {
  id: string;
  name: string;
  initials: string;
  kind: 'conductor' | 'worker';
  role: string | null;
  project: string | null;
  ticket: { id: string; identifier: string; title: string } | null;
  status: AgentStatus;
  uiStatus: UiStatus;
  glyph: string;
  statusLabel: string;
  /** `running vitest — 38/41 passed` */
  lastLine: string | null;
  /** Why a paused worker stopped: `provider_quota · limit resets in 2 hours · resets 2026-09-05 14:30 UTC`. Null unless it is paused. */
  pauseReason: string | null;
  worktree: WorktreeView | null;
  /** The runtime the agent is on, from the workspace model setting that governs it. */
  runtime: string;
  turn: number;
  tokens: string | null;
  cost: string | null;
  meta: string;
  /** OSC window title: `<name> · <ticket> · <status>` (PLAN §14b.3). */
  windowTitle: string;
}

// ---------------------------------------------------------------- briefing

export type BriefingSectionKey = 'needs-you' | 'landed' | 'underway' | 'queued';

export interface BriefingItem {
  id: string;
  uiStatus: UiStatus;
  glyph: string;
  primary: string;
  secondary: string | null;
  meta: string | null;
  /** Ticket identifier or decision id, for `conductor decision show <ref>` style follow-ups. */
  ref: string | null;
}

export interface BriefingSection {
  key: BriefingSectionKey;
  title: string;
  count: number;
  empty: boolean;
  /** Shown instead of items when empty; never blank (design contract §4). */
  emptyLine: string;
  items: BriefingItem[];
}

export interface BriefingSections {
  headline: string;
  /** Always four sections, always in this order. */
  sections: [BriefingSection, BriefingSection, BriefingSection, BriefingSection];
  warnings: string[];
  generatedAt: string;
}

// ---------------------------------------------------------------- usage

/** One plan limit window, ready to draw: a label, a percentage and when it resets. */
export interface AccountLimitWindowView { key: string; label: string; percent: number; resetsIn: string | null }
/** One runtime account's plan block (design contract: replaces the cost tile on a subscription). */
export interface AccountLimitsView {
  runtimeId: string;
  billingType: BillingType;
  /** The plan label the runtime reported, or a plain-language stand-in for the billing mode. */
  plan: string;
  limitsAvailable: boolean;
  windows: AccountLimitWindowView[];
  /** Why there are no windows, when there are none. */
  note: string | null;
  /**
   * The probe could not describe this account at all, as opposed to describing it and finding no
   * windows. The note is then a failure to show, not a property of the plan.
   */
  probeFailed: boolean;
  /** How long ago the snapshot was captured: `2m ago`. */
  age: string;
}

/**
 * The one-line plan meter a chat header carries for a single runtime: the session window and its
 * countdown to reset, or the single quiet reason there is no meter to draw. Null from
 * `runtimeLimitStrip` — the caller renders nothing at all — when the runtime is metered or has no
 * snapshot yet, because neither has a plan window a header could be about.
 */
export interface RuntimeLimitStripView {
  runtimeId: string;
  /** The plan label the runtime reported, or a stand-in for the billing mode. */
  plan: string;
  /**
   * The window to show in the header: the session window when the runtime reports one, otherwise
   * the first window it does report. Null when there is no window to draw, and `reason` says why.
   * `resetsIn` is the bare countdown (`2h 10m`), not the `resets in …` phrase the usage view uses.
   */
  meter: { label: string; percent: number; resetsIn: string | null; tone: 'ok' | 'warn' | 'over' } | null;
  /** The single quiet line shown in place of a meter: `Account probe failed` · `Limits unavailable`. */
  reason: string | null;
  /** The runtime's own explanation of `reason`, when it gave one. */
  note: string | null;
  /** How long ago the snapshot was captured: `2m ago`. */
  age: string;
  /** The raw capture time, for the title a hover reads. */
  capturedAt: string;
}

/**
 * How full the conductor's context is, for the same header strip the plan meter sits in. Null from
 * `contextStrip` when the agent has not run yet and there is simply nothing to measure; `reason`
 * with no `meter` when it has run but the runtime did not report enough to compute a fraction.
 */
export interface ContextStripView {
  /** Tokens in the window right now: the last turn's input plus what it read back from cache. */
  tokens: number;
  /** `82k` — the count a hover shows. */
  tokensLabel: string;
  /** `200k` — the window it is a fraction of. */
  windowLabel: string;
  meter: {
    /** Percentage of the model's context window, 0..100. */
    percent: number;
    /** Percentage of the way to the runtime's compaction point; null when the runtime has none. */
    toCompaction: number | null;
    tone: 'ok' | 'warn' | 'over';
  } | null;
  /** The single quiet line shown in place of a meter. */
  reason: string | null;
}

export interface UsageTotalsView {
  tokens: string;
  tokensIn: string;
  tokensOut: string;
  tokensCached: string;
  cost: string;
  costStatus: CostStatus;
  reportedShare: string | null;
  runs: number;
  /** Window-over-window deltas. */
  tokensDelta: string;
  costDelta: string;
}
