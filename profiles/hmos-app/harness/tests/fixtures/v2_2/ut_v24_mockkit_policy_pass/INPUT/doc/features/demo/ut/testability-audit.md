```yaml
records:
  - acceptance_id: AC-V24
    entry_point:
      symbol: DemoFlow.submit
    testability_level: L1
    dependencies:
      - name: DemoRepository
        kind: di_injectable
        seam: constructor_injection
    verdict: testable
```
