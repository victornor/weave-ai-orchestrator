-- VS-624: whether this `change` ticket must publish a plan artifact (the reserved document
-- `artifact:plan`) before it can reach `proposed`. Stamped once at assign time from the project's
-- `policies.visualPlanArtifact`, so flipping that policy never changes a ticket already planning.
-- Nullable with no default: NULL means the ticket was created before this setting existed and reads
-- as off, which is the policy's default. Only ever set for `change` tickets.
ALTER TABLE tickets ADD COLUMN plan_artifact_required INTEGER;
