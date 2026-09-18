# web-v2/shell — delta

## ADDED Requirements

### Requirement: V2 offers no control that switches to V1

No V2 surface SHALL present a control, link, row or footer entry that sends the user to V1. This
covers the shell, the phone More list, settings, menus and footers. The V1 route modules and the
retired-address redirects SHALL be unaffected: only the V2 affordance that would send a user there
is removed, not V1 itself.

#### Scenario: The More list has no V1 row

- **WHEN** the phone More list renders
- **THEN** it contains no row, link or control labelled as opening V1

#### Scenario: No V2 surface links to V1

- **WHEN** every V2 screen, menu and footer is inspected
- **THEN** none offers a navigation control whose destination is the V1 app
