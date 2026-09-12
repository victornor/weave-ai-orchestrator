/**
 * `weave doctor --install`: the opt-in installer for missing tools (PLAN §20). Pure planning here so it
 * is testable; the doctor command runs the plan. Nothing here ever runs `sudo` — package-manager
 * installs that need root are printed for the human to run.
 */

export type InstallableId = 'openspec' | 'wt' | 'gh' | 'claude' | 'codex' | 'opencode' | 'gemini';

export interface InstallStep {
  id: InstallableId;
  /** argv to run, or null when the human has to run `manual` themselves (needs root, no installer found). */
  command: string[] | null;
  manual: string;
  why: string;
}

export interface HostFacts {
  platform: NodeJS.Platform;
  /** Which helper binaries exist on PATH. */
  has(binary: string): boolean;
}

const NPM_PACKAGES: Record<Exclude<InstallableId, 'wt' | 'gh'>, string> = {
  openspec: '@fission-ai/openspec',
  claude: '@anthropic-ai/claude-code',
  codex: '@openai/codex',
  opencode: 'opencode-ai',
  gemini: '@google/gemini-cli',
};

const WHY: Record<InstallableId, string> = {
  openspec: 'change tickets validate, apply and archive OpenSpec artifacts; the Spec Explorer indexes them',
  wt: 'worktrunk-managed worktrees (without it the plain git worktree fallback is used)',
  gh: 'pull-request delivery (deliveryMode: pr)',
  claude: 'the claude runtime',
  codex: 'the codex runtime',
  opencode: 'the opencode runtime',
  gemini: 'the gemini runtime',
};

function npmGlobal(pkg: string, host: HostFacts): string[] | null {
  if (host.has('npm')) return ['npm', 'install', '-g', pkg];
  if (host.has('pnpm')) return ['pnpm', 'add', '-g', pkg];
  return null;
}

/** The step for one missing tool. `command` is null when only a root-needing or unknown installer applies. */
export function planInstall(id: InstallableId, host: HostFacts): InstallStep {
  const why = WHY[id];
  if (id === 'wt') {
    if (host.platform === 'darwin' && host.has('brew')) return { id, command: ['brew', 'install', 'worktrunk'], manual: 'brew install worktrunk', why };
    if (host.has('cargo-binstall')) return { id, command: ['cargo', 'binstall', '-y', 'worktrunk'], manual: 'cargo binstall worktrunk', why };
    if (host.has('cargo')) return { id, command: ['cargo', 'install', 'worktrunk'], manual: 'cargo install worktrunk', why };
    const manual = host.has('pacman') ? 'sudo pacman -S worktrunk' : 'install worktrunk: https://github.com/max-sixty/worktrunk (cargo install worktrunk)';
    return { id, command: null, manual, why };
  }
  if (id === 'gh') {
    if (host.platform === 'darwin' && host.has('brew')) return { id, command: ['brew', 'install', 'gh'], manual: 'brew install gh', why };
    const manual = host.has('pacman') ? 'sudo pacman -S github-cli'
      : host.has('apt-get') ? 'sudo apt-get install gh'
      : host.has('dnf') ? 'sudo dnf install gh'
      : 'install gh: https://cli.github.com';
    return { id, command: null, manual, why };
  }
  const pkg = NPM_PACKAGES[id];
  const command = npmGlobal(pkg, host);
  return { id, command, manual: `npm install -g ${pkg}`, why };
}

export function planInstalls(ids: InstallableId[], host: HostFacts): InstallStep[] {
  return ids.map((id) => planInstall(id, host));
}

export function isInstallable(id: string): id is InstallableId {
  return ['openspec', 'wt', 'gh', 'claude', 'codex', 'opencode', 'gemini'].includes(id);
}
