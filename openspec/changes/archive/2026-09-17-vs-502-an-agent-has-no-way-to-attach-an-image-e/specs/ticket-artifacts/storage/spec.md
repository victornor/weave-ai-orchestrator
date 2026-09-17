# ticket-artifacts/storage Specification

## MODIFIED Requirements

### Requirement: The stored body must be a single HTML document under a size cap

The tool SHALL reject a body that is empty, is not recognizable as an HTML document, exceeds a
stated maximum size, or contains a malformed embedded base64 image data URI, with an error naming
which condition failed. For each `data:image/...;base64,...` URI, validation SHALL reject invalid
base64 and bytes that do not form a complete supported raster image; a valid leading signature alone
is not sufficient to accept a truncated payload.

#### Scenario: Empty or non-HTML body

- **WHEN** an agent submits an empty string, or a string with no HTML document markers
- **THEN** the call fails with a validation error describing the requirement, and no document or
  work product is created or modified

#### Scenario: Oversized body

- **WHEN** an agent submits an HTML document larger than the stated size cap
- **THEN** the call fails with a validation error naming the cap, and no document or work product is
  created or modified

#### Scenario: Truncated embedded image is refused

- **WHEN** an agent submits HTML containing an image data URI whose base64 is missing characters or
  whose decoded PNG/JPEG/GIF/WebP bytes are incomplete
- **THEN** the call fails with a validation error identifying the malformed image (including its
  data-URI occurrence or nearby element context), and no artifact revision or work product is
  created

#### Scenario: A complete embedded image is accepted

- **WHEN** an agent submits HTML containing a complete supported raster image as a base64 data URI
- **THEN** artifact validation succeeds and the existing revision/work-product behavior is unchanged
