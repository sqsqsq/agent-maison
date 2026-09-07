# Tasks

## 1. Shared entry-gate helper (plan c7d2a9e4 D1)

- [x] 1.1 Lift `applyPhaseEntryDeviceGate` (gate → notes → managed-reclaim registration → atomic env injection) into
      `harness/scripts/utils/device-readiness-gate.ts` with no semantic change; keep the injection points needed to
      test "registered before any return" and "no injection when the gate throws"
- [x] 1.2 Add the optional `PhaseEntryDeviceGateDecision.code` (`device_policy_unset` / `ambiguous` / `blocked`) at the
      three existing `ok:false` returns; the corrupted-frozen return stays without a code
- [x] 1.3 `harness-runner.ts` calls the helper; `buildTestingTargetKindCap` / `deviceConclusionCap` and both
      `process.exit(1)` branches stay where they are

## 2. Ad-hoc CLI wiring (plan c7d2a9e4 D1)

- [x] 2.1 `--dump-ui-only`: gate after `ensureHylyreReady`, before `runAdhocDumpUi`; failure exits before any device command
- [x] 2.2 Execute / `--observe-ui`: gate after `ensureHylyreReady`, before `resolveMainAbilityForBundle`; failure writes the
      trace placeholder with `error_kind='device_not_ready'` then exits
- [x] 2.3 Derive-only and usage-error branches do not open the gate; the top-level `HARNESS_HDC_TARGET` read moves after
      the gate; add the `ADHOC_PHASE=device_gate` anchor
- [x] 2.4 Add `device_not_ready` to `AdhocErrorKind`

## 3. Standalone readiness entry (plan c7d2a9e4 D2)

- [x] 3.1 `device-policy.ts --ready [--serial <sn>] [--json]`: non-frozen goes through the shared helper; frozen keeps the
      frozen target and `resolveAttemptCredentialRef` and reuses `ensureDeviceReadyAtRuntime`; only `recovered=true` is
      success; `unknown` reports blocked with "lock state could not be confirmed"; a differing `--serial` is refused with
      zero device operations
- [x] 3.2 `--json` follows the `--check` two-part contract (a completed judgement exits 0; execution failure exits non-zero
      with no JSON); human mode keeps 0 / 3 / 1; add `npm run device:ready`

## 4. Tests and verification

- [x] 4.1 `device-readiness-gate`: helper behaviour (injection, reclaim registration before return, rethrow without
      injection, frozen pass-through) plus the three `code` values; re-aim the wiring assertions at the helper source and
      add the ad-hoc block slices (dump / execute / derive-only)
- [x] 4.2 `device-policy-cli`: `--ready` matrix, fully injected — no real credential store, no real hdc, no device
- [x] 4.3 `adhoc-trace-placeholder`: `device_not_ready` round-trip
- [x] 4.4 `npm --prefix harness run typecheck` + the three `test:unit --filter` runs + `npm run openspec:validate`
- [ ] 4.5 Host acceptance (user-triggered, not part of this change's completion): `--ready --json` on the host reaches
      `code=ready` with `target_kind=physical` and the device unlocks; an ad-hoc `--dump-ui-only` shows
      `ADHOC_PHASE=device_gate` and no longer prints "未显式指定目标，跳过就绪检查"
