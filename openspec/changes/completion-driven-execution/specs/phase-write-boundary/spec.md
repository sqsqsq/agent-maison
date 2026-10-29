## ADDED Requirements

### Requirement: Work-unit authority follows artifact responsibility

For work-unit calls the boundary SHALL derive writable source, test inputs and candidate artifacts from existing Skill I/O, profile and trusted scope. A phase name MUST NOT prevent the authorized author from repairing implementation and writing tests. Original requirements, shared published design, framework and formal result evidence MUST remain protected. Enforcement: phase-write-boundary.ts and repair-responsibility.ts.

#### Scenario: The author writes code and test input
- **WHEN** both changes belong to the existing authorized work unit
- **THEN** their writes are attributed to the same invocation without requiring a phase author handoff

#### Scenario: The author writes a formal result
- **WHEN** an author creates a PASS record, screenshot or other formal evidence
- **THEN** the boundary rejects the unauthorized result write and cannot turn it into trusted completion

#### Scenario: A verifier returns its own original report
- **WHEN** a read-only independent invocation has one runtime-issued result path
- **THEN** only that result path is writable and other design/product/evidence files remain protected
