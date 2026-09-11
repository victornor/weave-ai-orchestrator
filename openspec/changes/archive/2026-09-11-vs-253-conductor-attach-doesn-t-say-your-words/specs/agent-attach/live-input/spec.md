## ADDED Requirements

### Requirement: An attached view states which delivery will happen before the human types

The surface that attaches to one agent SHALL label its input from that agent's live-input status as soon as the status is known and before the human types. Where the status reports mid-turn delivery, the label SHALL say the message reaches the running turn. Where the status reports queued delivery, the label SHALL say the message queues for the agent's next turn and SHALL include the reason the status supplies when one is supplied.

The wording SHALL be the same as the wording another surface uses for the same fact, and SHALL NOT invent a third phrasing. While the status has not yet been fetched, the surface SHALL show no label and SHALL NOT imply either outcome. When the agent starts or finishes a turn, the surface SHALL update the label from the refreshed status; it SHALL NOT poll the daemon solely to keep the label current.

The label SHALL NOT replace the after-send delivery notice: what will happen before sending and what did happen after sending are both shown.

#### Scenario: The label says mid-turn delivery is available

- **WHEN** a human opens an attached view for an agent whose live-input status reports that input reaches the running turn
- **THEN** the view labels its input as reaching the running turn, in the wording another surface uses for that fact

#### Scenario: The label says queued, with the reason supplied

- **WHEN** a human opens an attached view for an agent whose live-input status reports queued delivery and names a reason
- **THEN** the view labels its input as queued for the next turn and includes that reason

#### Scenario: The label says queued when no reason is supplied

- **WHEN** an agent's live-input status reports queued delivery without a reason
- **THEN** the view labels its input as queued for the next turn without inventing a reason

#### Scenario: No label before the status is known

- **WHEN** an attached view is open and its first fetch of the agent's detail has not yet resolved
- **THEN** the view shows no label implying either delivery outcome

#### Scenario: The label follows a turn starting or ending

- **WHEN** an attached agent starts or finishes a turn and the view refreshes from that event
- **THEN** the input label reflects the newly fetched live-input status

#### Scenario: The label does not add polling

- **WHEN** an attached view is idle and nothing about its agent changes
- **THEN** it makes no request solely to keep the input label current

#### Scenario: The after-send notice is unchanged

- **WHEN** a human sends text from the attached view
- **THEN** the delivery notice states which delivery occurred, exactly as it did before this change
