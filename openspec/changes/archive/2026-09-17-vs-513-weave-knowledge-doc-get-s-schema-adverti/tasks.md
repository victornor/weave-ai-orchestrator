## 1. Normalize the knowledge-tool contract

- [x] 1.1 Audit the knowledge tool registry, REST schema publication, and MCP schema publication for all eight knowledge tools; ensure `weave_knowledge_doc_get` publishes required `slug` and that each published field matches the handler input, verified with a focused schema inspection test.
- [x] 1.2 Preserve the existing slug-only document lookup and validation behavior, including an error that identifies the expected `slug` when a caller supplies the old `key` field, verified through the public agent-tool route.

## 2. Add published-schema contract coverage

- [x] 2.1 Add a server integration test that lists the published knowledge-tool schemas, checks the expected object properties/required fields, and invokes `get`, `note`, `docs`, `doc_get`, `doc_put`, `search`, `semantic_search`, and `replace` with schema-valid inputs through the public dispatch boundary.
- [x] 2.2 Add MCP `tools/list` coverage for the critical `weave_knowledge_doc_get` schema and its schema-shaped successful call, verified by the existing MCP test harness.
- [x] 2.3 Cover the `key`/`slug` mismatch regression by asserting that a valid `slug` call succeeds and an undeclared `key` call fails with a field-specific validation error, without weakening domain/authorization errors for restricted tools.

## 3. Validate the change

- [x] 3.1 Run `openspec validate vs-513-weave-knowledge-doc-get-s-schema-adverti --json --strict` and the focused server tests, then run the repository lint, typecheck, and full test suites; resolve any failures before delivery.
