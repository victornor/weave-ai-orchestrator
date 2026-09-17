## Why

The published agent-tool schema for `weave_knowledge_doc_get` has disagreed with the handler's
accepted input, causing callers that follow the advertised field to fail validation. Linked
knowledge documents are addressed by slug throughout the knowledge system, so the public tool
contract and its tests need to make that identity explicit and prevent future schema drift.

## What Changes

- Keep `slug` as the required document identifier for `weave_knowledge_doc_get`, matching
  `weave_knowledge_doc_put`, document links, and the existing knowledge model.
- Add a contract test that obtains every knowledge tool's published JSON schema, builds valid input
  from that schema, and invokes the tool through the public agent-tool boundary.
- Cover the document-get success path and the invalid-identifier path so a renamed field produces a
  field-specific validation error rather than a generic failure.
- Check the complete knowledge-tool family (`get`, `note`, `docs`, `doc_get`, `doc_put`, `search`,
  `semantic_search`, and `replace`) for the same published-schema/handler divergence.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `knowledge/document-folders`: document reads and writes continue to address documents by their
  canonical slug, and the agent-facing document tool schema must expose that identifier consistently.

## Impact

- `packages/server/src/tools.ts` and the agent-tool schema publication path.
- Server integration tests covering published schemas and public tool dispatch.
- No new dependencies or storage changes; the change preserves the existing `slug` API contract.
