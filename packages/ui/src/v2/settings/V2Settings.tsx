/**
 * V2 Settings (VS-348): one global screen with a scope row (This daemon plus each workspace) and a
 * section row that changes with it, and a line saying what the current scope applies to. The
 * workspace-scoped body is wrapped in a `WorkspaceProvider` so the existing workspace hooks address
 * the selected workspace.
 */
import { V2Page } from '../V2Page';
import { WorkspaceProvider } from '../../api/context';
import { useWorkspaces } from '../../api/hooks';
import { useGo, useSearchParams } from '../../app/link';
import { cx } from '../../lib/cx';
import { scopeFromSearch, sectionFor, sectionsOfScope, type V2SettingsScope } from './sections';
import { DaemonModelsSection, WorkspaceModelsSection } from './sections/Models';
import { ProvidersSection } from './sections/Providers';
import { McpServersSection } from './sections/McpServers';
import { ApprovalsSection, GeneralSection, KnowledgeSection, PluginsSection, WeaverSection, WorkerMemorySection } from './sections/Workspace';
import {
  ChannelsSection,
  DeviceSection,
  DictationSection,
  HostToolsSection,
  PresentationSection,
  ProjectsSection,
  SecuritySection,
  UpdatesSection,
} from '../../settings/sections';

function ScopeTab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }): React.ReactElement {
  return (
    <button type="button" onClick={onClick}
      className={cx('relative whitespace-nowrap px-3 py-2 text-meta', active ? 'font-semibold text-text-1' : 'font-normal text-text-3')}>
      {label}
      {active ? <span className="absolute inset-x-2 -bottom-px h-0.5 bg-text-1" aria-hidden /> : null}
    </button>
  );
}

function SectionTab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }): React.ReactElement {
  return (
    <button type="button" onClick={onClick}
      className={cx('relative whitespace-nowrap px-3 py-2 text-micro', active ? 'text-text-1' : 'text-text-3')}>
      {label}
      {active ? <span className="absolute inset-x-2 -bottom-px h-px bg-line-3" aria-hidden /> : null}
    </button>
  );
}

function DaemonBody({ section }: { section: string }): React.ReactElement | null {
  switch (section) {
    case 'updates': return <UpdatesSection />;
    case 'models': return <DaemonModelsSection />;
    case 'providers': return <ProvidersSection scope="daemon" />;
    case 'mcp': return <McpServersSection scope="daemon" />;
    case 'security': return <SecuritySection />;
    case 'host-tools': return <HostToolsSection />;
    case 'dictation': return <DictationSection />;
    case 'device': return <DeviceSection themeControl="note" />;
    default: return null;
  }
}

function WorkspaceBody({ section }: { section: string }): React.ReactElement | null {
  switch (section) {
    case 'general': return <GeneralSection />;
    case 'weaver': return <WeaverSection />;
    case 'models': return <WorkspaceModelsSection />;
    case 'providers': return <ProvidersSection scope="workspace" />;
    case 'mcp': return <McpServersSection scope="workspace" />;
    case 'projects': return <ProjectsSection />;
    case 'knowledge': return <KnowledgeSection />;
    case 'worker-memory': return <WorkerMemorySection />;
    case 'approvals': return <ApprovalsSection />;
    case 'channels': return <ChannelsSection />;
    case 'presentation': return <PresentationSection />;
    case 'plugins': return <PluginsSection />;
    default: return null;
  }
}

export function V2Settings(): React.ReactElement {
  const search = useSearchParams();
  const go = useGo();
  const workspaces = useWorkspaces();
  const scope: V2SettingsScope = scopeFromSearch(search);
  const wsId = scope === 'workspace' ? (search['scope'] ?? '').trim() : '';
  const section = sectionFor(scope, search['section']);
  const list = workspaces.data ?? [];
  const activeWsName = list.find((w) => w.id === wsId)?.name ?? wsId;

  const chooseScope = (id: string | null): void => {
    const next: Record<string, string | undefined> = { ...search };
    if (id) next['scope'] = id; else delete next['scope'];
    delete next['section'];
    go('/settings', { search: next, replace: true });
  };
  const chooseSection = (key: string): void => {
    go('/settings', { search: { ...search, ...(scope === 'workspace' ? { scope: wsId } : {}), section: key }, replace: true });
  };

  const appliesTo = scope === 'daemon'
    ? 'This daemon — applies to every workspace on this machine.'
    : `${activeWsName} — applies to this workspace only.`;

  return (
    <V2Page title="Settings">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-none border-b border-line-1">
          <div className="flex overflow-x-auto px-2" role="tablist" aria-label="Settings scope">
            <ScopeTab active={scope === 'daemon'} label="This daemon" onClick={() => chooseScope(null)} />
            {list.map((w) => <ScopeTab key={w.id} active={scope === 'workspace' && wsId === w.id} label={w.name} onClick={() => chooseScope(w.id)} />)}
          </div>
        </div>
        <div className="flex-none border-b border-line-1">
          <div className="flex overflow-x-auto px-2" role="tablist" aria-label="Settings section">
            {sectionsOfScope(scope).map((s) => <SectionTab key={s.key} active={section.key === s.key} label={s.label} onClick={() => chooseSection(s.key)} />)}
          </div>
        </div>
        <div className="mx-auto w-full max-w-3xl px-4 py-4 md:px-5">
          <p className="mb-4 text-micro text-text-3">{appliesTo}</p>
          {scope === 'daemon' ? (
            <DaemonBody section={section.key} />
          ) : (
            <WorkspaceProvider ws={wsId} remember={false} live={false}>
              <WorkspaceBody section={section.key} />
            </WorkspaceProvider>
          )}
        </div>
      </div>
    </V2Page>
  );
}
