import { projectLabel, type Project } from '@weave-ai/shared';

/**
 * A project's display label for a knowledge payload that carries only a project id or slug
 * (VS-330): resolve against the projects the app already has loaded, else fall back to the slug the
 * payload named. `projectLabel` itself covers the case where the whole project is in hand.
 */
export function projectLabelFor(
  projects: readonly Project[] | undefined,
  ref: { id?: string | null; slug?: string | null },
): string | null {
  const list = projects ?? [];
  const match = (ref.id ? list.find((p) => p.id === ref.id) : undefined) ?? (ref.slug ? list.find((p) => p.slug === ref.slug) : undefined);
  return match ? projectLabel(match) : (ref.slug ?? null);
}
