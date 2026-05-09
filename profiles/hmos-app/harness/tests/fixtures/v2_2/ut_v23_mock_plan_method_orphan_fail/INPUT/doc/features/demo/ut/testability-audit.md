# AC-V30 L1——mock-plan 方法名将与 contracts 不一致

```yaml
records:
  - acceptance_id: AC-V30
    entry_point:
      symbol: DemoRepository.fetchData
    testability_level: L1
    dependencies:
      - name: DemoRepository
        kind: di_injectable
        seam: constructor_injection
    verdict: testable
```
