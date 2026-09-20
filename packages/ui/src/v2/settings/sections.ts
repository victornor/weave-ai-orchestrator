/**
 * The V2 Settings section registry (VS-348, HANDOFF §9): one table of the two scopes and the
 * sections filed under each, so the scope row, the section row and the body switch cannot drift.
 * The design's sections come first in each scope; the kept V1 sections follow.
 */
export type V2SettingsScope = 'daemon' | 'workspace';

export interface V2SettingsSection {
  key: string;
  label: string;
  scope: V2SettingsScope;
}

/** The daemon is the default for every workspace; the design's three first, then the kept ones. */
export const V2_DAEMON_SECTIONS: V2SettingsSection[] = [
  { key: 'updates', label: 'Updates', scope: 'daemon' },
  { key: 'models', label: 'Models', scope: 'daemon' },
  { key: 'security', label: 'Security & devices', scope: 'daemon' },
  { key: 'host-tools', label: 'Host tools', scope: 'daemon' },
  { key: 'dictation', label: 'Dictation', scope: 'daemon' },
  { key: 'device', label: 'This device', scope: 'daemon' },
];

/** The design's four first, the kept V1 sections after, and General identity first of all. */
export const V2_WORKSPACE_SECTIONS: V2SettingsSection[] = [
  { key: 'general', label: 'General', scope: 'workspace' },
  { key: 'weaver', label: 'Weaver', scope: 'workspace' },
  { key: 'models', label: 'Models', scope: 'workspace' },
  { key: 'providers', label: 'Providers', scope: 'workspace' },
  { key: 'projects', label: 'Projects', scope: 'workspace' },
  { key: 'knowledge', label: 'Knowledge', scope: 'workspace' },
  { key: 'worker-memory', label: 'Worker memory', scope: 'workspace' },
  { key: 'approvals', label: 'Approvals', scope: 'workspace' },
  { key: 'channels', label: 'Channels', scope: 'workspace' },
  { key: 'presentation', label: 'Presentation', scope: 'workspace' },
  { key: 'plugins', label: 'Plugins', scope: 'workspace' },
];

export function sectionsOfScope(scope: V2SettingsScope): V2SettingsSection[] {
  return scope === 'daemon' ? V2_DAEMON_SECTIONS : V2_WORKSPACE_SECTIONS;
}

/** The section a scope shows when the URL names none or names an unknown one. */
export function firstSectionOf(scope: V2SettingsScope): V2SettingsSection {
  return sectionsOfScope(scope)[0]!;
}

/** Resolve a URL's `?section=` to a section of this scope, else the scope's first. */
export function sectionFor(scope: V2SettingsScope, key: string | undefined): V2SettingsSection {
  return sectionsOfScope(scope).find((s) => s.key === key) ?? firstSectionOf(scope);
}

/** The scope a URL's `?scope=` names: a workspace id, or the daemon when absent. */
export function scopeFromSearch(search: Record<string, string | undefined>): V2SettingsScope {
  return search['scope']?.trim() ? 'workspace' : 'daemon';
}
