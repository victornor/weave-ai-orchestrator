/**
 * The Settings page's two areas and the sections filed under them (VS-52).
 *
 * A section belongs to the workspace area when its data belongs to the current workspace, and to
 * the daemon area when it belongs to the daemon and therefore reads the same from every workspace.
 * `device` is the third scope — settings held in this browser only — and it is a section rather
 * than an area: like the daemon's own settings it does not vary by workspace, and its own label is
 * what tells the operator what it applies to.
 *
 * One table, so a section cannot end up in two areas or in none, and so the area of a `?section=`
 * link is a lookup rather than a second list to keep in step.
 */

export const SETTINGS_AREAS = [
  { key: 'workspace', label: 'This workspace' },
  { key: 'daemon', label: 'This daemon' },
] as const;

export type SettingsAreaKey = (typeof SETTINGS_AREAS)[number]['key'];

export const SETTINGS_SECTIONS = [
  { key: 'workspace', label: 'Workspace', area: 'workspace' },
  { key: 'projects', label: 'Projects', area: 'workspace' },
  { key: 'conductor', label: 'Conductor', area: 'workspace' },
  { key: 'channels', label: 'Channels', area: 'workspace' },
  { key: 'presentation', label: 'Presentation', area: 'workspace' },
  { key: 'updates', label: 'Updates', area: 'daemon' },
  { key: 'security', label: 'Security & Devices', area: 'daemon' },
  { key: 'device', label: 'This device', area: 'daemon' },
] as const satisfies ReadonlyArray<{ key: string; label: string; area: SettingsAreaKey }>;

export type SettingsSectionKey = (typeof SETTINGS_SECTIONS)[number]['key'];

const DEFAULT_AREA: SettingsAreaKey = 'workspace';

export function sectionsOfArea(area: SettingsAreaKey): typeof SETTINGS_SECTIONS[number][] {
  return SETTINGS_SECTIONS.filter((s) => s.area === area);
}

/** The first section of an area, which is what an area shows when nothing names a section. */
export function firstSectionOf(area: SettingsAreaKey): SettingsSectionKey {
  // Every area has a section — asserted in the tests — so the fallback is unreachable in practice.
  return sectionsOfArea(area)[0]?.key ?? SETTINGS_SECTIONS[0].key;
}

function knownArea(value: string | undefined): SettingsAreaKey | undefined {
  return SETTINGS_AREAS.find((a) => a.key === value)?.key;
}

/**
 * Resolve `?area=`/`?section=` to what the page shows.
 *
 * A known section wins and brings its own area with it, so a link may address a section by its key
 * alone (the sidebar's update entry does) and an `area` that contradicts it cannot put the section
 * under the wrong heading. Otherwise a known area with its first section, otherwise the workspace
 * area — so an unknown value falls back rather than rendering nothing.
 */
export function resolveSettingsLocation(search: {
  area?: string | undefined;
  section?: string | undefined;
}): { area: SettingsAreaKey; section: SettingsSectionKey } {
  const found = SETTINGS_SECTIONS.find((s) => s.key === search.section);
  if (found) return { area: found.area, section: found.key };
  const area = knownArea(search.area) ?? DEFAULT_AREA;
  return { area, section: firstSectionOf(area) };
}
