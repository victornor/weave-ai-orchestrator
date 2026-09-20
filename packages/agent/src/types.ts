/** The agent's own message form. Sessions store this, never the wire JSON, so a later slice can re-encode it for another provider. */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'toolCall'; id: string; name: string; args: unknown; raw?: string };

export type Message =
  | { role: 'user'; text: string }
  | { role: 'assistant'; content: ContentBlock[]; model?: string }
  | { role: 'toolResult'; toolCallId: string; name: string; text: string; isError: boolean };

export interface Usage { promptTokens: number; completionTokens: number; cachedTokens: number; reasoningTokens: number; estimated: boolean }

export type ErrorFamily = 'transient_upstream' | 'provider_quota' | 'model_refusal' | 'auth' | 'tooling' | 'resource' | 'unknown';
export interface AgentError { code: string; family: ErrorFamily; message: string; retryAfterMs?: number; status?: number; /** Cap on retries for this failure, below the loop's default. */ maxRetries?: number }
