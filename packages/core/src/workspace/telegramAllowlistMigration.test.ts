import { describe, expect, it } from 'vitest';
import { planTelegramAllowlistMigration } from './telegramAllowlistMigration.js';

describe('planTelegramAllowlistMigration', () => {
  it('no channels.telegram block at all: nothing to do', () => {
    expect(planTelegramAllowlistMigration(undefined, true)).toEqual({ patch: null, dropped: [] });
    expect(planTelegramAllowlistMigration(undefined, false)).toEqual({ patch: null, dropped: [] });
  });

  it('allowlist key never set, a token resolves: grandfathered to allowAll', () => {
    expect(planTelegramAllowlistMigration({ enabled: true }, true)).toEqual({ patch: { allowAll: true }, dropped: [] });
  });

  it('allowlist key never set, no token resolves: never reachable, not grandfathered', () => {
    expect(planTelegramAllowlistMigration({ enabled: true }, false)).toEqual({ patch: null, dropped: [] });
  });

  // This workspace's own config, verbatim, per the conductor's finding during review.
  it('{enabled: true, allowlist: []}, a token resolves: NOT grandfathered — the key is present', () => {
    expect(planTelegramAllowlistMigration({ enabled: true, allowlist: [] }, true)).toEqual({ patch: null, dropped: [] });
  });

  it('allowlist: [] with no resolvable token either: still not grandfathered', () => {
    expect(planTelegramAllowlistMigration({ allowlist: [] }, false)).toEqual({ patch: null, dropped: [] });
  });

  it('allowlist holds valid ids: migrated into allowedUserIds, not grandfathered', () => {
    expect(planTelegramAllowlistMigration({ allowlist: [111, 222] }, true)).toEqual({ patch: { allowedUserIds: [111, 222] }, dropped: [] });
  });

  it('allowedUserIds (already the right name) holds ids: left as a restriction, not grandfathered', () => {
    expect(planTelegramAllowlistMigration({ allowedUserIds: [111] }, true)).toEqual({ patch: { allowedUserIds: [111] }, dropped: [] });
  });

  it('a mix of valid and invalid entries: invalid ones dropped and reported, valid ones kept', () => {
    expect(planTelegramAllowlistMigration({ allowlist: [111, 'nope', 222, null] }, true)).toEqual({
      patch: { allowedUserIds: [111, 222] },
      dropped: ['nope', null],
    });
  });

  it('allowlist holds only invalid entries: nothing to migrate, not grandfathered', () => {
    expect(planTelegramAllowlistMigration({ allowlist: ['a', 'b'] }, true)).toEqual({ patch: null, dropped: ['a', 'b'] });
  });

  it('allowAll already set explicitly: already decided, left alone either way', () => {
    expect(planTelegramAllowlistMigration({ allowAll: true }, true)).toEqual({ patch: null, dropped: [] });
    expect(planTelegramAllowlistMigration({ allowAll: false }, true)).toEqual({ patch: null, dropped: [] });
  });
});
