## Purpose

The global V2 Map: a workspace → project → worker graph with `runs in` edges, filtered by scope or by
attention, whose nodes route to the screen that owns each kind.

## ADDED Requirements

### Requirement: The map is a workspace → project → worker graph

The V2 screen at `/v2/map` SHALL render a graph whose nodes are workspaces, their projects, and the
workers running in those projects, drawn across all workspaces, with `runs in` edges connecting a
workspace to its projects and a project to its workers.

#### Scenario: Real cross-workspace data

- **WHEN** two workspaces have projects and running workers
- **THEN** the graph shows their workspace, project and worker nodes and the connecting edges

#### Scenario: A worker sits under its project

- **WHEN** a worker belongs to a project
- **THEN** an edge connects that project to the worker

### Requirement: Filters prune the graph

The screen SHALL offer `Everywhere`, each workspace, and `Attention`. Choosing a workspace SHALL show
only that workspace's subgraph; choosing `Attention` SHALL show only the parts of the graph whose
workers require attention, with their owning workspace and project. Choosing `Everywhere` SHALL show
the whole graph.

#### Scenario: Filter by workspace

- **WHEN** the human chooses one workspace
- **THEN** only that workspace's nodes and edges are shown

#### Scenario: Attention only

- **WHEN** the human chooses `Attention`
- **THEN** only the workspaces, projects and workers needing attention are shown

### Requirement: The legend derives from the statuses present

The legend SHALL be built from the worker statuses actually present in the graph and SHALL not list a
status that no shown node carries.

#### Scenario: Legend matches the graph

- **WHEN** the shown workers are all running
- **THEN** the legend lists the running state and not states absent from the graph

### Requirement: Nodes route by kind

A worker node SHALL open Live for that worker, a project node SHALL open that project's Work, and a
workspace node SHALL open that workspace's Chat. A node's activation SHALL carry the workspace it
belongs to, so it opens in the right scope.

#### Scenario: Worker opens Live

- **WHEN** the human activates a worker node
- **THEN** Live opens focused on that worker

#### Scenario: Project opens Work

- **WHEN** the human activates a project node
- **THEN** that workspace's Work opens for the project

#### Scenario: Workspace opens Chat

- **WHEN** the human activates a workspace node
- **THEN** that workspace's Chat opens

### Requirement: The footer is phrased distinctly from the header

The screen SHALL state what it is currently showing, and that statement SHALL be phrased differently
from any roster total the header carries, so two figures on the screen cannot read as the same fact.

#### Scenario: Header and footer differ

- **WHEN** the graph is filtered
- **THEN** the footer's account of what is shown is worded distinctly from the header's total
