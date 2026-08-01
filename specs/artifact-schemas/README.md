# Skill-authored artifact schemas

This directory is the compatibility registry for narrative artifacts exchanged by
feature skills. `inventory.yaml` is the complete registered set and every entry is
identified as `<name>@<major>`.

These schemas define compatibility shape and identity. They do not replace:

- `specs/phase-rules/*.yaml`, which declare phase-level policy;
- `harness/scripts/check-*.ts`, which enforce semantic and environment truth;
- existing control-plane schemas for summaries, receipts, traces, `feature.yaml`,
  assessment output, and goal manifests.

A breaking artifact-shape change requires a new artifact major and a migration
entry. Non-breaking skill implementation changes retain the existing identifier.
