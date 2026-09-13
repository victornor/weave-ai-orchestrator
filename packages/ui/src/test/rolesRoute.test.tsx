import { describe, expect, it } from 'vitest';
import { router } from '../router';

describe('Roles route (VS-333)', () => {
  it('redirects the old /team address to /roles for the same workspace', async () => {
    await router.navigate({ to: '/w/$ws/team', params: { ws: 'alpha' } });
    expect(router.state.location.pathname).toBe('/w/alpha/roles');
  });
});
