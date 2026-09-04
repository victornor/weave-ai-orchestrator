import type { Registries } from '../context.js';
import { GitWorktreeProvider } from './git.js';
import { WorktrunkProvider } from './worktrunk.js';

export { GitWorktreeProvider } from './git.js';
export { WorktrunkProvider } from './worktrunk.js';
export { landedWorkTest, type LandedInput, type LandedVerdict } from './landed.js';
export { renderWtConfig, writeWtConfig } from './wtconfig.js';

/** Register the built-in worktree providers. Plugins may register more (and may not replace these). */
export function registerBuiltinWorktreeProviders(registries: Registries): void {
  if (!registries.worktreeProviders.has('worktrunk')) registries.worktreeProviders.set('worktrunk', new WorktrunkProvider());
  if (!registries.worktreeProviders.has('git')) registries.worktreeProviders.set('git', new GitWorktreeProvider());
}
