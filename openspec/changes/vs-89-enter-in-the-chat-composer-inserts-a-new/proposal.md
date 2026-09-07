## Why

On a phone, the on-screen keyboard's Enter key sends the message instead of breaking the line, so a multi-paragraph message cannot be written on the device the human most often writes from. There is no modifier to hold on a touch keyboard, so `Shift+Enter` is not an escape hatch there — the behaviour is simply unreachable. At a desk, Enter-to-send is right and must stay.

## What Changes

- On a touch device, Enter in a composer inserts a newline and does not send. Sending is by the send button, which is already always present.
- On a non-touch device, nothing changes: Enter sends, `Shift+Enter` inserts a newline.
- The touch textarea asks the on-screen keyboard for a newline key (`enterKeyHint="enter"`) so the key is labelled for what it now does; the desktop textarea keeps the browser default.
- Touch is decided from the same `(hover: none)` media query the composer already uses for dictation, read at render time. A device that changes mode mid-session follows whatever that said when the composer rendered.

## Capabilities

### New Capabilities
- `conductor-chat/composer-send-key`: what the Enter key does in a composer, and how that differs between a pointer device and a touch device.

### Modified Capabilities

(none — no existing requirement describes the send key.)

## Impact

- `packages/ui/src/components/Composer.tsx` — the textarea's `onKeyDown`, plus an `enterKeyHint` attribute. This is the one composer behind the conductor chat, the ticket reply box and the worker steer box, so all three change together.
- `packages/ui/src/test/components.test.tsx` — the existing "submits on Enter and clears" test now describes the non-touch case; a touch case joins it.
- No server, API, CLI or data-model change.
