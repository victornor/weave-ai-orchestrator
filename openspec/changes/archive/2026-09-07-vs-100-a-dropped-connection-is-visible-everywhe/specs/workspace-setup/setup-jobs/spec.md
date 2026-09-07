## MODIFIED Requirements

### Requirement: A job can be read and streamed

A job SHALL be readable on demand, returning its state, its sub-steps with their timings, and its
retained log tail. Jobs SHALL be listable filtered by kind and by the entity they act on, so a surface
that lost its client state can find the job still running for a project.

A job SHALL also be streamable: the stream SHALL first replay the job's sub-step states and retained
log lines, and then deliver each further sub-step transition, output line and the job's completion as
they happen. Each streamed item SHALL carry the job's sequence number so a client that reconnects
resumes after the last item it saw rather than replaying from the start.

A surface watching a job's stream SHALL be able to tell the stream's connection being down from
the job itself having stalled: the stream SHALL expose its connection state per
`live-streams/connection-state`, retrying indefinitely while the surface holds it open, so a
dropped connection during onboarding does not look like the setup step has failed.

#### Scenario: A surface attaches mid-job

- **WHEN** a client opens the stream of a job that is already running
- **THEN** it receives the sub-step states and retained lines so far, and then continues to receive new ones live

#### Scenario: A reconnect resumes

- **WHEN** a client re-opens the stream giving the last sequence number it saw
- **THEN** it receives only the items after that sequence number

#### Scenario: Finding the job again after losing client state

- **WHEN** jobs are listed for a project
- **THEN** the jobs for that project are returned, most recent first

#### Scenario: The job stream's connection drops mid-job

- **WHEN** the connection underlying a job stream is lost while the job is still running
- **THEN** the surface watching it can tell the stream is reconnecting rather than assuming the
  job itself has stopped, and the stream keeps retrying without the surface reloading
