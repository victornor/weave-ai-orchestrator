/**
 * OpenCode account description (PLAN §16.2). OpenCode routes to whichever provider its keys belong
 * to and has no plan concept at all, so dollar cost stays the right metric for it and there is
 * nothing to probe: the answer is static.
 */
import type { AccountDescription } from '@agent-conductor/runtime-sdk';

export function describeOpenCodeAccount(): AccountDescription {
  return {
    billingType: 'metered_api',
    planLabel: null,
    limitsAvailable: false,
    limits: [],
    note: 'opencode: usage is billed through the configured provider keys, so there are no plan limits to report',
  };
}
