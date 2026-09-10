## ADDED Requirements

### Requirement: An empty Voxtype transcript surfaces a message

When Voxtype transcription succeeds but the extracted transcript is empty (no words recognized), the composer SHALL tell the operator that nothing was recognized and that they can try again, instead of silently returning to the idle composer with no explanation. This applies to the Voxtype host-backend path only; the existing Chrome / Web Speech "heard audio, no words" message is unchanged.

#### Scenario: Voxtype returns no words

- **WHEN** Voxtype is selected, the operator records and stops, and the daemon's transcription response is a successful, empty transcript
- **THEN** the composer shows a message that nothing was recognized and the operator can try again, and the composer is not left looking as if nothing happened

#### Scenario: Voxtype returns real words

- **WHEN** Voxtype is selected and the daemon's transcription response contains a non-empty transcript
- **THEN** that text lands in the composer as before, and no "nothing recognized" message is shown
