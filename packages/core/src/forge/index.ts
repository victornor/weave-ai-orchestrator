import type { Registries } from '../context.js';
import { GhForge } from './gh.js';
export { GhForge } from './gh.js';

export function registerBuiltinForges(registries: Registries): void {
  if (!registries.forges.has('github')) registries.forges.set('github', new GhForge());
}
