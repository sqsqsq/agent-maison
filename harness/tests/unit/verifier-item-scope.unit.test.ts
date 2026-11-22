import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { readVerifierSummaryRows } from '../../scripts/utils/repair-candidates';
import { citesIssue, readVerifierUtSourcePaths, selectVerifierItemScope, verifierTemplateCheckIds } from '../../scripts/utils/verifier-item-scope';
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

function failedResult(blockers: number): string {
  return '\n<!-- maison-verifier-result:v1 -->\n'
    + `verifier_subject_id: ${'a'.repeat(64)}\nverdict: FAIL\nblocker_count: ${blockers}\n`
    + '<!-- /maison-verifier-result:v1 -->\n';
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
  { name: '同一 Review 文件的普通行号、长破折号范围和整文件引用均复核', run: () => {
    const reviewPath = 'doc/features/bc-openCard-2/open-card-flow/review/review-report.md';
    const previousMaterial = { ...material, phase: 'review',
      files: [{ path: reviewPath, sha256: 'old' }, { path: 'spec/ui-spec.yaml', sha256: 'old' }] };
    const currentMaterial = { ...previousMaterial,
      files: [{ path: reviewPath, sha256: 'changed' }, previousMaterial.files[1]] };
    for (const reference of ['`review/review-report.md`', 'review/review-report.md', '[审查原文](review/review-report.md#L86)']) {
      const previousReportText = header
        + '| blocker_threshold | PASS | BLOCKER | `review/review-report.md:93` 对应不通过结论。 |\n'
        + '| review_dimension_coverage | WARN | MAJOR | `spec/ui-spec.yaml:585、review/review-report.md:54–80` 覆盖架构、接口、异常、功能及视觉。 |\n'
        + `| coding_rules_referenced | WARN | MINOR | ${reference} 未明确引用具体规则 ID。 |\n`
        + '| reference_crosscheck | PASS | MAJOR | `spec/ui-spec.yaml:585` 与原文一致；排除 `../review/review-report.md`、`/review/review-report.md`、`C:\\review\\review-report.md` 及 `https://remote/review/review-report.md`。 |\n';
      const applicableIds = ['blocker_threshold', 'review_dimension_coverage', 'coding_rules_referenced', 'reference_crosscheck'];
      const scope = selectVerifierItemScope({ previousMaterial, currentMaterial, previousReportText, applicableIds });
      assert.equal(scope.mode, 'partial');
      assert.deepStrictEqual(scope.reviewIds, ['blocker_threshold', 'review_dimension_coverage', 'coding_rules_referenced'], reference);
      assert.deepStrictEqual(scope.reusedRows.map(row => row.id), ['reference_crosscheck']);
      const specChange = { ...previousMaterial, files: [previousMaterial.files[0], { path: 'spec/ui-spec.yaml', sha256: 'changed' }] };
      assert.deepStrictEqual(selectVerifierItemScope({ previousMaterial, currentMaterial: specChange, previousReportText,
        applicableIds }).reviewIds, ['review_dimension_coverage', 'reference_crosscheck']);
    }
  } },
  { name: '简名 index.ets 关联所有同名绑定，限定路径仍只关联其目标', run: () => {
    const phone = '01-Product/Phone/src/main/ets/pages/index.ets';
    const wallet = '02-Feature/WalletMain/src/main/ets/index.ets';
    const account = '04-BusinessBase/AccountManager/src/main/ets/index.ets';
    const previousMaterial = { ...material, files: [phone, wallet, account, 'index.ets'].map(file => ({ path: file, sha256: 'old' })) };
    const previousReportText = header
      + '| business_logic_correctness | PASS | MAJOR | `index.ets:26` 落实路由。 |\n'
      + `| spec_acceptance_to_code | PASS | MAJOR | \`${phone}:26\` 注册路由。 |\n`
      + `| reference_crosscheck | PASS | MAJOR | \`${wallet}:14\` 导出入口。 |\n`
      + '| route_registration | PASS | MAJOR | Phone/pages/index.ets:26–39，对应路由。 |\n'
      + '| module_export | PASS | MAJOR | `WalletMain/index.ets:11-17` 导出 builder。 |\n'
      + '| other_module | PASS | MAJOR | `MissingModule/index.ets:18` 不在旧绑定中。 |\n';
    const applicableIds = ['business_logic_correctness', 'spec_acceptance_to_code', 'reference_crosscheck',
      'route_registration', 'module_export', 'other_module'];
    for (const [changedPath, extra] of [[phone, ['spec_acceptance_to_code', 'route_registration']],
      [wallet, ['reference_crosscheck', 'module_export']], [account, []], ['index.ets', []]] as const) {
      const currentMaterial = { ...previousMaterial, files: previousMaterial.files.map(file =>
        file.path === changedPath ? { ...file, sha256: 'changed' } : file) };
      const scope = selectVerifierItemScope({ previousMaterial, currentMaterial, previousReportText, applicableIds });
      assert.equal(scope.mode, 'partial', changedPath);
      const reviewIds = ['business_logic_correctness', ...extra];
      assert.deepStrictEqual(scope.reviewIds, reviewIds, changedPath);
      assert.deepStrictEqual(scope.reusedRows.map(row => row.id), applicableIds.filter(id => !reviewIds.includes(id)), changedPath);
    }
  } },
  { name: '局部复核补有归属的旧负面证据缺口，终态仍有无法归属的 BLOCKER 才全审', run: () => {
    const input = { previousMaterial: material, currentMaterial: changed('src/behavior.ets'),
      applicableIds: ['logic', 'contract', 'known_warn', 'optional'] };
    const sections = report.replace('`src/boundary.ets:7`、`contracts/acceptance.yaml:30`', '')
      + '| known_warn | WARN | MAJOR |  |\n';
    const partial = selectVerifierItemScope({ ...input, previousReportText: sections + failedResult(1) });
    assert.equal(partial.mode, 'partial');
    assert.deepStrictEqual([...partial.reviewIds].sort(), ['contract', 'known_warn', 'logic']);
    assert.equal(selectVerifierItemScope({ ...input, previousReportText: sections + failedResult(2) }).mode, 'full');

    const detail = '\n```yaml\nverification_result:\n  phase: coding\n  feature: demo\n  checks:\n'
      + '    - id: contract\n      status: FAIL\n      severity: BLOCKER\n      details: verify original contract\n```\n';
    const incompleteTable = report.split('| contract |')[0] + detail + failedResult(1);
    const knownBlocker = selectVerifierItemScope({ ...input, previousReportText: incompleteTable });
    assert.equal(knownBlocker.mode, 'partial');
    assert.deepStrictEqual([...knownBlocker.reviewIds].sort(), ['contract', 'logic']);
    assert.equal(selectVerifierItemScope({ ...input, previousReportText: incompleteTable.replace('id: contract', 'id: unknown') }).mode, 'full');
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
  { name: '同材料的薄 Review 报告只补开放 CR 的裁决与投影，坏表或材料变化回全审', run: () => {
    const previousMaterial = { ...material, phase: 'review' };
    const input = {
      previousMaterial, currentMaterial: previousMaterial, previousReportText: 'PASS',
      applicableIds: ['contract', 'issue_accuracy', 'false_positive_rate'],
      recheckFindings: [{ id: 'CR-021' }],
    };
    const thin = selectVerifierItemScope(input);
    assert.equal(thin.mode, 'partial');
    assert.deepStrictEqual(thin.reviewIds, ['issue_accuracy', 'false_positive_rate']);
    const missing = selectVerifierItemScope({ ...input,
      previousReportText: header + '| contract | PASS | BLOCKER | `src/boundary.ets:7` |\n' });
    assert.equal(missing.mode, 'partial');
    assert.deepStrictEqual(missing.reviewIds, thin.reviewIds);
    assert.deepStrictEqual(missing.reusedRows.map(row => row.id), ['contract']);
    assert.equal(selectVerifierItemScope({ ...input, previousReportText: report + '| contract | WARN | BLOCKER | conflict |\n' }).mode, 'full');
    assert.equal(selectVerifierItemScope({ ...input, currentMaterial: { ...changed('src/behavior.ets'), phase: 'review' } }).mode, 'full');
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
  { name: '当前开放发现按原逐条和证据定位，前缀命中不得缩小复核', run: () => {
    assert(citesIssue('复核（UT-1）和 UP-001', 'UT-1'));
    assert(!citesIssue('复核（UT-10）和 UP-001', 'UT-1'));
    const previousReportText = report.replace('src/behavior.ets:11`', 'src/behavior.ets:11` UT-10')
      + '\n```issue-verification\n- issue: UP-001\n  verdict: unclear\n'
      + '  production_paths: [src/boundary.ets]\n```\n';
    const input = { previousMaterial: material, currentMaterial: material, previousReportText, applicableIds };
    const related = selectVerifierItemScope({ ...input, recheckFindings: [{ id: 'UP-001' }] });
    assert.equal(related.mode, 'partial');
    assert.deepStrictEqual(related.reviewIds, ['contract']);
    const unrelated = selectVerifierItemScope({ ...input, recheckFindings: [{ id: 'UT-1' }] });
    assert.equal(unrelated.mode, 'full');
    assert.deepStrictEqual(unrelated.reviewIds, applicableIds);
    const direct = selectVerifierItemScope({ ...input, recheckFindings: [{ id: 'UT-10' }] });
    assert.equal(direct.mode, 'partial');
    assert.deepStrictEqual(direct.reviewIds, ['logic']);

    const reviewMaterial = { ...material, phase: 'review' };
    const review = selectVerifierItemScope({
      previousMaterial: reviewMaterial, currentMaterial: reviewMaterial, recheckFindings: [{ id: 'CR-021' }],
      previousReportText: header + '| issue_accuracy | WARN | BLOCKER | 其他发现待核 |\n'
        + '| false_positive_rate | WARN | MAJOR | 0/1 |\n' + report.split('\n').slice(2).join('\n'),
      applicableIds: ['issue_accuracy', 'false_positive_rate', ...applicableIds],
    });
    assert.equal(review.mode, 'partial');
    assert.deepStrictEqual(review.reviewIds, ['issue_accuracy', 'false_positive_rate']);
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
