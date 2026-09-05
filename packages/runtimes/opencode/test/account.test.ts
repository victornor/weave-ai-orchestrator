import { describe, expect, it } from 'vitest';
import { adapter } from '../src/adapter.js';
import { describeOpenCodeAccount } from '../src/account.js';

describe('describeOpenCodeAccount', () => {
  it('reports provider-key billing with no plan limits, so dollar cost stays its metric', () => {
    const acc = describeOpenCodeAccount();
    expect(acc).toMatchObject({ billingType: 'metered_api', planLabel: null, limitsAvailable: false, limits: [] });
    expect(acc.note).toMatch(/provider keys/);
  });

  it('is reachable through the adapter', async () => {
    expect(await adapter.describeAccount?.({ env: {}, timeoutMs: 1000 })).toMatchObject({ billingType: 'metered_api' });
  });
});
