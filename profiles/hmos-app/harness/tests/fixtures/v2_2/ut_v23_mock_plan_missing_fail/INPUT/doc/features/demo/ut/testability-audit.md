# AC-V29 判为 L1，须 mock-plan，本 fixture 刻意不写 mock-plan.yaml

```yaml
records:
  - acceptance_id: AC-V29
    entry_point:
      symbol: DemoRepository.fetchData
    testability_level: L1
    dependencies:
      - name: DemoRepository
        kind: di_injectable
        seam: constructor_injection
    verdict: testable
```
