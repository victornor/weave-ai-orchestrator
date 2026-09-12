/**
 * Cursor account description (PLAN §16.2). Print mode exposes no plan-limit windows, so this
 * reports billing mode only from which credential is present — never from file contents.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AccountDescription, AccountProbeInput } from '@weave-ai/runtime-sdk';

const NO_LIMITS = 'cursor: the CLI does not expose plan-limit windows to a non-interactive run';

export function describeCursorAccount(input: AccountProbeInput): AccountDescription {
  const base: Omit<AccountDescription, 'billingType'> = { planLabel: null, limitsAvailable: false, limits: [], note: NO_LIMITS };
  if (input.env['CURSOR_API_KEY']) return { ...base, billingType: 'metered_api' };
  if (input.configHome && existsSync(join(input.configHome, 'auth.json'))) return { ...base, billingType: 'subscription_included' };
  return { ...base, billingType: 'unknown', note: 'cursor: no credentials found in the workspace runtime home' };
}
