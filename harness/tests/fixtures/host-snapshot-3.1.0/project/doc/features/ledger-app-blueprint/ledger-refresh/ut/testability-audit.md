# 可测性审计

```yaml
records:
  - acceptance_id: AC-1
    entry_point: {file: src/ledger/LedgerFeature.ets, symbol: add}
    testability_level: L1
    dependencies:
      - {name: Array, kind: pure}
    verdict: testable
```
