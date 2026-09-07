/**
 * The project's commit history and branch graph. Reserved by VS-95 and implemented by VS-96: until
 * then this says what will be here and shows nothing else — no sample commits, no spinner, no error.
 */
import type { ProjectSectionProps } from './sections';

export function HistorySection({ project }: ProjectSectionProps): React.ReactElement {
  return (
    <p className="text-meta leading-relaxed text-text-3">
      The commit graph for <span className="ac-mono text-text-2">{project.defaultBranch}</span> and
      the branches of {project.slug}, with the ticket each branch belongs to, will appear here.
    </p>
  );
}
