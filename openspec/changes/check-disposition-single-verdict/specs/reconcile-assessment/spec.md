## ADDED Requirements

### Requirement: Result-basis failures route by their registered owner

A failed check registered in the disposition table as `result_basis` SHALL carry an executable owner exit. When the owner is the current phase (or names the phase the check failed in), the summary SHALL carry no repair candidate for it and assessment SHALL recommend rerunning that phase through the existing retry route; it SHALL NOT be handed a candidate that assessment would exclude as the current phase and then stop on a missing backtrack target. When the owner is an upstream phase among spec, plan and coding, the summary writer SHALL produce a repair candidate of that category from the same effective owner mapping used by the existing ownership registry, and assessment SHALL recommend backtracking to it through the existing candidate route.

Enforcement: `harness/scripts/utils/repair-candidates.ts`, `harness/scripts/utils/check-disposition.ts`, `harness/scripts/utils/assess.ts`

#### Scenario: A current-phase result-basis failure reruns the phase

- **WHEN** spec fails on `ref_elements_excluded`, registered as `result_basis` owned by the current phase
- **THEN** the spec summary SHALL carry no repair candidate, and assessment SHALL recommend rerunning spec rather than a backtrack

#### Scenario: An upstream-owned result-basis failure backtracks

- **WHEN** a plan round fails on a check registered as `result_basis` owned by spec
- **THEN** the summary SHALL carry one `spec` repair candidate for it and assessment SHALL recommend backtracking to spec

### Requirement: Lite closure and closed-phase routing read the shared phase conclusion

Assessment's lite-track closure and the correction command's closed-phase set SHALL read the phase summary's verdict — the shared phase conclusion — instead of the script report's legacy verdict. The correction command SHALL fall back to the script report's verdict only when no summary file exists; the component closure evidence SHALL read the summary registered beside the script report in the phase evidence manifest and fall back only when the manifest registers none. A script report whose legacy verdict passes while the summary does not SHALL NOT close a lite phase.

Enforcement: `harness/scripts/utils/assess.ts`, `harness/scripts/utils/correction-commands.ts`, `harness/scripts/utils/component-closure-evidence.ts`

#### Scenario: A report-validity failure keeps a lite phase open

- **WHEN** a lite-track phase's script report says PASS but its summary says FAIL because report validity failed
- **THEN** assessment SHALL observe the phase as open
