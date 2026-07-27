// ============================================================================
// closed-feature-fixture.ts — "已闭环 feature" 测试夹具（plan d8c5f3a7 review 补齐）
// ----------------------------------------------------------------------------
// 为什么需要它：runner 级集成测试要从 `--start testing` 起链，而 goal-runner 有**截断链
// 上游 closure 核验**——要求 spec/plan/coding/review/ut 各有 phase-evidence-manifest，
// review 还要有 review-closure-attestation.json。手工伪造这些哈希链既易错又会掩盖真实
// 逻辑，所以本夹具**调用生产 writer**（resolvePhaseEvidenceManifest /
// writePhaseEvidenceManifest / writeReviewClosureAttestation）生成，与真实闭环同源。
//
// 任何 runner 级测试都可复用；这也是 review 指出的"缺 runner 级集成测试"的基础设施。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  resolvePhaseEvidenceManifest,
  writePhaseEvidenceManifest,
  writeReceiptManifestPointer,
} from '../../scripts/utils/phase-evidence-manifest';
import { writeReviewClosureAttestation } from '../../scripts/utils/closure-attestation';

export const CLOSED_CHAIN_PHASES: readonly string[] = ['spec', 'plan', 'coding', 'review', 'ut'];

export interface ClosedFeatureFixtureOptions {
  projectRoot: string;
  feature: string;
  frameworkRoot: string;
  /** 产品源码层目录（写入 architecture 的同一组） */
  productLayerDirs?: readonly string[];
  /** 是否 git commit 产物（截断链核验读盘即可，通常不必） */
  commit?: boolean;
}

function writeFile(root: string, rel: string, content: string): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

/**
 * 造一套"上游五阶段已闭环"的 feature 产物。
 *
 * 只造 closure 核验真正需要的最小集：各阶段主产物 + receipt 目录 + evidence manifest，
 * review 额外补 closure attestation。**不伪造 aggregate 哈希**——全部由生产 writer 现算。
 */
export function makeClosedFeatureFixture(opts: ClosedFeatureFixtureOptions): void {
  const { projectRoot, feature, frameworkRoot } = opts;
  const fdir = path.join('doc', 'features', feature);
  const layers = opts.productLayerDirs ?? ['02-Feature'];

  // 产品源码与 build-profile：closure attestation 的 inventory **fail-closed**——
  // 空 inventory 会抛错（"root discovery 失败即 fail-closed，不生成空集快照"），
  // 故必须先有可发现的产品源码根 + 至少一个源文件。
  writeFile(projectRoot, 'build-profile.json5', JSON.stringify({
    app: { products: [{ name: 'default' }] },
    modules: layers.map(l => ({ name: 'FinancialCard', srcPath: `./${l}/FinancialCard` })),
  }, null, 2));
  for (const l of layers) {
    writeFile(projectRoot, `${l}/FinancialCard/src/main/ets/Seed.ets`, 'struct Seed { build() { Text("seed") } }\n');
    writeFile(projectRoot, `${l}/FinancialCard/oh-package.json5`, '{ "name": "financialcard" }\n');
  }

  // --- 各阶段主产物（spec-loader 的 inputs 面要读到） ---
  writeFile(projectRoot, `${fdir}/spec/spec.md`, [
    '# spec — 银行卡开卡',
    '',
    '## Visual Handoff',
    '- fidelity_target: pixel_1to1',
    '- ui_change: new_or_changed',
    '',
  ].join('\n'));
  writeFile(projectRoot, `${fdir}/acceptance.yaml`, [
    `feature: ${feature}`,
    'source: 原始需求.md',
    'version: v1',
    'criteria:',
    '  - id: AC-1',
    '    prd_function: null',
    '    priority: P0',
    '    description: 添卡首页收起态可见',
    '    testable: true',
    '    verification_steps: ["进入添卡首页"]',
    '    expected_result: 列表可见',
    '    ut_layer: device',
    '    device_focus: 首页渲染',
    'boundaries: []',
    '',
  ].join('\n'));
  writeFile(projectRoot, `${fdir}/contracts.yaml`, [
    `feature: ${feature}`,
    'modules:',
    '  - name: FinancialCard',
    '    package_path: 02-Feature/FinancialCard',
    'files: []',
    '',
  ].join('\n'));
  writeFile(projectRoot, `${fdir}/plan/plan.md`, '# plan\n\n| ID | 模块 |\n|----|------|\n| F1 | FinancialCard |\n');
  writeFile(projectRoot, `${fdir}/review/review-report.md`, '# review\n\n审查结论：通过\n');
  writeFile(projectRoot, `${fdir}/ut/ut-report.md`, '# ut\n\n结论：通过\n');
  writeFile(projectRoot, `${fdir}/use-cases.yaml`, `feature: ${feature}\nuse_cases: []\n`);

  // --- 回执 + verifier 报告 ---
  // 路径口径取自生产实现：receipt_dir_pattern 默认 `doc/features/<feature>/<phase>`
  // （config.ts:598），回执文件直接落该目录下，**没有** receipt/ 子层。
  // writeReceiptManifestPointer 会校验回执存在，故必须先写。
  for (const phase of CLOSED_CHAIN_PHASES) {
    writeFile(projectRoot, `${fdir}/${phase}/reports/verifier.report.md`, `# verifier ${phase}\nverdict: PASS\n`);
    writeFile(projectRoot, `${fdir}/${phase}/phase-completion-receipt.md`, [
      `# ${phase} 阶段完成回执`,
      '',
      `- 阶段: ${phase}`,
      `- 模块: ${feature}`,
      '- 结论: PASS',
      '',
    ].join('\n'));
  }

  // --- review closure attestation（生产 writer） ---
  writeReviewClosureAttestation({
    projectRoot,
    feature,
    expectProductSources: true,
    gateFingerprint: 'fixture',
    runIdentity: null,
  });

  // --- 各阶段 evidence manifest（生产 resolver + writer，哈希现算） ---
  for (const phase of CLOSED_CHAIN_PHASES) {
    const manifest = resolvePhaseEvidenceManifest({
      projectRoot,
      feature,
      phase,
      extraInputs: [],
      extraOutputs: [],
      frameworkRoot,
      requirementSha: null,
    });
    const written = writePhaseEvidenceManifest(projectRoot, manifest);
    // **关键**：closure 核验读的是**回执里的指针**，不是文件本身——生产链在
    // check-receipt 里紧跟着写指针（check-receipt.ts:1118）。夹具漏了这一步，
    // 会得到"文件在盘上但 closure 判 missing"的迷惑现象。
    const rel = path.relative(projectRoot, written.absPath).split(path.sep).join('/');
    writeReceiptManifestPointer(projectRoot, feature, phase, rel, written.sha256);
  }

  if (opts.commit) {
    spawnSync('git', ['add', '-A'], { cwd: projectRoot, encoding: 'utf-8' });
    spawnSync('git', ['commit', '-qm', 'fixture: closed upstream chain'], { cwd: projectRoot, encoding: 'utf-8' });
  }
}
