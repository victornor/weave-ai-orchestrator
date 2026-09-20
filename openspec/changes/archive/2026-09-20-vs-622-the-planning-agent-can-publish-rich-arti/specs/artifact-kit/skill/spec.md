## MODIFIED Requirements

### Requirement: The skill states how an artifact reaches the human
The skill SHALL name the publishing tool and the resulting destination explicitly, covering a
ticket-bound agent, a weaver with no ticket, and a planning agent drafting a plan, so an agent never
has to guess or improvise (such as attaching the raw HTML file to a chat message) to deliver an
artifact it has authored. For the planning agent the skill SHALL state that the artifact belongs to
the plan rather than any repository or ticket, and that publishing it supplements the planner's reply
rather than replacing it.

#### Scenario: A worker with a ticket looks up how to publish
- **WHEN** a worker following the skill wants to deliver an artifact
- **THEN** the skill names the ticket-scoped publishing tool and states that the tool's returned URL,
  not the HTML itself, is what reaches the human

#### Scenario: A weaver with no ticket looks up how to publish
- **WHEN** a weaver following the skill wants to deliver an artifact in a chat reply
- **THEN** the skill names the workspace-scoped publishing tool available to it, states that it
  returns a URL rendered inside the web app, and states that this URL — not an attached HTML file — is
  what belongs in the chat message

#### Scenario: A planning agent looks up how to publish
- **WHEN** the planning agent following the skill wants to visualize the plan it is drafting
- **THEN** the skill names the plan-scoped publishing tool, states that the artifact is plan storage
  and not a repository write, and states that the planner must still answer through its own reply tool
  so the artifact supports the reply rather than replacing it
