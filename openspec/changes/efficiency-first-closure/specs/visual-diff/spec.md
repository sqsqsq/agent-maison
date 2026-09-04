# visual-diff Spec Delta

## ADDED Requirements

### Requirement: Geometry measurement is a fact producer with three-axis status

`--measure --feature <f> [--screen <id>]` SHALL read the screen's layout dump and screenshot and produce recomputable facts for the ui-spec declared elements: bounds, card edges, spacing and row pitch, overlaps, reference-versus-device deltas in px and in vp derived from row pitch, and color samples. It SHALL write `measure-<screen_id>.json` and print a human-readable table. Status SHALL be reported on three axes: geometry PASS/FAIL (thresholds from the ui-spec element tolerance; a profile default is advisory only), content CHECKED/UNKNOWN, style CHECKED/UNKNOWN. Measurement SHALL fill `defects[].note` facts in `visual-diff.json` but SHALL NOT rewrite the ui-spec source, SHALL NOT override an agent or provider verdict, SHALL NOT equal a pixel_1to1 PASS, and geometry PASS SHALL NOT lift the visual or release block by itself. At most a bbox suggestion MAY be printed for spec use.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`, `profiles/hmos-app/harness/layout-oracle-check.ts`, `harness/harness-runner.ts`

#### Scenario: Measurement never becomes a verdict

- **WHEN** every measured delta is within tolerance
- **THEN** the screen's verdict stays whatever the agent or provider recorded and release readiness is unchanged

## MODIFIED Requirements

### Requirement: Empty defects on a pixel_1to1 P0 pass screen require region attestation

When a visual provider is available, a pixel_1to1 P0 pass screen with `defects: []` SHALL carry provider-produced `region_attest[]`. When no visual provider is available, the attestation requirement SHALL be SKIP: the machine geometry status and the agent's ordinary visual judgment SHALL be recorded, content and style SHALL be disclosed as UNKNOWN, and functional completion SHALL NOT be blocked by the missing attestation.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`

#### Scenario: No provider, no fake attestation

- **WHEN** the profile resolves no visual provider and a P0 screen passes geometry
- **THEN** the gate reports SKIP for region attestation and UNKNOWN for content/style instead of demanding an attestation nobody can produce

### Requirement: Paired-crop evidence and critic receipt are validated, provenance stated honestly

When a provider produced `region_attest` with `method: paired_crop_compare`, the evidence crop SHALL exist, be fresh and carry recomputable hashes. When no provider exists, the critic receipt and paired-crop requirements SHALL be SKIP, never WARN or FAIL.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`

#### Scenario: Missing critic receipt without a provider is not a finding

- **WHEN** no visual provider is registered for the profile
- **THEN** `visual_diff_critic_receipt` reports SKIP
