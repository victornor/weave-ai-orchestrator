/**
 * Every V2 destination, as a header plus a placeholder. Screen tickets replace a page's body; the
 * address and the header ship here so navigation and highlighting are complete (proposal: "a route
 * and a header for every V2 destination").
 */
import { useParams } from '@tanstack/react-router';
import { V2Page } from './V2Page';
import { KnowledgeHome } from './knowledge/KnowledgeHome';
import { KnowledgeGraphPage } from './knowledge/KnowledgeGraphPage';
import { KnowledgeExplorerPage } from './knowledge/KnowledgeExplorerPage';
import { V2WorkScreen } from './work/Work';
import { V2TicketScreen } from './ticket/Ticket';
import { V2TicketArtifactReader, V2WorkspaceArtifactReader } from './artifact/Artifact';
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

export function V2ScheduledPage(): React.ReactElement {
  return <V2Scheduled />;
}
export function V2SettingsPage(): React.ReactElement {
  return <V2Settings />;
}
export function V2ChatsPage(): React.ReactElement {
  return <V2Page title="Chats" />;
}
export function V2WorkPage(): React.ReactElement {
  return <V2WorkScreen />;
}
export function V2KnowledgePage(): React.ReactElement {
  return (
    <V2Page title="Knowledge">
      <KnowledgeHome />
    </V2Page>
  );
}
export function V2GraphPage(): React.ReactElement {
  return (
    <V2Page title="Knowledge graph">
      <KnowledgeGraphPage />
    </V2Page>
  );
}
export function V2ExplorerPage(): React.ReactElement {
  return (
    <V2Page title="Knowledge explorer">
      <KnowledgeExplorerPage />
    </V2Page>
  );
}
export function V2UsagePage(): React.ReactElement {
  return <V2Page title="Usage" />;
}
export function V2ChangelogPage(): React.ReactElement {
  return <V2Page title="Changelog" />;
}
export function V2ProjectPage(): React.ReactElement {
  const params = useParams({ strict: false }) as { project?: string };
  return <V2Page title="Project" subtitle={params.project} />;
}
export function V2TicketPage(): React.ReactElement {
  return <V2TicketScreen />;
}
export function V2ArtifactPage(): React.ReactElement {
  return <V2WorkspaceArtifactReader />;
}
export { V2TicketArtifactReader };
// VS-350: the worker page is a real screen.
export { V2WorkerPage } from './WorkerPage';
