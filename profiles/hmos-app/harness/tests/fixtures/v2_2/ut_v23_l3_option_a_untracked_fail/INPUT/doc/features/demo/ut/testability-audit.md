# Fixture：L3 + option_a 但未在 acceptance.device_focus 登记

```yaml
records:
  - acceptance_id: AC-V26
    entry_point:
      symbol: DemoRepository.fetchData
    testability_level: L3
    dependencies:
      - name: JumpManager
        kind: global_singleton
        seam: none
    verdict: downgrade_device
    recommendation:
      option_a: fixture device-only
      option_b: seam
    selected: option_a
```
