/**
 * VS-125 pure decision logic for the one-time telegram allowlist migration. The loader supplies the
 * *raw* (pre-Zod) `channels.telegram` block as it was on disk, and whether a bot token actually
 * resolves for this workspace right now; this module decides what, if anything, changes.
 *
 * An allowlist the human never touched — not present under either its old dead name (`allowlist`)
 * or the name the channel reads (`allowedUserIds`) — on a workspace that already had a working
 * token means the channel was already open to every Telegram user; that state is carried forward
 * once as an explicit `allowAll: true` so it does not go silently deaf under the new default.
 *
 * An allowlist the human *did* touch, even by setting it to `[]`, is evidence of an intent to
 * restrict, not evidence of nothing — caught against this very daemon's own config during review
 * (`{enabled: true, allowlist: []}`, which a value-only check would have wrongly opened). Its ids,
 * if any, are carried forward into `allowedUserIds` rather than discarded or treated as grounds to
 * grandfather the channel open.
 */

export interface TelegramAllowlistMigrationPlan {
  /** `null` when nothing about this workspace's config needs to change. */
  patch: { allowAll: true } | { allowedUserIds: number[] } | null;
  /** Raw allowlist entries that were not a valid Telegram user id, dropped rather than kept. */
  dropped: unknown[];
}

const NO_CHANGE: TelegramAllowlistMigrationPlan = { patch: null, dropped: [] };

/** A Telegram user id, from a number or a numeric string — `null`, `false`, `""` and the like are never one. */
function readTelegramUserId(entry: unknown): number | null {
  if (typeof entry === 'number') return Number.isInteger(entry) ? entry : null;
  if (typeof entry === 'string' && /^-?\d+$/.test(entry.trim())) return Number(entry.trim());
  return null;
}

export function planTelegramAllowlistMigration(
  rawTelegram: Record<string, unknown> | undefined,
  hasResolvableToken: boolean,
): TelegramAllowlistMigrationPlan {
  if (!rawTelegram) return NO_CHANGE;

  const allowlistKey = 'allowlist' in rawTelegram ? 'allowlist' : 'allowedUserIds' in rawTelegram ? 'allowedUserIds' : null;
  if (allowlistKey) {
    const raw = rawTelegram[allowlistKey];
    const entries = Array.isArray(raw) ? raw : [];
    const kept: number[] = [];
    const dropped: unknown[] = [];
    for (const entry of entries) {
      const id = readTelegramUserId(entry);
      if (id !== null) kept.push(id); else dropped.push(entry);
    }
    // An allowlist set to `[]` (or to only unreadable entries) is still evidence of intent to
    // restrict — it is left empty, not grandfathered, and there is nothing to patch for it.
    return { patch: kept.length ? { allowedUserIds: kept } : null, dropped };
  }

  if ('allowAll' in rawTelegram) return NO_CHANGE; // already decided, one way or the other
  if (!hasResolvableToken) return NO_CHANGE; // never reachable — nothing to protect
  return { patch: { allowAll: true }, dropped: [] };
}
