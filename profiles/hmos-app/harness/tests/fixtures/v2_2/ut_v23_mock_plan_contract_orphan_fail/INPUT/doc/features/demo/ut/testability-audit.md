# 将 AC-V27 标为 L3，option_a，且 device-testing-todo 可追溯

```yaml
records:
  - acceptance_id: AC-V27
    entry_point:
      symbol: DemoRepository.fetchData
    testability_level: L3
    dependencies:
      - name: JumpManager
        kind: global_singleton
        seam: none
    verdict: downgrade_device
    recommendation:
      option_a: device
      option_b: seam
    selected: option_a
```
