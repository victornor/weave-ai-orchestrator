import type { ProviderCompat, ProviderParams } from '@weave-ai/shared';
import type { AgentError } from './types.js';

/** Child protocol v1: newline-delimited JSON. stdout carries only the child-to-adapter messages below. */
export const PROTOCOL_VERSION = 1;

export interface InitMessage {
  type: 'init';
  v: 1;
  run: {
    runId: string; turnEpoch: number; cwd: string; worktree: { path: string; branch: string } | null;
    limits: { timeoutMs: number; maxTurns?: number };
    permission: { mode: 'auto' | 'restricted' | 'bypass'; allowedTools?: string[]; deniedTools?: string[]; firstTurn?: boolean };
    model: string; effort?: string | null; options: Record<string, unknown>;
    /** Per-run scratch directory outside the worktree: bash output spill goes here. */
    spillDir: string;
  };
  provider: { id: string; baseUrl: string; auth: string; headers: Record<string, string>; query?: Record<string, string>; apiKey?: string; /** Resolved by the adapter (preset < profile < model < option); the child never sees the layers. */ compat?: ProviderCompat; params?: ProviderParams & { contextWindowTokens?: number }; timeouts?: { idleMs?: number } };
  prompt: string;
  systemPrompt: { text: string; mode: 'inject' | 'skip' };
  session: { path: string; id: string };
  mcpServers: Record<string, { url: string; headers?: Record<string, string> }>;
  toolEnv: Record<string, string>;
}
export type ParentMessage = InitMessage | { type: 'send'; text: string } | { type: 'cancel'; mode: 'interrupt' | 'kill' };

export interface ChildEvent { ts: string; type: string; payload: Record<string, unknown> }
export interface ChildPartial { kind: 'text' | 'thinking' | 'tool_input'; partId: string; messageId?: string; toolCallId?: string; text: string }
export interface ChildResult {
  exitCode: number | null; signal: string | null; timedOut: boolean;
  session: { v: 1; id: string; path: string; leafId: string | null } | null;
  finalText: string | null;
  usage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number; contextTokens?: number; basis: 'per_turn'; firstRequest?: { freshTokens: number; cachedTokens: number } };
  model?: string; provider?: string;
  error?: AgentError;
}
export type ChildMessage =
  | { t: 'event'; ev: ChildEvent }
  | { t: 'partial'; p: ChildPartial }
  | { t: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; msg: string; fields?: Record<string, unknown> }
  | { t: 'result'; result: ChildResult };

/** Parse one stdin line from the adapter, or null when it is not a message this child understands. */
export function parseParentLine(line: string): ParentMessage | null {
  let m: unknown;
  try { m = JSON.parse(line); } catch { return null; }
  if (typeof m !== 'object' || m === null) return null;
  const type = (m as { type?: unknown }).type;
  if (type === 'init' && (m as { v?: unknown }).v === PROTOCOL_VERSION) return m as InitMessage;
  if (type === 'send' && typeof (m as { text?: unknown }).text === 'string') return m as ParentMessage;
  if (type === 'cancel') return { type: 'cancel', mode: (m as { mode?: unknown }).mode === 'kill' ? 'kill' : 'interrupt' };
  return null;
}
