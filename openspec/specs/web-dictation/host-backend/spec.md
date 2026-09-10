# web-dictation/host-backend Specification

## Purpose
Lets the operator pick Chrome (Web Speech) or Voxtype on the daemon host as the web composer's dictation backend, with Chrome remaining the default and Voxtype never required.

## Requirements

### Requirement: Chrome is the default dictation backend

A daemon that has never had a dictation backend set SHALL use Chrome (the browser's Web Speech API) for web dictation. Installing Voxtype on the host SHALL NOT change that default. Selecting Chrome SHALL keep the existing Chrome dictation path, including when Voxtype is installed.

#### Scenario: Fresh daemon

- **WHEN** the operator opens the composer on a daemon that has never set a dictation backend
- **THEN** dictation uses Chrome / Web Speech, not the daemon host

#### Scenario: Voxtype is installed but not selected

- **WHEN** Voxtype is installed on the daemon host and the backend is Chrome
- **THEN** tapping the microphone still uses Chrome / Web Speech and does not send audio to the daemon

#### Scenario: Switching back to Chrome

- **WHEN** the backend is Voxtype and the operator selects Chrome
- **THEN** the next dictation uses Chrome / Web Speech again

### Requirement: Settings offers Chrome and Voxtype on the daemon

The daemon area of Settings SHALL offer a dictation backend choice of Chrome or Voxtype that applies to every workspace on this daemon. The choice SHALL persist in daemon config and take effect on the next dictation without requiring a daemon restart.

#### Scenario: Selecting Voxtype

- **WHEN** Voxtype is installed and the operator selects Voxtype as the dictation backend
- **THEN** the choice is saved on the daemon and the next dictation uses the host transcriber

#### Scenario: The same choice from another workspace

- **WHEN** the backend is changed while viewing one workspace and Settings is opened from another workspace
- **THEN** the same backend is shown, without a reload

### Requirement: Missing Voxtype does not break Chrome dictation

Voxtype SHALL NOT be required to run the daemon or to dictate. When the Voxtype binary is not on the daemon host, Settings SHALL disable the Voxtype option or explain that it is not installed, and Chrome dictation SHALL keep working.

#### Scenario: Voxtype is not installed

- **WHEN** the Voxtype binary is absent on the daemon host
- **THEN** Chrome dictation still works, and Settings does not offer Voxtype as a working backend

#### Scenario: Voxtype disappears after it was selected

- **WHEN** the backend is Voxtype and the binary is later missing
- **THEN** starting dictation does not use a broken host path as if it succeeded; Chrome dictation remains available by selecting Chrome

### Requirement: The Voxtype model picker lists installed models

When Voxtype is installed, Settings SHALL list the models Voxtype reports as installed on the host and SHALL let the operator pick one for host dictation. Models that are supported but not installed SHALL NOT be selectable. This change SHALL NOT download a model.

#### Scenario: Installed models are listed

- **WHEN** Voxtype is installed and at least one model is installed
- **THEN** Settings lists those installed models and the operator can select one

#### Scenario: No model is installed

- **WHEN** Voxtype is installed but no model is installed
- **THEN** Settings does not present an empty picker as if a model were ready, and Chrome dictation still works

### Requirement: Voxtype dictation records on the client and transcribes on the host

When Voxtype is selected and available, the composer SHALL capture microphone audio on the client and send it to the daemon, which SHALL transcribe it with Voxtype on the daemon host. The resulting text SHALL land in the composer, replacing the in-progress dictation the way Chrome dictation already does. Transcription SHALL complete when recording stops; the composer is not required to show live partial words while recording.

#### Scenario: A successful Voxtype dictation

- **WHEN** Voxtype is selected and installed, the operator records a phrase, and they stop the microphone
- **THEN** the transcribed text appears in the composer

#### Scenario: Host transcription failure

- **WHEN** Voxtype is selected and the host transcription fails
- **THEN** the composer shows that transcription failed, and the operator can type instead

#### Scenario: Chrome dictation is not used while Voxtype is selected

- **WHEN** Voxtype is selected and available and the operator dictates
- **THEN** audio is sent to the daemon and is not handed to the browser's Web Speech API
