## REMOVED Requirements

### Requirement: The overview reserves a History section

**Reason**: The requirement described the state this change ends. It reserved a History section that
"SHALL NOT show sample commits, sample branches, a loading state or an error" until a commit history
was rendered — and both of its scenarios are conditioned on no commit history being implemented.
With the graph rendered, those scenarios can no longer be exercised, and the prohibition on a loading
state and an error now contradicts a section that reads a repository and must be able to say when it
is still reading or when the read failed.

**Migration**: Replaced in full by the `project-overview/commit-graph` capability, which requires the
History section to draw the project's commits as a branch graph, and by
`project-overview/repository-reads`, which requires the reading behind it. The section's presence and
its place in the published order are still guaranteed by "Every section of the overview is rendered
against one contract" in this capability, which is unchanged, as is the reserved Pull requests
section, which VS-97 will end the same way.
