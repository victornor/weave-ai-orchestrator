## REMOVED Requirements

### Requirement: Ending a dictation leaves the transcript and never sends

**Reason**: Superseded. Its rule — ending a dictation never sends — is wrong for the dictation
keybinding, which is the path the "Send automatically when dictation ends" setting exists for
(VS-494, correcting VS-489). The Stop control keeps the old behaviour; the keybinding does not.

**Migration**: The Stop control's behaviour (composer dictate control and off-page bar's Stop) is
carried unchanged into the ADDED requirement "How a dictation ends decides whether it sends". The
keybinding's ending now honours the restored auto-send setting.

## ADDED Requirements

### Requirement: How a dictation ends decides whether it sends

Ending a dictation with the composer's dictate control or the off-page dictation bar's Stop SHALL
end the session and leave the settled transcript in the composer; it SHALL NOT submit a message.
Ending it with the dictation keybinding — a toggle session pressed off, or a held chord released,
including the window-blur fallback that ends a hold whose keyup was lost — SHALL end the session
and, when the per-browser "Send automatically when dictation ends" setting is on, submit the
settled transcript through the queued finish-the-dictation-and-send path exactly once, once it
lands. With the setting off, the keybinding ending SHALL leave the transcript in the composer and
submit nothing. The setting SHALL be stored in the browser under the same key and with the same
semantics as before it was retired, so a human who had it on keeps it on; its default stays off.
Escape remains distinct: it discards the transcript and restores the pre-dictation draft,
submitting nothing. A too-short, empty or failed transcript SHALL submit nothing even with the
setting on, and only an explicit send (the send keybinding or the Send button) SHALL submit
regardless of the setting.

#### Scenario: The dictate control leaves the transcript

- **WHEN** a dictation is listening and the human presses the composer's dictate control to stop it
- **THEN** the session ends, the recognized text is left in the composer, and no message is submitted

#### Scenario: The off-page bar's Stop leaves the transcript

- **WHEN** a session ends from the off-page bar's Stop
- **THEN** the settled transcript is left in the target thread's composer and no message is submitted

#### Scenario: A held chord release sends when the setting is on

- **WHEN** auto-send is on, a push-to-talk chord is held past the hold threshold, and the human
  releases it with a transcript already recognized
- **THEN** the session ends and the settled transcript is submitted exactly once through the queued
  send path

#### Scenario: A toggle-off sends when the setting is on

- **WHEN** auto-send is on, a toggle session is listening with a transcript recognized, and the
  human presses the chord again to turn it off
- **THEN** the session ends and the settled transcript is submitted exactly once through the queued
  send path

#### Scenario: The keybinding leaves the transcript when the setting is off

- **WHEN** auto-send is off and the human ends a dictation with the keybinding, by a held release or
  by pressing a toggle session off
- **THEN** the session ends, the settled transcript is left in the composer, and no message is
  submitted

#### Scenario: A too-short, empty or failed transcript sends nothing even with the setting on

- **WHEN** auto-send is on and a keybinding-ended session settles to five words or fewer, to no
  words, or to a transcription error
- **THEN** nothing is submitted and the draft is left as the discard, empty or error rule requires

#### Scenario: Only an explicit send submits regardless of the setting

- **WHEN** a dictation is listening or transcribing and the human presses the send keybinding or the
  Send button, whether auto-send is on or off
- **THEN** the session finishes and the settled transcript is submitted exactly once, through the
  queued send path

#### Scenario: Escape still discards rather than leaving the transcript

- **WHEN** a dictation is listening or transcribing and the human presses Escape
- **THEN** the transcript is discarded, the draft is restored to its pre-dictation value, and
  nothing is submitted
