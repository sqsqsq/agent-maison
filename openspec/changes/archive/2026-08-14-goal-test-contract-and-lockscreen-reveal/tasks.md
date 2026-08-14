## 1. Testing failure attribution

- [x] 1.1 Add trusted root-classification aggregation and refine only nonempty all-`test_contract` testing evidence after binding checks
- [x] 1.2 Persist the refined kind and cover same-process retry plus `--resume` prompt restoration without coding backtrack

## 2. HarmonyOS lockscreen recovery

- [x] 2.1 Implement one-shot reveal, fresh snapshot, scoped PIN/cooldown parsing, zero-input fail-safe, and sanitized notes
- [x] 2.2 Drive parser regression from all four committed sanitized device-lockscreen fixtures, including clock digits, `numKeyBoard` decoys, face hint, and mixed partial keypad
- [x] 2.3 Confirm on the physical host that one readiness-gate invocation emits `device_unlock_attempt=succeeded` followed by `device_ready` PASS
  - Evidence: `harness/tests/fixtures/device-lockscreen/acceptance/f4b2c8e6-live-gate-2026-07-30T064556Z/{events.jsonl,verification.json}`; production source SHA-256 values are rechecked by the device-lockscreen parser unit suite

## 3. Documentation and verification

- [x] 3.1 Update the goal-mode runbook for the `test_contract` retry branch and document `uiInput swipe` velocity semantics in code
- [x] 3.2 完成 strict OpenSpec validation、harness tests、plan-version check 和发布包验证；开发窗口内使用 `npm run release:verify -- --skip-typecheck --skip-plan-release-gate` 验证包内容，最终不跳过的窗口级 plan 发布门由 `candidate:promote` / `release:all` 统一执行。
