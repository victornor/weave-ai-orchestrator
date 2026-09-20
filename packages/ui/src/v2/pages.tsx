/**
 * Every V2 destination, as a header plus a placeholder. Screen tickets replace a page's body; the
 * address and the header ship here so navigation and highlighting are complete (proposal: "a route
 * and a header for every V2 destination").
 */
import { KnowledgeScreen } from './knowledge/KnowledgeFrame';
import { KnowledgeHome } from './knowledge/KnowledgeHome';
import { KnowledgeChangelogPage } from './knowledge/KnowledgeChangelogPage';
import { KnowledgeSpecsPage } from './knowledge/KnowledgeSpecs';
import { KnowledgeGraphPage } from './knowledge/KnowledgeGraphPage';
import { KnowledgeExplorerPage } from './knowledge/KnowledgeExplorerPage';
import { V2WorkScreen } from './work/Work';
import { V2TicketScreen } from './ticket/Ticket';
import { V2TicketArtifactReader, V2WorkspaceArtifactReader, V2PlanArtifactReader } from './artifact/Artifact';
import { V2Settings } from './settings/V2Settings';
import { V2Scheduled } from './scheduled/V2Scheduled';

// VS-345: Needs you is a real screen, not a placeholder; its module owns the page component.
export { V2NeedsPage } from './NeedsYouPage';
// VS-351: Roles is a real screen; its module owns the page component.
export { V2RolesPage } from './RolesPage';
// VS-349: Chat is a real screen; its module owns the page component and the split layout.
export { V2ChatPage } from './ChatPage';
// VS-350: Live, Runs, run detail, Map and Incidents are real screens.
export { V2LivePage } from './LivePage';
export { V2RunsPage } from './RunsPage';
export { V2RunPage } from './RunPage';
export { V2MapPage } from './MapPage';
export { V2IncidentsPage } from './IncidentsPage';
// VS-352: Global Chats is a real screen; its module owns the page component.
export { V2ChatsScreen as V2ChatsPage } from './chats/ChatsPage';
// VS-352: Usage is a real screen.
export { V2UsageScreen as V2UsagePage } from './usage/UsagePage';
// VS-352: Changelog is a real screen.
export { V2ChangelogScreen as V2ChangelogPage } from './changelog/ChangelogPage';
// VS-352: the project overview is a real screen.
export { V2ProjectScreen as V2ProjectPage } from './project/ProjectPage';
export { V2RoadmapScreen as V2RoadmapPage } from './project/RoadmapPage';
// VS-452: the change explorer a merge card opens.
export { V2ChangeExplorerScreen as V2ChangeExplorerPage } from './project/ChangeExplorer';

export function V2ScheduledPage(): React.ReactElement {
  return <V2Scheduled />;
}
export function V2SettingsPage(): React.ReactElement {
  return <V2Settings />;
}
export function V2WorkPage(): React.ReactElement {
  return <V2WorkScreen />;
}
export function V2KnowledgePage(): React.ReactElement {
  return (
    <KnowledgeScreen tab="knowledge">
      <KnowledgeHome />
    </KnowledgeScreen>
  );
}
export function V2GraphPage(): React.ReactElement {
  return (
    <KnowledgeScreen tab="graph">
      <KnowledgeGraphPage />
    </KnowledgeScreen>
  );
}
export function V2ExplorerPage(): React.ReactElement {
  return (
    <KnowledgeScreen tab="explorer">
      <KnowledgeExplorerPage />
    </KnowledgeScreen>
  );
}
export function V2KnowledgeChangelogPage(): React.ReactElement {
  return (
    <KnowledgeScreen tab="changelog">
      <KnowledgeChangelogPage />
    </KnowledgeScreen>
  );
}
export function V2KnowledgeSpecsPage(): React.ReactElement {
  return (
    <KnowledgeScreen tab="specs">
      <KnowledgeSpecsPage />
    </KnowledgeScreen>
  );
}
export function V2TicketPage(): React.ReactElement {
  return <V2TicketScreen />;
}
export function V2ArtifactPage(): React.ReactElement {
  return <V2WorkspaceArtifactReader />;
}
export { V2TicketArtifactReader };
// VS-622: the plan-scoped artifact reader a planner-published artifact's card opens.
export { V2PlanArtifactReader };
// VS-350: the worker page is a real screen.
export { V2WorkerPage } from './WorkerPage';
export { V2PluginPage } from './PluginPage';
