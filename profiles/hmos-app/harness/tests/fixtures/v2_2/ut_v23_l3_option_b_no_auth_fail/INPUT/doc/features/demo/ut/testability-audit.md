# L3 option_b — 未有 gap-notes 授权（fixture 阴性）

```yaml
records:
  - acceptance_id: AC-V28
    entry_point:
      symbol: DemoRepository.fetchData
    testability_level: L3
    dependencies:
      - name: JumpManager
        kind: global_singleton
        seam: none
    verdict: needs_seam
    recommendation:
      option_a: device-only
      option_b: 源码接缝 + gap-notes 授权
    selected: option_b
```
