# attachment-serving Specification

## Purpose
Defines how the daemon serves stored attachment bytes and how the web app presents and downloads them, so an attachment on any card, ticket page or chat opens or downloads on every device and a video plays in place.

## Requirements

### Requirement: One serving path for stored attachments
Every route that serves stored attachment bytes (ticket, thread, and any future attachment route) SHALL use one shared helper that sets `Content-Length` from the bytes actually sent, `Content-Disposition` through `attachmentContentDisposition` (ASCII `filename` plus RFC 5987 `filename*`, image types inline), a `Content-Type` resolved from the stored type, the filename extension and the leading bytes, `X-Content-Type-Options: nosniff`, `Accept-Ranges: bytes`, and a stable `ETag`.

#### Scenario: Length equals served bytes
- **WHEN** an attachment whose stored `byte_size` differs from the stored file's length is requested
- **THEN** `Content-Length` equals the number of bytes in the body

#### Scenario: Hostile or non-Latin-1 label
- **WHEN** an attachment's label contains quotes, backslashes, CR/LF, parentheses, commas, `->` or non-ASCII characters
- **THEN** the response succeeds with a valid `Content-Disposition` whose `filename*` carries the label

#### Scenario: Served name has an extension
- **WHEN** a label has no extension and the resolved media type is `video/mp4`
- **THEN** the served filename ends in `.mp4`

#### Scenario: Stored octet-stream is corrected
- **WHEN** a row is stored as `application/octet-stream` but its extension or magic bytes identify an MP4
- **THEN** the response `Content-Type` is `video/mp4`

### Requirement: Range, HEAD and conditional requests
The attachment routes SHALL answer `Range: bytes=…` with `206` and `Content-Range`, an unsatisfiable range with `416` and `Content-Range: bytes */<size>`, `HEAD` with the headers of the matching GET and no body, and `If-None-Match` matching the `ETag` with `304`.

#### Scenario: Partial content
- **WHEN** a request carries `Range: bytes=0-99` for a 1000-byte attachment
- **THEN** the response is `206` with `Content-Range: bytes 0-99/1000`, `Content-Length: 100` and 100 body bytes

#### Scenario: Unsatisfiable range
- **WHEN** a request carries `Range: bytes=5000-` for a 1000-byte attachment
- **THEN** the response is `416` with `Content-Range: bytes */1000`

### Requirement: Media type is set when an attachment is stored
`weave_ticket_attachment_put` and outbound `weave_human_send` attachments SHALL set the stored media type from the file's extension and magic bytes, covering at least images, `video/mp4`, `video/webm`, `audio/*`, `application/pdf`, JSON, text and zip, falling back to `application/octet-stream` only when nothing matches.

#### Scenario: MP4 stored as video
- **WHEN** a worker attaches a `.mp4` file
- **THEN** the stored media type is `video/mp4`

### Requirement: Attachments render by kind wherever they are listed
Every surface that lists attachments (plan, merge, action and decision cards, the ticket page, chat messages) SHALL use one shared item that plays `video/*` inline with controls and a download button, plays `audio/*` likewise, opens PDF and text in a new tab, previews images, and offers a download for everything else.

#### Scenario: Video plays in the card
- **WHEN** a merge card's ticket has a `video/mp4` attachment
- **THEN** the card renders a `<video controls playsinline preload="metadata">` for it with a download button

### Requirement: Downloads never fail silently
The download control SHALL fetch the bytes and save them as a blob, and SHALL show a visible error with a Retry when the fetch or save fails.

#### Scenario: Failed download
- **WHEN** the download request fails or returns a non-2xx status
- **THEN** the item shows an error message and a Retry control, and Retry repeats the download
