/**
 * The settings' two areas and the sections filed under them (VS-52), and — since VS-230 — the two
 * routes they are shown by: the workspace area at `/w/$ws/settings` and the daemon area at
 * `/settings`, which needs no workspace. There is no switcher; a link naming one area's section
 * from the other's route is redirected (see `redirectForSettingsRoute`).
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
  { key: 'models', label: 'Models', area: 'workspace' },
  { key: 'channels', label: 'Channels', area: 'workspace' },
  { key: 'presentation', label: 'Presentation', area: 'workspace' },
  { key: 'updates', label: 'Updates', area: 'daemon' },
  { key: 'daemon-models', label: 'Models', area: 'daemon' },
  { key: 'dictation', label: 'Dictation', area: 'daemon' },
  { key: 'host-tools', label: 'Host tools', area: 'daemon' },
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

/**
 * The two routes settings is split into (VS-230): the workspace's own settings under
 * `/w/$ws/settings`, and the daemon's at `/settings`, above the workspaces and in need of none.
 * The daemon area of the sections table is what the daemon route shows; the workspace area, the
 * workspace route.
 */
export type SettingsRouteKind = 'workspace' | 'daemon';

/** The section one route's own area shows for a URL's `?section=`: a link may name a section by
 * key alone, but only one that belongs to this route — anything else falls back to the first
 * section rather than showing another area's section under this route's heading. */
export function sectionForRoute(route: SettingsRouteKind, search: { section?: string } | undefined): SettingsSectionKey {
  const area: SettingsAreaKey = route === 'daemon' ? 'daemon' : 'workspace';
  const found = SETTINGS_SECTIONS.find((s) => s.key === search?.section);
  return found && found.area === area ? found.key : firstSectionOf(area);
}

/** What a settings URL should do instead of rendering: nothing, or move to the owning route. */
export type SettingsRedirect =
  | { type: 'stay' }
  | { type: 'redirect'; to: string; search: Record<string, string | undefined>; ws?: string };

/**
 * Decide where a settings URL belongs, so a link carried over from the one-page area switcher still
 * lands on what it named (VS-230) instead of 404ing or silently showing the wrong scope.
 *
 * From the workspace route, anything resolving to the daemon area — an explicit `?area=daemon` or a
 * daemon section — moves to the daemon route with its section; the rest of the search travels along.
 * From the daemon route, only an *explicitly named* workspace side (`?area=workspace` or a known
 * workspace section) moves, to the remembered workspace's settings: the default must stay, or a
 * bare `/settings` would redirect forever. With no workspace remembered there is nothing to show a
 * workspace section in, so the stale names are dropped and the daemon page's first section shows.
 * An unknown section never redirects — each route falls back to its own first section, as before
 * — except a leftover `?section=scheduled` from before VS-231, which opens `/scheduled` with that
 * workspace in the search (the key is no longer a known section).
 */
export function redirectForSettingsRoute(
  route: SettingsRouteKind,
  search: { area?: string | undefined; section?: string | undefined } & Record<string, string | undefined>,
  rememberedWorkspace?: string | null | undefined,
): SettingsRedirect {
  const rest: Record<string, string | undefined> = { ...search };
  delete rest.area;
  delete rest.section;

  if (search.section === 'scheduled') {
    const ws = rememberedWorkspace?.trim() || null;
    return { type: 'redirect', to: '/scheduled', search: { ...rest, ...(ws ? { ws } : {}) } };
  }

  const resolved = resolveSettingsLocation(search);
  if (route === 'workspace') {
    if (resolved.area !== 'daemon') return { type: 'stay' };
    return { type: 'redirect', to: '/settings', search: { ...rest, section: resolved.section } };
  }

  const namedWorkspaceSide =
    search.area === 'workspace' ||
    SETTINGS_SECTIONS.some((s) => s.key === search.section && s.area === 'workspace');
  if (!namedWorkspaceSide) return { type: 'stay' };
  const ws = rememberedWorkspace?.trim() || null;
  if (!ws) return { type: 'redirect', to: '/settings', search: rest };
  return { type: 'redirect', to: '/w/$ws/settings', search: { ...rest, section: resolved.section }, ws };
}
