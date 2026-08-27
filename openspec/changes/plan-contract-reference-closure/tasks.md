## 1. Production reference resolution

- [x] 1.1 Inventory every file-bearing field in the contracts schema/parser and add typed source-kind coverage without a generic string/path heuristic.
- [x] 1.2 Implement `resolveContractFileReferences` as a deterministic normalized in-memory view reusing the existing repository-relative path normalizer.
- [x] 1.3 Implement the subset check against normalized `contracts.files` with bounded path/source diagnostics and no alternative authorization channel.

## 2. Plan closure integration

- [x] 2.1 Wire reference closure into the production contracts loader/`check-plan` path before PASS-compatible closure.
- [x] 2.2 Update plan phase rules, contracts schema/template and plan skill guidance to state `contracts.files` SSOT and the edit-files→reclose recovery.
- [x] 2.3 Update `MIGRATION.md` for existing contracts whose file-bearing references are not declared in `contracts.files`.

## 3. Incident fixtures and verification

- [x] 3.1 Add the minimal bc-openCard twenty-logo fixture through the production YAML parser/resolver/closure API; assert undeclared media FAIL.
- [x] 3.2 Add the corresponding all-media-declared PASS and existing legal-feature regression; assert no graph/manifest/test-only facts artifact is written.
- [x] 3.3 Run TypeScript typecheck, targeted contracts/check-plan unit tests and plan fixtures.
- [ ] 3.4 Run `cd harness && npm test`, strict OpenSpec validation and `npm run release:verify -- --skip-typecheck` after the publishable change set is stable.
