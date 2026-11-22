/**
 * agy account description: billing mode only. agy's login lives in the OS keyring (or, with no
 * D-Bus session bus, a file in its app-data dir), so there is no file to read an expiry from and
 * nothing is spawned here. `GEMINI_API_KEY` in the run's env switches agy to the metered Gemini API.
 */
import type { AccountDescription, AccountProbeInput } from '@weave-ai/runtime-sdk';

const NO_LIMITS = 'agy: the Antigravity subscription exposes no limit windows to a headless run';

export function describeAgyAccount(input: AccountProbeInput): AccountDescription {
  const base = { planLabel: null, limitsAvailable: false, limits: [], note: NO_LIMITS };
  if (input.env['GEMINI_API_KEY']) return { ...base, billingType: 'metered_api' };
  return { ...base, billingType: 'subscription_included' };
}
