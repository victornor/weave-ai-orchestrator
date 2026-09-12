/**
 * The daemon's own VAPID key pair for signing web push messages (VS-295). The daemon owns this key
 * — it is generated the first time it is needed and never asked of an operator. It is stored the
 * same way a workspace secret is (`createSecretStore`'s AES-256-GCM file, `0600`), just rooted at
 * the daemon's own config directory instead of a workspace's, because this key belongs to the whole
 * daemon rather than any one workspace. The public half may end up in `AppDeps.daemon.push`; the
 * private half never does — see `types.ts`'s `AppDeps.pushKeys` for why it stays off that type.
 */
import { join } from 'node:path';
// `web-push` is CJS; only `WebPushError` and `supportedContentEncodings` are statically detected
// as named ESM exports by Node's real cjs-module-lexer interop (confirmed by actually booting a
// daemon, not just the test suite's more permissive transform) — everything else, including this,
// has to come off the default import.
import webPush from 'web-push';
import { createSecretStore, getLogger } from '@weave-ai/core';

const log = getLogger('daemon', { component: 'push' });

const PUBLIC_KEY_NAME = 'vapidPublicKey';
const PRIVATE_KEY_NAME = 'vapidPrivateKey';

export interface PushKeys { publicKey: string; privateKey: string }

/**
 * The daemon's stored VAPID pair, generating and persisting one the first time either half is
 * missing. `null` only when the store itself could not be read or written (e.g. an unwritable
 * config directory) — key material failing SHALL NOT stop the daemon from starting.
 */
export function ensurePushKeys(configDir: string): PushKeys | null {
  try {
    const store = createSecretStore({ secretsFile: join(configDir, 'push-vapid.enc'), secretsKey: join(configDir, 'push-vapid.key') });
    const existingPublic = store.get(PUBLIC_KEY_NAME);
    const existingPrivate = store.get(PRIVATE_KEY_NAME);
    if (existingPublic && existingPrivate) return { publicKey: existingPublic, privateKey: existingPrivate };

    const generated = webPush.generateVAPIDKeys();
    store.put(PUBLIC_KEY_NAME, generated.publicKey);
    store.put(PRIVATE_KEY_NAME, generated.privateKey);
    return generated;
  } catch (e) {
    log.error({ err: e }, 'could not generate or load the VAPID key pair; push notifications will be unavailable');
    return null;
  }
}
