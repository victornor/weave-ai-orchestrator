/**
 * VS-659: the form in which an image attachment can reach a run's model.
 *
 * A runtime declares its image-input capability (`RuntimeCapabilities.imageInput`): `native` — an MCP
 * `image` content block is rendered to the model; `path` — it is not, so the daemon gives a readable
 * file path; `model` — it depends on the run's provider profile, and the built-in `weave` runtime
 * delivers an image unless the profile turns it off (`compat.image.input: none`). Decided once per
 * turn by the engine and carried on the run token, so the turn prompt and `weave_inbox` cannot
 * disagree.
 */
import type { WorkspaceContext } from '../context.js';
import { effectiveProviders } from '../scoped.js';

export type ImageAttachmentForm = 'native' | 'path';

/**
 * The form an image attachment takes on this run. A runtime that declares nothing is `path` — the
 * safe form that never silently drops an image.
 */
export function imageAttachmentForm(
  ctx: Pick<WorkspaceContext, 'registries' | 'daemon'>,
  runtimeId: string,
  model: string | null | undefined,
): ImageAttachmentForm {
  const declared = ctx.registries.runtimes.get(runtimeId)?.capabilities.imageInput ?? 'path';
  if (declared !== 'model') return declared;
  return profileImageInput(ctx, model) === 'none' ? 'path' : 'native';
}

/**
 * The image-input mode a run's `providerId/modelId` resolves to, from the daemon provider profile and
 * its per-model override. The built-in codec's own default when neither declares anything is `user`
 * (images are delivered), so a profile opts out only by declaring `none`; no shipped preset declares
 * it otherwise.
 */
export function profileImageInput(
  ctx: Pick<WorkspaceContext, 'daemon'>,
  model: string | null | undefined,
): 'none' | 'user' | 'user_and_tool' {
  if (typeof model !== 'string') return 'user';
  const i = model.indexOf('/');
  if (i <= 0 || i === model.length - 1) return 'user';
  const profile = effectiveProviders(ctx)[model.slice(0, i)];
  const modelId = model.slice(i + 1);
  return profile?.models?.[modelId]?.compat?.image?.input ?? profile?.compat?.image?.input ?? 'user';
}