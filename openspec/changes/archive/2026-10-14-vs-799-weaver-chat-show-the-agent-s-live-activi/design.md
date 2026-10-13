## Decision

Flip the default rather than remove the toggle: the toggle stays as an opt-out, defaults on, and a missing or unreadable localStorage value (private mode) means on. Only `'off'` is read as off, so nobody ever has to set a flag by hand. Users who had already stored `'on'` are unaffected; a stored `'off'` was a deliberate choice and is respected.

Removing the toggle was rejected: VS-616 added it because streamed text is run output, not a sent message, and the section is already labelled "not sent yet" and cleared on delivery, which addresses that concern without hiding it.
