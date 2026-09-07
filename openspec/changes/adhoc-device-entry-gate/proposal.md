# adhoc-device-entry-gate

## Why

The ad-hoc device CLI (`harness/scripts/adhoc-device-test.ts`) has never been wired to the device entry gate,
and there is no standalone "get the device ready" entry at all.

**F01 — the ad-hoc CLI issues device commands without ever resolving a target.** Its only reference to a device
target was one top-level `const deviceSn = process.env.HARNESS_HDC_TARGET`; nothing in the process ever injected
that variable. Only two producers exist: the goal readiness gate (`deviceEnvFor`) and normal mode's
`runPhaseEntryDeviceGate`. The ad-hoc CLI is in neither path, and appears in no earlier plan's wiring list.

**F02 — with no injected target, the recovery bridge is a no-op by design.** Since the bridge stopped resolving
targets itself, an unset `HARNESS_HDC_TARGET` yields `未显式指定目标，跳过就绪检查（不对未知设备动手）`.
So an ad-hoc run on a locked phone reaches `aa start` → `screen is locked` → `device_locked`, while a perfectly
good unlock credential sits registered and unused. Registering the PIN changes nothing on this path.

**F03 — "unlock the phone" is not a runnable action.** There is no `device:unlock` / `--ready` style command
anywhere in the repo. Unlocking exists only as a side effect of re-running a device phase, so a user request to
just unlock or just check the device has no entry point that is independent of feature / bundle / acceptance.

## What Changes

**One shared helper carries the entry-gate wiring; the ad-hoc CLI becomes a proper entry.** `applyPhaseEntryDeviceGate`
(gate → notes → managed-reclaim registration → atomic env injection) is lifted out of `harness-runner.ts` unchanged
and reused by the ad-hoc CLI's three device-touching branches: `--dump-ui-only`, execute (`--plan` / `--steps-file`)
and `--observe-ui`. The gate runs after `ensureHylyreReady` (which can spend half a minute in pip and touches no
device) and before the first device command of each branch. Derive-only and usage-error branches do not open the
gate — they touch no device. A gate failure prints the reason and exits before any device command; execute/observe
also write the existing trace placeholder with a new `error_kind: 'device_not_ready'`. The top-level
`HARNESS_HDC_TARGET` read moves after the gate.

**A standalone readiness entry: `device-policy --ready [--serial] [--json]` (`npm run device:ready`).** Outside a
frozen attempt it goes through the same entry gate — no second target resolution. Inside a frozen attempt
(`MAISON_DEVICE_ATTEMPT_FROZEN=1`) it does **not** open the gate (there the gate only ever waves the phase through
and cannot answer "is the device ready right now"); it keeps the frozen target and the frozen authorization and
reuses `ensureDeviceReadyAtRuntime`. Only `recovered=true` is success: `unauthorized` / `unlock_failed` and the
undecidable `unknown` all report `ok=false, code='blocked'`, and `unknown` says the lock state could not be
confirmed rather than claiming the device is locked. A `--serial` that differs from the frozen target is refused
with zero device operations. `--json` follows the two-part `--check` contract: a completed judgement always exits 0
and the caller reads `code`; only an execution failure exits non-zero with no JSON on stdout.

**No new judgement.** `ensureDeviceReady`, `runPhaseEntryDeviceGate` (including its frozen pass-through),
`ensureDeviceReadyAtRuntime`, `collectPolicyStatus` and the recovery bridge keep every decision they had. The
decision object gains one optional `code` (`device_policy_unset` / `ambiguous` / `blocked`) so the JSON contract can
tell "policy not configured" from "device blocked" without parsing prose or re-running the policy check.

## Impact

- **Affected specs**: `harness-gates` — one MODIFIED requirement, extended from normal-mode device phases to the
  ad-hoc CLI and the standalone readiness entry. No new requirement, no new diagnosis kind.
- **Affected code**: `harness/scripts/utils/device-readiness-gate.ts`, `harness/harness-runner.ts`,
  `harness/scripts/adhoc-device-test.ts`, `harness/scripts/utils/adhoc-trace-placeholder.ts`,
  `harness/scripts/device-policy.ts`, `harness/package.json`.
- **Breaking**: behaviourally yes for ad-hoc runs. An ad-hoc run used to pick the single online device implicitly and
  never asked about policy; it now fails fast on `device_policy_unset`, so an existing user meets the four-way choice
  once (a `manual` host clears it with one `device:set -- --manual-unlock`). Registered credentials are finally used.
- **放弃的准确性**: (1) every ad-hoc execution now pays one wake + snapshot (~1–3 s on an unlocked device), and a
  `managed` host may start an emulator instance; (2) `--ready` holds no session and does not pass its target to the
  next command — under `managed` it can only prove "it can come up and be ready", then reclaims; (3) inside a frozen
  attempt `--ready` only performs runtime recovery: it does not re-check policy, re-resolve or switch targets, and an
  undecidable probe reports blocked rather than passing — a standalone command has no follow-up operation that could
  expose a wrong guess; (4) `ok=true` proves readiness for this call only; a later lock-screen timeout is handled by
  the existing runtime recovery, and no polling / keep-alive is added.
