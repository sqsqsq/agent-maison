# Fixture：可测性审计

```yaml
records:
  - acceptance_id: AC-V25
    entry_point:
      symbol: DemoRepository.fetchData
    testability_level: L1
    dependencies:
      - name: DemoRepository
        kind: di_injectable
        seam: constructor_injection
    verdict: testable
```
