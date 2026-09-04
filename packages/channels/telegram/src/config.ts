import { z } from 'zod';
import type { JsonSchema } from '@openconductor/channel-sdk';

export const TelegramConfigSchema = z.object({
  /** Resolved by the config loader from an `${ENV_VAR}` reference in workspace.yaml. */
  botToken: z.string().min(1, 'botToken is required'),
  allowedUserIds: z.array(z.number().int()).default([]),
  apiBaseUrl: z.string().url().optional(),
  pollTimeoutSec: z.number().int().min(1).max(60).default(30),
});
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;

export const TELEGRAM_CONFIG_JSON_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['botToken'],
  additionalProperties: false,
  properties: {
    botToken: { type: 'string', description: 'Bot token; in workspace.yaml write it as an ${ENV_VAR} reference' },
    allowedUserIds: { type: 'array', items: { type: 'integer' }, default: [], description: 'Telegram user ids allowed to talk to this workspace' },
    apiBaseUrl: { type: 'string', description: 'Override the Bot API base url (local Bot API server)' },
    pollTimeoutSec: { type: 'integer', minimum: 1, maximum: 60, default: 30 },
  },
};

export function validateTelegramConfig(config: unknown): { ok: true; value: TelegramConfig } | { ok: false; errors: string[] } {
  const parsed = TelegramConfigSchema.safeParse(config);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
  }
  if (/^\$\{[A-Z0-9_]+\}$/.test(parsed.data.botToken)) {
    return { ok: false, errors: ['botToken: unresolved ${ENV_VAR} reference (set the environment variable on the daemon host)'] };
  }
  return { ok: true, value: parsed.data };
}
