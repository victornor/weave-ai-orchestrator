## 1. Implementation

- [ ] 1.1 In `repointOrigin`, capture previous fetch and push URLs, clear `remote.origin.pushurl`, verify both URLs equal the new source, and roll both back on failure
- [ ] 1.2 Core tests: a clone with a distinct `pushurl` ends with both URLs on B; a failed fetch restores both URLs
- [ ] 1.3 Run the changed test file, typecheck and lint
