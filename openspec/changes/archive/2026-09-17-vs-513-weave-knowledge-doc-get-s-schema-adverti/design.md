## Context

The server keeps the canonical Zod inputs in one tool registry, publishes JSON Schema views of
those inputs through both MCP `tools/list` and the agent REST list route, and parses calls again at
the public dispatch boundary. The current knowledge handlers use slug-based document identity, but
the incident exposed that a published schema can drift from what dispatch accepts without a test
exercising both sides. See `proposal.md` and the `knowledge/document-folders` delta for the
behavioral contract.

## Goals / Non-Goals

**Goals:**

- Make the agent-facing schema/dispatch pair for every knowledge tool testable through the same
  public route an agent uses.
- Prove that `weave_knowledge_doc_get` publishes required `slug`, accepts a schema-shaped call, and
  reports the expected field when given the old/mismatched `key` input.
- Keep MCP and REST schema publication covered by one shared assertion path where practical.

**Non-Goals:**

- Do not introduce a second document identifier or support `key` as an alias.
- Do not change knowledge storage, slug resolution, folder placement, or authorization semantics.
- Do not replace business-logic tests for the knowledge service with schema tests.

## Decisions

### Use slug as the sole public document identifier

The folder capability already defines slug as the stable identity independent of a document's path,
and `weave_knowledge_doc_put`, links, notes, and service lookup use it. The implementation will
retain `slug` in `doc_get` and align any discovered schema or description drift to that spelling.
Supporting `key` as a compatibility alias was rejected because it would create two public names for
one identity and would leave the folder/document contract ambiguous.

### Test the published REST schema and public dispatch together

The contract test will first request `/agent/tools`, select the knowledge tool entries, and inspect
their `inputSchema` properties and required lists. It will then submit representative inputs to
`/agent/tools/:tool` using those published names. This catches a mismatch that a direct call to a
Zod handler cannot catch. The MCP list test will additionally assert that its `tools/list` entry for
`weave_knowledge_doc_get` has the same `slug` property, since MCP is a separate schema front door.

The fixture will create a project document before the read call. Tools whose handlers have
business-only outcomes (semantic search availability and curation-only replacement) will still be
called through the public boundary with schema-valid input; the test will distinguish a validation
error from the expected domain/authorization outcome, so it verifies parsing without weakening those
tools' guards.

### Assert all knowledge tools as a registry family

The test will enumerate the known knowledge tool names and require each to appear in the published
list with an object schema. Representative calls will cover the required and optional fields for
`get`, `note`, `docs`, `doc_get`, `doc_put`, `search`, `semantic_search`, and `replace`. This keeps
future additions from silently being omitted from the audit and makes a field rename fail at the
publication/dispatch boundary.

## Risks / Trade-offs

- [Risk] A contract test that performs real knowledge writes could depend on fixture ordering or
  leave data behind → use the existing per-test harness and unique slugs, and assert only the
  response relevant to schema/dispatch.
- [Risk] Semantic search depends on local model availability → accept its documented `unavailable`
  domain result after confirming the request did not fail validation.
- [Risk] REST and MCP schemas could diverge independently → assert the critical `doc_get` shape at
  both front doors while sharing the knowledge-tool field expectations.

## Migration Plan

No data migration is required. Deploy the registry/test change normally; rollback is a code revert,
with no stored documents or callers requiring conversion because `slug` remains the existing
canonical field.
