import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { readVerifierSummaryRows } from '../../scripts/utils/repair-candidates';
import { readVerifierUtSourcePaths, selectVerifierItemScope, verifierTemplateCheckIds } from '../../scripts/utils/verifier-item-scope';
import type { VerifierMaterialView } from '../../scripts/utils/verifier-material';
import type { UnitCaseResult } from '../run-unit';

const frameworkRoot = path.resolve(__dirname, '../../..');
const header = '| id | status | severity | 证据（一行） |\n|---|---|---|---|\n';
const report = header
  + '| logic | PASS | MAJOR | `src/behavior.ets:11`、`contracts/acceptance.yaml:22` |\n'
  + '| contract | FAIL | BLOCKER | `src/boundary.ets:7`、`contracts/acceptance.yaml:30` |\n';
const applicableIds = ['logic', 'contract'];
const files = ['src/behavior.ets', 'src/boundary.ets', 'contracts/acceptance.yaml', 'src/untested.ets'];
const material: VerifierMaterialView = {
  schema: 'maison-verifier-material@2',
  phase: 'coding',
  feature: 'demo',
  gate_fingerprint: '3.1.0:gate',
  phase_rule_sha256: 'phase',
  template_sha256: 'template',
  lifecycle_sha256: '',
  extension_sha256: '',
  script_checks: ['some_check=PASS/BLOCKER'],
  files: files.map(file => ({ path: file, sha256: 'old' })),
  material_sha256: 'current',
};

function changed(...paths: string[]): VerifierMaterialView {
  return {
    ...material,
    files: material.files.map(file => paths.includes(file.path) ? { ...file, sha256: 'changed' } : file),
  };
}

