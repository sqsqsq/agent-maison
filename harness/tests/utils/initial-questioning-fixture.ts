import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { runGoalModeSessionStep } from '../../scripts/goal-mode-entry';
import { readSessionExecution } from '../../scripts/utils/session-execution-handoff';
import type { BlueprintRecord } from '../../scripts/utils/component-blueprint-model';
import { withRuntimeTest } from './runtime-test-control';

/** A declared input of the synthetic Ledger blueprint, not a claimed product implementation. */
export function seedLedgerQuestioningInput(projectRoot: string): void {
  const file = path.join(projectRoot, 'src/ledger/LedgerRepository.ts');
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'export class LedgerRepository {}\n');
}

/** Supply one finite independent response through the actual signed request/report transport. */
export async function reportFixtureQuestioning(
  options: Parameters<typeof runGoalModeSessionStep>[0],
  pending: Record<string, unknown>,
  runDir: string,
  blueprintPath: string,
  inspect?: (questioning: BlueprintRecord, blueprint: BlueprintRecord) => void,
) {
  assert.equal(pending.type, 'phase_execute_request');
  const requestPath = (pending.request as { path: string }).path;
  const issued = readSessionExecution(runDir, requestPath)!;
  assert.equal(issued.request.purpose, 'questioning');
  assert.equal(issued.request.write_boundary?.executionRole, 'verifier');
  assert(issued.request.pre_snapshot, 'independent Q requires its real preimage');
  const blueprint = YAML.parse(fs.readFileSync(blueprintPath, 'utf8')) as BlueprintRecord;
  const questioning = structuredClone((blueprint.review_summary as BlueprintRecord).questioning) as BlueprintRecord;
  assert(Array.isArray(questioning.items) && questioning.items.length > 0);
  inspect?.(questioning, blueprint);
  return withRuntimeTest({ root: options.projectRoot }, () => runGoalModeSessionStep({ ...options, requestPath, report: { status: 'passed', phase: issued.request.context.phase,
    details: JSON.stringify({ items: questioning.items }) } }));
}
