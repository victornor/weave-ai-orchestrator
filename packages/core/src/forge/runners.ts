/**
 * VS-467: which self-hosted runner labels a repository's workflows ask for, and which of them no
 * online runner serves — enough to explain a stalled landing ("no online runner for `weave-ci`").
 * Both functions are pure; the online labels come from the forge (`ForgeAdapter.runnerStatus`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** GitHub-hosted images: never a self-hosted label, and always provisioned by GitHub. */
const GITHUB_HOSTED = /^(ubuntu|windows|macos)-/;
/**
 * Labels GitHub assigns every runner of a kind. They identify the platform, not a self-hosted
 * runner, so a gap in `self-hosted` or `linux` alone does not name an offline machine.
 */
const GENERIC = new Set(['self-hosted', 'linux', 'windows', 'macos', 'x64', 'arm64', 'arm', 'x86']);

/**
 * The self-hosted `runs-on` labels a clone's workflows ask for. Reads `.github/workflows/*.yml` and
 * `*.yaml` and takes every `runs-on` scalar or array item, dropping GitHub-hosted images, the
 * generic platform labels and any `${{ … }}` expression (whose value this cannot resolve). A clone
 * with no workflow directory, or an unreadable file, contributes nothing.
 */
export function requestedRunnerLabels(clonePath: string): string[] {
  const dir = join(clonePath, '.github', 'workflows');
  let files: string[];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml')); }
  catch { return []; }
  const labels = new Set<string>();
  for (const file of files) {
    let text: string;
    try { text = readFileSync(join(dir, file), 'utf8'); } catch { continue; }
    for (const match of text.matchAll(/^\s*runs-on:\s*(.+?)\s*$/gm)) {
      const raw = match[1] ?? '';
      if (raw.includes('${{') || raw.startsWith('|') || raw.startsWith('>')) continue;
      for (const item of raw.replace(/^\[/, '').replace(/\]$/, '').split(',')) {
        const label = item.trim().replace(/^['"]|['"]$/g, '');
        if (!label || label.includes('${{')) continue;
        if (GITHUB_HOSTED.test(label) || GENERIC.has(label)) continue;
        labels.add(label);
      }
    }
  }
  return [...labels];
}

/** The requested labels no online runner serves, in the order they were asked for. */
export function runnerGaps(requested: string[], onlineLabels: string[]): string[] {
  const online = new Set(onlineLabels);
  return requested.filter((label) => !online.has(label));
}
