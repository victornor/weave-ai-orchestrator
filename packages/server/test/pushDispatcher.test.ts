/**
 * `PushDispatcher` (VS-295): the caller wired to `decision.created`, filtered exactly like
 * `ChannelManager.pushDecisionCard` (`owner === 'human' && status === 'open'`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeHarness, type Harness } from './fakes.js';

const sendPush = vi.fn().mockResolvedValue({ sent: 0, skipped: 0 });
vi.mock('../src/push.js', () => ({ sendPush }));

const { PushDispatcher } = await import('../src/pushDispatcher.js');

let harness: Harness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
  sendPush.mockClear();
});

function fakeDecision(overrides: Partial<{ owner: string; status: string }> = {}): Record<string, unknown> {
  return { id: 'dec1', title: 'Approve X', context: 'It needs a yes', owner: 'human', status: 'open', ...overrides };
}

describe('PushDispatcher', () => {
  it('sends a push for a human-owned open decision', async () => {
    harness = makeHarness();
    harness.impls['decisions']!.get = vi.fn().mockReturnValue(fakeDecision());
    const dispatcher = new PushDispatcher(harness.runtime.ctx, harness.runtime.services, () => null);
    dispatcher.start();

    harness.bus.emit('decision.created', 'decision', 'dec1', {});
    await vi.waitFor(() => expect(sendPush).toHaveBeenCalledTimes(1));

    expect(sendPush).toHaveBeenCalledWith(harness.runtime.ctx.db, null, 'decisions', {
      title: 'Approve X',
      body: 'It needs a yes',
      path: `/w/${harness.runtime.ctx.config.id}/needs`,
    });
    // VS-456: the deep link is a root path, never the retired `/v2` one.
    const { path } = sendPush.mock.calls[0]?.[3] as { path: string };
    expect(path.startsWith('/w/')).toBe(true);
    expect(path).not.toContain('/v2');
    dispatcher.stop();
  });

  it('does not send for a decision owned by the weaver', async () => {
    harness = makeHarness();
    harness.impls['decisions']!.get = vi.fn().mockReturnValue(fakeDecision({ owner: 'weaver' }));
    const dispatcher = new PushDispatcher(harness.runtime.ctx, harness.runtime.services, () => null);
    dispatcher.start();

    harness.bus.emit('decision.created', 'decision', 'dec1', {});
    await new Promise((r) => setTimeout(r, 20));

    expect(sendPush).not.toHaveBeenCalled();
    dispatcher.stop();
  });

  it('does not send for a decision that is not open', async () => {
    harness = makeHarness();
    harness.impls['decisions']!.get = vi.fn().mockReturnValue(fakeDecision({ status: 'answered' }));
    const dispatcher = new PushDispatcher(harness.runtime.ctx, harness.runtime.services, () => null);
    dispatcher.start();

    harness.bus.emit('decision.created', 'decision', 'dec1', {});
    await new Promise((r) => setTimeout(r, 20));

    expect(sendPush).not.toHaveBeenCalled();
    dispatcher.stop();
  });

  it('stops reacting once stopped', async () => {
    harness = makeHarness();
    harness.impls['decisions']!.get = vi.fn().mockReturnValue(fakeDecision());
    const dispatcher = new PushDispatcher(harness.runtime.ctx, harness.runtime.services, () => null);
    dispatcher.start();
    dispatcher.stop();

    harness.bus.emit('decision.created', 'decision', 'dec1', {});
    await new Promise((r) => setTimeout(r, 20));

    expect(sendPush).not.toHaveBeenCalled();
  });

  it('a failure delivering does not throw past the dispatcher', async () => {
    harness = makeHarness();
    harness.impls['decisions']!.get = vi.fn().mockReturnValue(fakeDecision());
    sendPush.mockRejectedValueOnce(new Error('network down'));
    const dispatcher = new PushDispatcher(harness.runtime.ctx, harness.runtime.services, () => null);
    dispatcher.start();

    expect(() => harness!.bus.emit('decision.created', 'decision', 'dec1', {})).not.toThrow();
    await vi.waitFor(() => expect(sendPush).toHaveBeenCalledTimes(1));
    dispatcher.stop();
  });
});
