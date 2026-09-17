## MODIFIED Requirements

### Requirement: Attachment storage and serving is safe by construction

An attachment SHALL be stored outside any directory served as static content. It SHALL be retrievable
only through an authenticated route scoped to the thread it was sent in, and SHALL never be served with
a content type asserted by the uploading client for execution purposes, nor with the client's own
filename used to construct a filesystem path. The response's declared length SHALL be derived from the
bytes actually served, never from a stored size that could disagree with the file on disk. A non-image
attachment SHALL be served as a named download; an image SHALL be served inline so it can be previewed.

#### Scenario: Attachment not reachable as static content

- **WHEN** a request is made for an attachment's storage location directly, bypassing the serving route
- **THEN** no static file server responds to it; nothing outside the serving route can reach the bytes

#### Scenario: Attachment fetch requires authentication

- **WHEN** an unauthenticated request is made to the attachment serving route
- **THEN** the request is refused exactly as any other unauthenticated request to this daemon's API is

#### Scenario: A crafted filename cannot escape storage

- **WHEN** an attachment is uploaded with a filename containing path-traversal characters (for example
  `../../etc/passwd`)
- **THEN** the file is stored under a server-generated name, and the crafted filename affects only the
  display name, never the storage path

#### Scenario: Declared length equals the bytes served

- **WHEN** any attachment is fetched through the serving route
- **THEN** the response's declared `Content-Length` equals the number of bytes in its body, whatever
  the stored size says, so the daemon can never promise more than it sends

#### Scenario: A non-image attachment is served as a named download

- **WHEN** a zip or any other non-image attachment is fetched through the serving route
- **THEN** the response carries a `Content-Disposition` header naming it as an attachment with its
  display filename, and an image attachment is served with an inline disposition instead

#### Scenario: A unicode filename is carried without corrupting the response

- **WHEN** an attachment whose display filename contains non-ASCII characters is fetched through the
  serving route
- **THEN** the response carries the filename in the encoded `filename*` form and the request succeeds,
  rather than failing on an invalid header character
