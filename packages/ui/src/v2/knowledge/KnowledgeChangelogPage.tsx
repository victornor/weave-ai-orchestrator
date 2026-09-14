/**
 * The V2 Knowledge Changelog tab (VS-371): the workspace record, or the selected project's, using the
 * same timeline the V2 Changelog screen renders (V1's Knowledge tab passed its `project` to the same
 * `ChangelogPanel`).
 */
import { ChangelogTimeline } from '../changelog/ChangelogPage';
import { useProjectScope } from './KnowledgeFrame';

export function KnowledgeChangelogPage(): React.ReactElement {
  const project = useProjectScope();
  return <ChangelogTimeline project={project || undefined} />;
}