const cases: Array<{ name: string; run(): void }> = [
  { name: '四列原件保留状态、严重度、证据及物理行，拒绝歧义但允许缺项', run: () => {
    const rows = readVerifierSummaryRows('## Summary\n\n' + report);
    assert.deepStrictEqual(rows?.map(row => [row.id, row.status, row.severity, row.line]), [
      ['logic', 'PASS', 'MAJOR', 5], ['contract', 'FAIL', 'BLOCKER', 6],
    ]);
    assert.equal(rows?.[1].evidence, '`src/boundary.ets:7`、`contracts/acceptance.yaml:30`');
    assert.equal(readVerifierSummaryRows(report + '| logic | PASS | MAJOR | echo |\n'), null);
    assert.equal(readVerifierSummaryRows(report.replace('PASS |', 'PASS / FAIL |')), null);
    assert.equal(readVerifierSummaryRows(report.replace('PASS |', 'SKIP |'))?.[0].status, 'SKIP');
    assert.deepStrictEqual(readVerifierSummaryRows(header), []);
    for (const phase of ['spec', 'plan', 'coding', 'review', 'ut', 'testing']) {
      const template = fs.readFileSync(path.join(frameworkRoot, 'harness/prompts', `verify-${phase}.md`), 'utf8');
      assert(verifierTemplateCheckIds(template).includes('reference_crosscheck'), phase);
    }
  } },
  { name: '局部差异只复核旧引用关联项，共享未变验收不重开原 FAIL', run: () => {
    const scope = selectVerifierItemScope({
      previousMaterial: material, currentMaterial: changed('src/behavior.ets'), previousReportText: report, applicableIds,
    });
    assert.equal(scope.mode, 'partial');
    assert.deepStrictEqual(scope.reviewIds, ['logic']);
    assert.deepStrictEqual(scope.reviewPaths, ['src/behavior.ets', 'contracts/acceptance.yaml']);
    assert.deepStrictEqual(scope.reusedRows, readVerifierSummaryRows(report)?.slice(1));
  } },
  { name: '未引用的变动、新路径和无法归项的非路径变化一律完整核验', run: () => {
    const known = changed('src/behavior.ets');
    for (const currentMaterial of [
      changed('src/untested.ets'),
      { ...material, files: [...material.files, { path: 'src/new.ets', sha256: 'new' }] },
      { ...known, gate_fingerprint: 'new-gate' },
      { ...known, phase_rule_sha256: 'new-rules' },
      { ...known, template_sha256: 'new-template' },
      { ...known, goal_brief_sha256: 'new-brief' },
      { ...known, script_checks: ['some_check=FAIL/BLOCKER'] },
      { ...material, input_bindings_sha256: 'new-deletion-preimage' },
    ]) {
      const scope = selectVerifierItemScope({ previousMaterial: material, currentMaterial, previousReportText: report, applicableIds });
      assert.equal(scope.mode, 'full');
      assert.deepStrictEqual(scope.reviewIds, applicableIds);
      assert.deepStrictEqual(scope.reusedRows, []);
    }
  } },
  { name: '同材料旧薄报告只补当前必核项；可读表只补缺项，歧义表则全审', run: () => {
    const prior = { previousMaterial: material, currentMaterial: material, applicableIds };
    assert.equal(selectVerifierItemScope({ ...prior, previousReportText: 'PASS' }).mode, 'reuse');
    const requiredIds = ['logic'];
    assert.deepStrictEqual(selectVerifierItemScope({ ...prior, previousReportText: 'PASS', requiredIds }).reviewIds, ['logic']);
    assert.deepStrictEqual(selectVerifierItemScope({
      ...prior, previousReportText: header + '| contract | FAIL | BLOCKER | original evidence |\n', requiredIds,
    }).reviewIds, ['logic']);
    assert.equal(selectVerifierItemScope({
      ...prior, previousReportText: report + '| logic | FAIL | MAJOR | conflicting |\n', requiredIds,
    }).mode, 'full');
    assert.deepStrictEqual(selectVerifierItemScope({
      ...prior, previousReportText: report, requiredIds, recheckIds: ['logic'],
    }).reviewIds, ['logic']);
  } },
  { name: 'Review 按原逐条 issue 的证据和 production_paths 定位同次裁决', run: () => {
    const previousMaterial = { ...material, phase: 'review' };
    const previousReportText = header + '| issue_accuracy | WARN | BLOCKER | CR-001 待核 |\n'
      + '| false_positive_rate | WARN | MAJOR | 0/1 |\n'
      + '| contract | FAIL | BLOCKER | contracts/acceptance.yaml:22 |\n'
      + '```issue-verification\n- issue: CR-002\n  verdict: confirmed\n  evidence: src/behavior.ets | retain note\n'
      + '  production_paths: [src/boundary.ets]\n  repair_owner: coding\n```\n';
    for (const changedPath of ['src/behavior.ets', 'src/boundary.ets']) {
      const scope = selectVerifierItemScope({
        previousMaterial, currentMaterial: { ...changed(changedPath), phase: 'review' }, previousReportText,
        applicableIds: ['issue_accuracy', 'false_positive_rate', 'contract'],
      });
      assert.equal(scope.mode, 'partial');
      assert.deepStrictEqual(scope.reviewIds, ['issue_accuracy', 'false_positive_rate']);
      assert.deepStrictEqual(scope.reusedRows.map(row => row.id), ['contract']);
    }
  } },
  { name: '真实 S1 UT 逐项表保留端到端 FAIL，只对旧测试引用调用 profile 源码选择', run: () => {
    const projectRoot = path.join(frameworkRoot, 'harness/tests/fixtures/host-recovery-history/20261024-fe4512-s1');
    const reports = path.join(projectRoot, 'doc/features/bc-openCard-2/bank-card-opening-flow/ut/reports');
    const subject = '2b978a65cde9d86a01a9ce3359f339aef6123f799bf985126a12c0478412c85c';
    const reportText = fs.readFileSync(path.join(reports, `verifier.report.${subject}.md`), 'utf8');
    const previousMaterial = JSON.parse(fs.readFileSync(path.join(reports, `verifier.material.${subject}.json`), 'utf8')) as VerifierMaterialView;
    const sources = readVerifierUtSourcePaths({ projectRoot, frameworkRoot, feature: previousMaterial.feature,
      phase: 'ut', material: previousMaterial, reportText });
    assert(sources.end_to_end_driving?.some(file => file.endsWith('/BankCardOpeningService.ets')));
    assert(!sources.device_ac_delegation, '只声明设备委派的旧行不可推断有 UT 业务源码引用');
    const rows = readVerifierSummaryRows(reportText);
    assert.equal(rows?.find(row => row.id === 'end_to_end_driving')?.status, 'FAIL');
    assert.equal(rows?.find(row => row.id === 'business_assertion_value')?.status, 'PASS');
  } },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(({ name, run }) => {
    try { run(); return { name, ok: true }; }
    catch (error) { return { name, ok: false, error: (error as Error).stack }; }
  });
}
