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
  return <V2Page title="Work" />;
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
  const params = useParams({ strict: false }) as { ticketId?: string };
  return <V2Page title={params.ticketId ?? 'Ticket'} />;
}
export function V2ArtifactPage(): React.ReactElement {
  const params = useParams({ strict: false }) as { key?: string };
  return <V2Page title="Artifact" subtitle={params.key} />;
}
export function V2WorkerPage(): React.ReactElement {
  const params = useParams({ strict: false }) as { workerId?: string };
  return <V2Page title="Worker" subtitle={params.workerId} />;
}
