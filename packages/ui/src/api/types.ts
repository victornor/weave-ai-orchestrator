/**
 * Response shapes for docs/API.md. Entities come from @openconductor/shared;
 * these are the envelopes the HTTP layer wraps them in.
 */
import type {
  Agent,
  Briefing,
  Decision,
  KnowledgeFile,
  Project,
  Role,
  Run,
  RunEvent,
  Ticket,
  TicketComment,
  ThreadMessage,
  Workspace,
  CostStatus,
  UsageGrain,
  UsageWindow,
  AuthSessionKind,
} from '@openconductor/shared';

export interface Health {
  ok: boolean;
  version: string;
  workspaces: Array<{ id: string; name: string; status: string }>;
  operatorConfigured: boolean;
  tlsMode: string;
}

export interface LoginResponse {
  token?: string;
  sessionId?: string;
  expiresAt?: string;
  totpRequired?: boolean;
}

export interface AuthMe {
  operator: { username: string; createdAt?: string };
  session: { id: string; kind: AuthSessionKind; name?: string | null; expiresAt?: string };
  totpEnabled: boolean;
}

export interface AuthSession {
  id: string;
  name: string | null;
  kind: AuthSessionKind;
  ip: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  current?: boolean;
}

export interface TotpSetup {
  secret: string;
  otpauthUrl: string;
  recoveryCodes: string[];
}

export interface RuntimeInfo {
  id: string;
  displayName: string;
  detection: { available: boolean; version?: string | null; reason?: string | null };
  capabilities: Record<string, unknown>;
  models?: string[];
}

export interface WorkspaceSummary {
  workspace: Workspace;
  config: Record<string, unknown>;
  counts?: { projects: number; workers: number; openTickets: number; needsYou: number };
}

export interface TicketDetail {
  ticket: Ticket;
  project: Project | null;
  worker: Agent | null;
  role: Role | null;
  blockers: Ticket[];
  children: Ticket[];
  documents: Array<{ key: string; revision: number; updatedAt: string; title?: string }>;
  workProducts: WorkProduct[];
  openspecState: OpenSpecState | null;
  usage?: UsageTotals;
}

export interface WorkProduct {
  id: string;
  type: string;
  url: string | null;
  ref: string | null;
  state: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface OpenSpecState {
  changeName: string | null;
  state: string | null;
  tasks: Array<{ text: string; done: boolean }>;
  validated?: boolean;
}

export interface TicketDocument {
  key: string;
  revision: number;
  body: string;
  reason?: string | null;
  createdAt: string;
}

export interface DocumentRevision {
  revision: number;
  createdAt: string;
  authorKind: string;
  reason: string | null;
}

export interface WorkerDetail {
  agent: Agent;
  ticket: Ticket | null;
  role: Role | null;
  project: Project | null;
  lastRun: Run | null;
  usage: UsageTotals | null;
  worktree: { status: string; dirty: boolean; ahead: number; behind: number; path: string | null } | null;
  lastStatusLine?: string | null;
}

export interface RoleDetail {
  role: Role;
  charter: string;
  revisions: Array<{ revision: number; createdAt: string; reason: string | null }>;
  workers: Agent[];
  usage?: UsageTotals;
}

export interface RunDetail {
  run: Run;
  agent: Agent | null;
  ticket: Ticket | null;
  phases: Array<{ phase: string; durationMs: number }>;
  usage: UsageTotals | null;
}

export interface UsageTotals {
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  runs: number;
  workerTurns: number;
  durationMs: number;
  costCents: number | null;
  costStatus: CostStatus;
}

export interface UsagePoint extends UsageTotals {
  bucket: string;
}

export interface UsageSeries {
  scope: string;
  window: UsageWindow;
  grain: UsageGrain;
  start: string;
  end: string;
  series: UsagePoint[];
  total: UsageTotals;
  previous?: UsageTotals;
  reportedShare?: number;
}

export interface UsageTopRow {
  key: string;
  label: string;
  sublabel?: string | null;
  tokens: number;
  costCents: number | null;
  costStatus: CostStatus;
  share?: number;
}

export interface UsageModelRow extends UsageTopRow {
  model: string;
  series?: UsagePoint[];
}

export interface KnowledgeIndex {
  files: Array<KnowledgeFile & { title?: string; projectSlug?: string | null; curationDueInDays?: number | null }>;
  warnings: string[];
}

export interface KnowledgeDoc {
  path: string;
  scope: string;
  body: string;
  tokenEstimate: number;
  budgetTokens: number;
  lastCuratedAt: string | null;
  curationPending: boolean;
  revision?: number;
}

export interface KnowledgeRevision {
  revision: number;
  createdAt: string;
  reason: string;
  tokenEstimate: number;
}

export interface SearchHit {
  kind: 'capability' | 'requirement' | 'change' | 'knowledge';
  projectId: string | null;
  projectSlug: string | null;
  title: string;
  subtitle: string | null;
  href: { capability?: string; change?: string; scope?: string };
  snippet?: string | null;
}

export interface CapabilitySummary {
  capability: string;
  title: string;
  requirementCount: number;
  updatedAt: string;
  pendingChanges: Array<{ changeName: string; ticketId: string | null; ticketIdentifier: string | null; deltaKind: string }>;
}

export interface Requirement {
  id: string;
  name: string;
  text: string;
  scenarios: Array<{ text: string; steps?: Array<{ word: string; text: string }> }>;
  delta?: { kind: 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED'; changeName: string; ticketIdentifier: string | null; state: string } | null;
}

export interface CapabilityDetail {
  capability: CapabilitySummary;
  requirements: Requirement[];
  history: Array<{ changeName: string; ticketIdentifier: string | null; prUrl: string | null; archivedAt: string | null; state: string }>;
}

export interface SpecChangeSummary {
  changeName: string;
  state: 'active' | 'archived';
  ticketId: string | null;
  ticketIdentifier: string | null;
  createdAt: string;
  archivedAt: string | null;
  capabilities: Array<{ capability: string; deltaKind: string }>;
  taskProgress?: { done: number; total: number };
}

export interface SpecChangeDetail extends SpecChangeSummary {
  proposal: string | null;
  design: string | null;
  tasks: Array<{ text: string; done: boolean }>;
  deltas: Array<{ capability: string; kind: string; body: string }>;
}

export interface SpecGraph {
  nodes: Array<{ id: string; kind: 'capability' | 'change' | 'ticket'; label: string; status?: string | null; updatedAt?: string | null }>;
  edges: Array<{ from: string; to: string; kind: string }>;
}

export interface ThreadSummary {
  id: string;
  channelId: string;
  agentId: string;
  ticketId: string | null;
  humanLabel: string | null;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface ThreadMessagesPage {
  messages: ThreadMessage[];
  hasMore?: boolean;
}

export interface PresentationConfig {
  surface: string | null;
  available: Array<{ id: string; displayName: string; detection: { available: boolean; reason?: string | null } }>;
  blocks?: unknown;
}

export type { Agent, Briefing, Decision, Project, Role, Run, RunEvent, Ticket, TicketComment, ThreadMessage, Workspace };
