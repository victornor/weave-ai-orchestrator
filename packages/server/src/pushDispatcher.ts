/**
 * The caller VS-286's scout found missing: this is what turns a human-owned decision being
 * created into an actual push. One instance per workspace, started and stopped alongside
 * `ChannelManager` and `WebhookDispatcher` — its `decision.created` filter mirrors
 * `ChannelManager.pushDecisionCard`'s (`owner === 'human' && status === 'open'`) exactly, because
 * that is the same "does this need the human" moment Needs you and the unread badge already read.
 */
import type { CoreServices, WorkspaceContext } from '@weave-ai/core';
import { getLogger } from '@weave-ai/core';
import type { WorkspaceEvent } from '@weave-ai/shared';
import { sendPush } from './push.js';
import type { PushKeys } from './vapid.js';

const log = getLogger('daemon', { component: 'push' });

export class PushDispatcher {
  private unsubscribe: (() => void) | null = null;

  constructor(private ctx: WorkspaceContext, private services: CoreServices, private getKeys: () => PushKeys | null) {}

  start(): void {
    this.unsubscribe = this.ctx.events.on((ev) => { void this.onEvent(ev); });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private async onEvent(ev: WorkspaceEvent): Promise<void> {
    if (ev.type !== 'decision.created') return;
    try {
      const decision = this.services.decisions.get(ev.entityId);
      if (decision.owner !== 'human' || decision.status !== 'open') return;
      await sendPush(this.ctx.db, this.getKeys(), 'decisions', {
        title: decision.title,
        body: decision.context || decision.title,
        path: `/w/${this.ctx.config.id}/needs`,
      });
    } catch (e) {
      log.warn({ err: e, decisionId: ev.entityId }, 'could not deliver a push for a decision');
    }
  }
}
