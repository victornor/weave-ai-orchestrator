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

// VS-345: Needs you is a real screen, not a placeholder; its module owns the page component.
export { V2NeedsPage } from './NeedsYouPage';

export function V2LivePage(): React.ReactElement {
  return <V2Page title="Live" />;
}
export function V2IncidentsPage(): React.ReactElement {
  return <V2Page title="Incidents" />;
}
export function V2MapPage(): React.ReactElement {
  return <V2Page title="Map" />;
}
export function V2RunsPage(): React.ReactElement {
  return <V2Page title="Runs" />;
}
export function V2RunPage(): React.ReactElement {
  const params = useParams({ strict: false }) as { runId?: string };
  return <V2Page title="Run" subtitle={params.runId} />;
}
export function V2ScheduledPage(): React.ReactElement {
  return <V2Page title="Scheduled" />;
}
export function V2SettingsPage(): React.ReactElement {
  return <V2Page title="Settings" />;
}
export function V2ChatsPage(): React.ReactElement {
  return <V2Page title="Chats" />;
}
export function V2ChatPage(): React.ReactElement {
  return <V2Page title="Chat" />;
}
export function V2WorkPage(): React.ReactElement {
  return <V2WorkScreen />;
}
export function V2RolesPage(): React.ReactElement {
  return <V2Page title="Roles" />;
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
export function V2WorkerPage(): React.ReactElement {
  const params = useParams({ strict: false }) as { workerId?: string };
  return <V2Page title="Worker" subtitle={params.workerId} />;
}
