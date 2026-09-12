import { z } from 'zod';
import type { JsonSchema } from '@weave-ai/channel-sdk';

export const TelegramConfigSchema = z.object({
  /**
   * Resolved by the config loader from an `${ENV_VAR}` reference in workspace.yaml, or absent
   * entirely when the token instead lives in the workspace secret store (VS-125) — the secret
   * store wins when both exist; see `resolveTelegramToken`.
   */
  botToken: z.string().min(1, 'botToken is required').optional(),
  allowedUserIds: z.array(z.number().int()).default([]),
  /** Only meaningful when `allowedUserIds` is empty: admit every Telegram user rather than none. */
  allowAll: z.boolean().default(false),
  apiBaseUrl: z.string().url().optional(),
  pollTimeoutSec: z.number().int().min(1).max(60).default(30),
});
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;

export const TELEGRAM_CONFIG_JSON_SCHEMA: JsonSchema = {
  type: 'object',
  required: [],
  additionalProperties: false,
  properties: {
    botToken: { type: 'string', description: 'Bot token; set from Settings (stored in the secret store) or as an ${ENV_VAR} reference in workspace.yaml' },
    allowedUserIds: { type: 'array', items: { type: 'integer' }, default: [], description: 'Telegram user ids allowed to talk to this workspace' },
    allowAll: { type: 'boolean', default: false, description: 'When allowedUserIds is empty, admit every Telegram user instead of none' },
    apiBaseUrl: { type: 'string', description: 'Override the Bot API base url (local Bot API server)' },
    pollTimeoutSec: { type: 'integer', minimum: 1, maximum: 60, default: 30 },
  },
};

/** An `${ENV_VAR}` reference the workspace loader could not resolve to a value. Shared with the precedence resolver and the allowlist migration so the definition of "resolved" cannot drift between them. */
export const UNRESOLVED_ENV_REF = /^\$\{[A-Z0-9_]+\}$/;

export function validateTelegramConfig(config: unknown): { ok: true; value: TelegramConfig } | { ok: false; errors: string[] } {
  const parsed = TelegramConfigSchema.safeParse(config);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
  }
  if (parsed.data.botToken !== undefined && UNRESOLVED_ENV_REF.test(parsed.data.botToken)) {
    return { ok: false, errors: ['botToken: unresolved ${ENV_VAR} reference (set the environment variable on the daemon host)'] };
  }
  return { ok: true, value: parsed.data };
}
