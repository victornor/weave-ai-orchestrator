/**
 * The project's pull requests. Reserved by VS-95 and implemented by VS-97: until then this says what
 * will be here and shows nothing else — no sample pull requests, no spinner, no error.
 */
import type { ProjectSectionProps } from './sections';

export function PullRequestsSection({ project }: ProjectSectionProps): React.ReactElement {
  return (
    <p className="text-meta leading-relaxed text-text-3">
      The pull requests of {project.slug}, each with the ticket it belongs to and the spec change it
      implements, its checks and its merge state, will appear here.
    </p>
  );
}
