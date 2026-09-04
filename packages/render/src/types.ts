/** View models produced by this package. The web widget layer and the TUI widget layer render these and nothing else. */
import type { DecisionKind, DecisionStatus, TicketKind, TicketPriority, TicketStatus, UiStatus, AgentStatus, CostStatus } from '@openconductor/shared';

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
  worktree: WorktreeView | null;
  runtime: string;
  model: string | null;
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
  /** Ticket identifier or decision id, for `oc decision show <ref>` style follow-ups. */
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
