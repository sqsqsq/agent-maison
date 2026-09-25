# 可测性审计

```yaml
records:
  - acceptance_id: AC-1
    entry_point: {file: 02-Feature/FinancialCard/src/main/ets/BankRepository.ets, symbol: list}
    testability_level: L1
    dependencies:
      - {name: Array, kind: pure}
    verdict: testable
  - acceptance_id: AC-2
    entry_point: {file: 02-Feature/FinancialCard/src/main/ets/BankService.ets, symbol: openCard}
    testability_level: L1
    dependencies:
      - {name: BankRepository, kind: external}
    verdict: testable
```
