import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { loadCanonicalBlueprint } from '../../scripts/utils/component-blueprint-path';
import { collectBlueprintReviewInputs } from '../../scripts/utils/blueprint-review-inputs';
import { selectBlueprintSkillContent } from '../../scripts/utils/blueprint-skill-projection';
import { loadCanonicalChangeUnit, asChangeUnitArtifact } from '../../scripts/utils/change-unit-path';
import type { UnitCaseResult } from '../run-unit';

/** 2026-10-11 宿主原字节隔离材料；测试从不读取或写入活宿主。 */
const original = path.resolve(__dirname, '../fixtures/blueprint-host-repair/project');
const workspace = 'doc/features/bc-openCard-2';
const cases: Array<{ name: string; run(root: string): void }> = [
  { name: 'real host rev2 and four exact CU generations keep current binding and merged declarations', run(root) {
    const inputs = collectBlueprintReviewInputs(root, loadCanonicalBlueprint(root, 'bc-openCard-2'));
    assert.deepStrictEqual(inputs.sourceGaps, [], JSON.stringify(inputs.sourceGaps));
    const current = inputs.units.find(unit => unit.id === 'bank-card-issue-v4')!;
    assert.equal(current.binding, 'bound', JSON.stringify(current.errors));
    assert.equal(current.digest, undefined, 'old pointers make neutral equivalence unavailable without unbinding the current CU');
    assert(inputs.units.filter(unit => unit.retiredBy).every(unit => unit.binding === 'pending'));
    assert.equal(inputs.units.filter(unit => unit.retiredBy).length, 3);
    const content = selectBlueprintSkillContent(loadCanonicalBlueprint(root, 'bc-openCard-2').blueprint, current.unit!);
    assert((content.acceptance?.criteria as Array<{ id: string }>).some(row => row.id === 'AC-16'));
    assert((content.contracts?.files as string[]).some(file => file.includes('bank_result_success_icon.png')));
    assert.equal(content.contracts?.change_unit, undefined);
  } },
  { name: 'real host predecessor hash tampering remains a publication source gap', run(root) {
    const file = path.join(root, workspace, 'bank-card-issue-v4/change-unit.yaml');
    const cu = YAML.parse(fs.readFileSync(file, 'utf8')); cu.supersedes.artifact_sha256 = 'sha256:' + 'f'.repeat(64); fs.writeFileSync(file, YAML.stringify(cu));
    const inputs = collectBlueprintReviewInputs(root, loadCanonicalBlueprint(root, 'bc-openCard-2'));
    assert(inputs.sourceGaps.some(gap => gap.includes('component_closure_supersedes_invalid')));
    assert.equal(inputs.units.find(unit => unit.id === 'bank-card-issue-v4')?.binding, 'unresolved');
  } },
  { name: 'real host missing predecessor and current bad target remain visible', run(root) {
    fs.unlinkSync(path.join(root, workspace, 'bank-card-issue-v3/change-unit.yaml'));
    let inputs = collectBlueprintReviewInputs(root, loadCanonicalBlueprint(root, 'bc-openCard-2'));
    assert(inputs.sourceGaps.some(gap => gap.includes('bank-card-issue-v3')));
    const loaded = loadCanonicalChangeUnit(root, 'bc-openCard-2', 'bank-card-issue-v4');
    const cu = asChangeUnitArtifact(loaded.changeUnit); cu.design_refs[0].target.id = 'missing-current-design'; fs.writeFileSync(loaded.canonicalPath, YAML.stringify(cu));
    inputs = collectBlueprintReviewInputs(root, loadCanonicalBlueprint(root, 'bc-openCard-2'));
    assert.equal(inputs.units.find(unit => unit.id === 'bank-card-issue-v4')?.binding, 'unresolved');
    assert(inputs.sourceGaps.some(gap => gap.includes('missing-current-design')));
  } },
];
export function runAll(): UnitCaseResult[] {
  return cases.map(test => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blueprint-host-history-')); try { fs.cpSync(original, root, { recursive: true }); test.run(root); return { name: test.name, ok: true }; } catch (error) { return { name: test.name, ok: false, error: (error as Error).stack }; } finally { fs.rmSync(root, { recursive: true, force: true }); } });
}
