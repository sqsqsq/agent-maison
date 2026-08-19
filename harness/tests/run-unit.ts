// ============================================================================
// run-unit.ts — Framework Harness 单元测试 runner
// ============================================================================
//
// 与 run-tests.ts 的区别：
//   - run-tests.ts：扫 fixtures/，对 framework checker 跑端到端断言
//   - run-unit.ts ：直接 import 工具函数（hdc-runner / spec-loader 等的纯函数），
//                   做白盒级断言，DevEco / hypium 升级时第一时间挂出来
//
// 用法（在仓库根）：
//   npx ts-node framework/harness/tests/run-unit.ts
//   npx ts-node framework/harness/tests/run-unit.ts --filter parseHypium
//
// 退出码：0 全部通过；1 至少一个用例失败。
// ============================================================================

import './utils/transpile-only-env'; // 须为首个 import：本进程+子进程走 transpile-only（见 plan a7c3e1f9 P0）
// b7e4d2a9 Todo1：第二个 import 必须是 trust 隔离 bootstrap——在任何可能读
// MAISON_GOAL_CHECKPOINT_DIR 的模块加载之前无条件覆写到独立临时根（测试零泄漏）。
import { cleanupStrict } from './utils/test-trust-bootstrap';
import * as path from 'path';
import * as fs from 'fs';
import { selectSuites } from './utils/select-suites';
import { writeUnitFailureReport } from './utils/unit-failure-report';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function discoverProfileUnitSuites(): Array<{ id: string; modulePath: string }> {
  const profilesRoot = path.resolve(__dirname, '..', '..', 'profiles');
  const out: Array<{ id: string; modulePath: string }> = [];
  if (!fs.existsSync(profilesRoot)) return out;
  for (const ent of fs.readdirSync(profilesRoot, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const unitDir = path.join(profilesRoot, ent.name, 'harness', 'tests', 'unit');
    if (!fs.existsSync(unitDir)) continue;
    for (const fn of fs.readdirSync(unitDir)) {
      if (!fn.endsWith('.unit.test.ts')) continue;
      const absNoExt = path.join(unitDir, fn.replace(/\.ts$/, ''));
      const rel = path.relative(__dirname, absNoExt).replace(/\\/g, '/');
      out.push({
        id: `profile:${ent.name}:${fn.replace(/\.unit\.test\.ts$/, '')}`,
        modulePath: rel.startsWith('.') ? rel : `./${rel}`,
      });
    }
  }
  return out;
}

const CORE_SUITES: Array<{ id: string; modulePath: string }> = [
  // plan a5f9c3e2 t4：统一裁决内核契约 + 元门禁（未注册 incident / 新增 gate 读 goal env 即红）
  { id: 'adjudication',     modulePath: './unit/adjudication.unit.test' },
  // plan d6b1a8e3 t2：monitor stale 误报的 replay fixture（先复现后改）
  { id: 'goal-monitor-stale', modulePath: './unit/goal-monitor-stale.unit.test' },
  // plan d6b1a8e3 t3/t4：硬预算跨进程不等式 + kill 后证据卫生（真子进程测试床）
  { id: 'goal-budget-integration', modulePath: './unit/goal-budget-integration.unit.test' },
  // plan a4f7e2b1 t1：run 级存活信标（PID 重用负例 / 反 /F 强杀 / 无证据即 stale）
  { id: 'liveness-beacon', modulePath: './unit/liveness-beacon.unit.test' },
  // plan a4f7e2b1 t2：supervisor 决策核（beacon × run_disposition 矩阵 + 反重建等价性）
  { id: 'goal-supervisor', modulePath: './unit/goal-supervisor.unit.test' },
  // plan a4f7e2b1 t2 原验收：真 /F 强杀 → supervisor 生产链自动恢复（真子进程 + 真 CLI）
  { id: 'supervisor-kill-recovery', modulePath: './unit/supervisor-kill-recovery.unit.test' },
  { id: 'upstream-closure', modulePath: './unit/upstream-closure.unit.test' },
  { id: 'scope-replan', modulePath: './unit/scope-replan.unit.test' },
  { id: 'release-shipped-in-ignored-dirs', modulePath: './unit/release-shipped-in-ignored-dirs.unit.test' },
  { id: 'unit-failure-report', modulePath: './unit/unit-failure-report.unit.test' },
  // e5d8a2c4 T4：整机 smoke 的注册表/接线约束下放到秒级单测（整机链本身分钟级，
  // 不适合每次改动都跑；而"注册表缩水"是最廉价的假绿形态）
  { id: 'smoke-lifecycle-registry', modulePath: './unit/smoke-lifecycle-registry.unit.test' },
  // e5d8a2c4 T4 用例 #8：在案"第一死"的行为钉（棘轮——T2 落地改行为后本套必红）
  { id: 'goal-park-resume', modulePath: './unit/goal-park-resume.unit.test' },
  { id: 'goal-product-preflight', modulePath: './unit/goal-product-preflight.unit.test' },
  { id: 'host-replay-fixes', modulePath: './unit/host-replay-fixes.unit.test' },
  // plan c6a9e4d2 t2/t3：Windows containment 装帧 + guardian 接管对账矩阵（只读投影/匹配才终止）
  { id: 'agent-containment', modulePath: './unit/agent-containment.unit.test' },
  { id: 'doc-freshness',    modulePath: './unit/doc-freshness.unit.test' },
  { id: 'diff-staleness',   modulePath: './unit/diff-staleness.unit.test' },
  { id: 'feature-artifacts', modulePath: './unit/feature-artifacts.unit.test' },
  { id: 'init-eol',         modulePath: './unit/init-eol.unit.test' },
  { id: 'canonical-gitignore', modulePath: './unit/canonical-gitignore.unit.test' },
  { id: 'init-update-policy', modulePath: './unit/init-update-policy.unit.test' },
  { id: 'hook-stale-state', modulePath: './unit/hook-stale-state.unit.test' },
  { id: 'guard-framework-write', modulePath: './unit/guard-framework-write.unit.test' },
  { id: 'hooks-config-upsert', modulePath: './unit/hooks-config-upsert.unit.test' },
  { id: 'record-verifier-report-hook', modulePath: './unit/record-verifier-report-hook.unit.test' },
  { id: 'profile-routing',  modulePath: './unit/profile-routing.unit.test' },
  { id: 'profile-personal-prerequisites', modulePath: './unit/profile-personal-prerequisites.unit.test' },
  { id: 'framework-config-schema', modulePath: './unit/framework-config-schema.unit.test' },
  { id: 'review-context',   modulePath: './unit/review-context.unit.test' },
  { id: 'verdict-extraction', modulePath: './unit/verdict-extraction.unit.test' },
  { id: 'summary-schema',   modulePath: './unit/summary-schema.unit.test' },
  { id: 'ut-artifact-parse', modulePath: './unit/ut-artifact-parse.unit.test' },
  { id: 'ut-artifact-validate', modulePath: './unit/ut-artifact-validate.unit.test' },
  // plan f4c8d2b7：UT 契约冲突收口（boundary 双形态/模板类名口径回归钉/invalid suggestion 分产物/路径 SSOT/ut prompt 注入）
  { id: 'ut-contract-caliber', modulePath: './unit/ut-contract-caliber.unit.test' },
  // plan a8e5c3f9：统一 headless 全权限执行契约（bypass argv/effective 归一化/chrys 拒绝/adapter.yaml 一致性）
  { id: 'headless-full-permission', modulePath: './unit/headless-full-permission.unit.test' },
  { id: 'ut-it-blocks', modulePath: './unit/ut-it-blocks.unit.test' },
  { id: 'ut-dag-loader', modulePath: './unit/ut-dag-loader.unit.test' },
  { id: 'ut-coverage-gate-diagnostics', modulePath: './unit/ut-coverage-gate-diagnostics.unit.test' },
  { id: 'coverage-evidence', modulePath: './unit/coverage-evidence.unit.test' },
  { id: 'path-governance', modulePath: './unit/path-governance.unit.test' },
  { id: 'code-graph-drift', modulePath: './unit/code-graph-drift.unit.test' },
  { id: 'code-graph-anchor-hash', modulePath: './unit/code-graph-anchor-hash.unit.test' },
  { id: 'bootstrap-code-graph', modulePath: './unit/bootstrap-code-graph.unit.test' },
  { id: 'check-module-graph', modulePath: './unit/check-module-graph.unit.test' },
  { id: 'module-graph-probe', modulePath: './unit/module-graph-probe.unit.test' },
  { id: 'ut-verdict-incomplete', modulePath: './unit/ut-verdict-incomplete.unit.test' },
  { id: 'testing-verdict-incomplete', modulePath: './unit/testing-verdict-incomplete.unit.test' },
  { id: 'ut-file-scope', modulePath: './unit/ut-file-scope.unit.test' },
  { id: 'ut-module-selection', modulePath: './unit/ut-module-selection.unit.test' },
  { id: 'ut-build-config-files', modulePath: './unit/ut-build-config-files.unit.test' },
  { id: 'visual-handoff',   modulePath: './unit/visual-handoff.unit.test' },
  { id: 'ui-spec',          modulePath: './unit/ui-spec.unit.test' },
  { id: 'visual-fidelity',  modulePath: './unit/visual-fidelity.unit.test' },
  { id: 'visual-rounds-ledger', modulePath: './unit/visual-rounds-ledger.unit.test' },
  { id: 'review-feedback-ledger', modulePath: './unit/review-feedback-ledger.unit.test' },
  { id: 'critic-receipt-producer', modulePath: './unit/critic-receipt-producer.unit.test' },
  { id: 'visual-structure-disorder', modulePath: './unit/visual-structure-disorder.unit.test' },
  { id: 'visual-defect-enum', modulePath: './unit/visual-defect-enum.unit.test' },
  { id: 'visual-diff-p0-coverage', modulePath: './unit/visual-diff-p0-coverage.unit.test' },
  { id: 'visual-render-faithfulness', modulePath: './unit/visual-render-faithfulness.unit.test' },
  { id: 'arkui-clip-overlap', modulePath: './unit/arkui-clip-overlap.unit.test' },
  { id: 'fidelity-snapshot', modulePath: './unit/fidelity-snapshot.unit.test' },
  { id: 'multimodal-probe', modulePath: './unit/multimodal-probe.unit.test' },
  { id: 'product-source-snapshot', modulePath: './unit/product-source-snapshot.unit.test' },
  // plan c4e8b1d3 G1：UI 文件级 scope 门（冻结 contracts.files + coding_base_sha 基线）
  { id: 'ui-scope-gate', modulePath: './unit/ui-scope-gate.unit.test' },
  // plan c4e8b1d3 G3：bc-openCard consumer golden evaluator（结果聚合 + 绑定校验）
  { id: 'consumer-golden', modulePath: './unit/consumer-golden.unit.test' },
  // plan c4e8b1d3 Todo 3：golden/nav/capture target 集合统一——check-testing 入口级接线
  // （nav 校验/identity/capture 共用 P0 ∪ golden positive ∪ golden forbidden 集合）
  { id: 'golden-nav-capture-wiring', modulePath: './unit/golden-nav-capture-wiring.unit.test' },
  // plan b7e4d2a9 Todo3：vision 账本单写者谓词（2026-07-27 宿主误杀根治）
  { id: 'single-writer-predicate', modulePath: './unit/single-writer-predicate.unit.test' },
  // plan b7e4d2a9 Todo1：测试 trust 隔离（probe 与 blackbox 两 suite id 不得子串包含）
  { id: 'trust-isolation-probe', modulePath: './unit/trust-isolation-probe.unit.test' },
  { id: 'trust-bootstrap-blackbox', modulePath: './unit/trust-bootstrap-blackbox.unit.test' },
  // plan b7e4d2a9 Todo2：per-run 场外状态回收契约（封卷/supersede 集成面在 testing-integrity）
  { id: 'trust-lifecycle', modulePath: './unit/trust-lifecycle.unit.test' },
  // openspec device-readiness-and-completion t2：托管设备会话所有权/回收/target_kind 分类
  { id: 'device-session', modulePath: './unit/device-session.unit.test' },
  // openspec device-readiness-and-completion t3：设备就绪门三态/降级/启动即锁屏死锁回归
  { id: 'device-readiness-gate', modulePath: './unit/device-readiness-gate.unit.test' },
  // openspec device-readiness-and-completion t4：完成观测判据（新鲜度/半写入/收口不算失败）
  { id: 'phase-completion-probe', modulePath: './unit/phase-completion-probe.unit.test' },
  // openspec device-readiness-and-completion t6：凭据身份不可变 + 机器级锁存 + 跨进程互斥
  { id: 'device-credential-store', modulePath: './unit/device-credential-store.unit.test' },
  // openspec device-readiness-and-completion t6：解锁执行器（禁枚举/键位不全零输入/口令不泄露）
  { id: 'device-unlock-helper', modulePath: './unit/device-unlock-helper.unit.test' },
  { id: 'device-lockscreen-parser', modulePath: './unit/device-lockscreen-parser.unit.test' },
  // openspec device-readiness-and-completion t6：策略检查/登记 CLI（非 TTY 拒绝登记）
  { id: 'device-policy-cli', modulePath: './unit/device-policy-cli.unit.test' },
  // openspec device-readiness-and-completion t6：运行期再次锁屏的恢复（同 serial、一次、禁热切）
  { id: 'device-runtime-recovery', modulePath: './unit/device-runtime-recovery.unit.test' },
  // openspec device-readiness-and-completion R17：跨进程并发/损坏场景（真子进程，非同进程假并发）
  { id: 'device-concurrency', modulePath: './unit/device-concurrency.unit.test' },
  // d9e4b7c1 T2：真机缺陷回修接入（evidence 合成/绑定校验/根级联三分/physical-only）
  { id: 'device-test-backtrack', modulePath: './unit/device-test-backtrack.unit.test' },
  { id: 'skills-device-policy-gate', modulePath: './unit/skills-device-policy-gate.unit.test' },
  // runner 级集成（进程内跑真实 phase 循环 + 注入缝；断言时序与副作用）
  { id: 'goal-runner-testing-integrity', modulePath: './unit/goal-runner-testing-integrity.unit.test' },
  // plan d8c5f3a7 T7a：结果级 golden 快检（决策链回放；显式注册防假绿）
  { id: 'golden-bc-opencard', modulePath: './unit/golden-bc-opencard.unit.test' },
  { id: 'vision-canary', modulePath: './unit/vision-canary.unit.test' },
  { id: 'vision-canary-interactive', modulePath: './unit/vision-canary-interactive.unit.test' },
  { id: 'goal-assess-driver', modulePath: './unit/goal-assess-driver.unit.test' },
  { id: 'read-image-evidence', modulePath: './unit/read-image-evidence.unit.test' },
  { id: 'profile-decoupling', modulePath: './unit/profile-decoupling.unit.test' },
  { id: 'profile-skill-assets', modulePath: './unit/profile-skill-assets.unit.test' },
  { id: 'resolve-skill-path', modulePath: './unit/resolve-skill-path.unit.test' },
  { id: 'no-numbered-skill-scan', modulePath: './unit/no-numbered-skill-scan.unit.test' },
  { id: 'docs-authoring-lint', modulePath: './unit/docs-authoring-lint.unit.test' },
  { id: 'correction-c5-full', modulePath: './unit/correction-c5-full.unit.test' },
  { id: 'correction-check-fail-closed', modulePath: './unit/correction-check-fail-closed.unit.test' },
  { id: 'context-facts', modulePath: './unit/context-facts.unit.test' },
  { id: 'check-spec-small-scale', modulePath: './unit/check-spec-small-scale.unit.test' },
  { id: 'ut-business-src-scope', modulePath: './unit/ut-business-src-scope.unit.test' },
  { id: 'coding-failure-kinds', modulePath: './unit/coding-failure-kinds.unit.test' },
  { id: 'root-zero-host-name', modulePath: './unit/root-zero-host-name.unit.test' },
  { id: 'repo-layout', modulePath: './unit/repo-layout.unit.test' },
  { id: 'framework-integrity', modulePath: './unit/framework-integrity.unit.test' },
  { id: 'path-guard', modulePath: './unit/path-guard.unit.test' },
  { id: 'harness-path-guard', modulePath: './unit/harness-path-guard.unit.test' },
  { id: 'runner-layout-smoke', modulePath: './unit/runner-layout-smoke.unit.test' },
  { id: 'generic-coding-host', modulePath: './unit/generic-coding-host.unit.test' },
  { id: 'workflow-loader', modulePath: './unit/workflow-loader.unit.test' },
  { id: 'workflow-tracks', modulePath: './unit/workflow-tracks.unit.test' },
  { id: 'skill-contract', modulePath: './unit/skill-contract.unit.test' },
  { id: 'assess', modulePath: './unit/assess.unit.test' },
  { id: 'device-test-case-kernel', modulePath: './unit/device-test-case-kernel.unit.test' },
  { id: 'quality-tiers', modulePath: './unit/quality-tiers.unit.test' },
  { id: 'capability-degradation', modulePath: './unit/capability-degradation.unit.test' },
  // plan c8e5b3f1 t1：阶段驱动 /spec 需求 provenance（SSOT explicit_cli 解锁 + 反例锁 + 血缘）
  { id: 'spec-requirement-provenance', modulePath: './unit/spec-requirement-provenance.unit.test' },
  // plan c8e5b3f1 t2：blocked capability 可诊断投影 + mismatch 因果归因 + next_action + assess
  { id: 'blocked-capability-projection', modulePath: './unit/blocked-capability-projection.unit.test' },
  // plan c8e5b3f1 t2 P2-3：可重跑 E2E（真实 consumer 工程跑 init/harness-runner/check-receipt）
  { id: 'e2e-spec-requirement-closure', modulePath: './unit/e2e-spec-requirement-closure.unit.test' },
  { id: 'goal-adapter-routing', modulePath: './unit/goal-adapter-routing.unit.test' },
  { id: 'goal-reconcile-observation', modulePath: './unit/goal-reconcile-observation.unit.test' },
  { id: 'goal-reconcile-boundary-fixtures', modulePath: './unit/goal-reconcile-boundary-fixtures.unit.test' },
  { id: 'goal-run-control', modulePath: './unit/goal-run-control.unit.test' },
  { id: 'goal-handoff', modulePath: './unit/goal-handoff.unit.test' },
  { id: 'goal-handoff-runner-wiring', modulePath: './unit/goal-handoff-runner-wiring.unit.test' },
  { id: 'goal-in-session-driver', modulePath: './unit/goal-in-session-driver.unit.test' },
  { id: 'runtime-policy', modulePath: './unit/runtime-policy.unit.test' },
  { id: 'diff-scope', modulePath: './unit/diff-scope.unit.test' },
  { id: 'correction-routing', modulePath: './unit/correction-routing.unit.test' },
  { id: 'repair-candidates', modulePath: './unit/repair-candidates.unit.test' },
  { id: 'usage-capture', modulePath: './unit/usage-capture.unit.test' },
  { id: 'check-receipt-policy', modulePath: './unit/check-receipt-policy.unit.test' },
  { id: 'compat-loader', modulePath: './unit/compat-loader.unit.test' },
  { id: 'extension-loader', modulePath: './unit/extension-loader.unit.test' },
  { id: 'hooks-dispatcher', modulePath: './unit/hooks-dispatcher.unit.test' },
  { id: 'adapter-bridge', modulePath: './unit/adapter-bridge.unit.test' },
  { id: 'generic-bundle', modulePath: './unit/generic-bundle.unit.test' },
  { id: 'config-field-merger', modulePath: './unit/config-field-merger.unit.test' },
  { id: 'config-placement-gate', modulePath: './unit/config-placement-gate.unit.test' },
  { id: 'config-builder', modulePath: './unit/config-builder.unit.test' },
  { id: 'product-selection', modulePath: './unit/product-selection.unit.test' },
  { id: 'framework-local-config', modulePath: './unit/framework-local-config.unit.test' },
  { id: 'personal-setup-gate', modulePath: './unit/personal-setup-gate.unit.test' },
  { id: 'init-readiness', modulePath: './unit/init-readiness.unit.test' },
  { id: 'template-renderer', modulePath: './unit/template-renderer.unit.test' },
  { id: 'init-orchestrate', modulePath: './unit/init-orchestrate.unit.test' },
  { id: 'init-next-steps', modulePath: './unit/init-next-steps.unit.test' },
  { id: 'skills-index-init-steps', modulePath: './unit/skills-index-init-steps.unit.test' },
  { id: 'init-task-executor', modulePath: './unit/init-task-executor.unit.test' },
  { id: 'materialized-adapters-resolve', modulePath: './unit/materialized-adapters-resolve.unit.test' },
  { id: 'legacy-skill-bridge-cleanup', modulePath: './unit/legacy-skill-bridge-cleanup.unit.test' },
  { id: 'init-orchestrate-smoke', modulePath: './unit/init-orchestrate-smoke.unit.test' },
  { id: 'derived-hylyre-plan', modulePath: './unit/derived-hylyre-plan.unit.test' },
  { id: 'adhoc-nl-split', modulePath: './unit/adhoc-nl-split.unit.test' },
  { id: 'adhoc-derive-helpers', modulePath: './unit/adhoc-derive-helpers.unit.test' },
  { id: 'hylyre-steps-normalize', modulePath: './unit/hylyre-steps-normalize.unit.test' },
  { id: 'adhoc-summarize-dump', modulePath: './unit/adhoc-summarize-dump.unit.test' },
  { id: 'adhoc-ui-reset-meta', modulePath: './unit/adhoc-ui-reset-meta.unit.test' },
  { id: 'app-snapshot-cache-hint', modulePath: './unit/app-snapshot-cache-hint.unit.test' },
  { id: 'adhoc-input-path', modulePath: './unit/adhoc-input-path.unit.test' },
  { id: 'adhoc-canonical-paths', modulePath: './unit/adhoc-canonical-paths.unit.test' },
  { id: 'hylyre-planned-step-lint', modulePath: './unit/hylyre-planned-step-lint.unit.test' },
  { id: 'adhoc-trace-placeholder', modulePath: './unit/adhoc-trace-placeholder.unit.test' },
  { id: 'confirmation-ux', modulePath: './unit/confirmation-ux.unit.test' },
  { id: 'adapter-catalog-consistency', modulePath: './unit/adapter-catalog-consistency.unit.test' },
  { id: 'phase-transition-policy', modulePath: './unit/phase-transition-policy.unit.test' },
  { id: 'goal-runner-policy', modulePath: './unit/goal-runner-policy.unit.test' },
  { id: 'goal-runner-phase', modulePath: './unit/goal-runner-phase.unit.test' },
  { id: 'goal-runner-detach', modulePath: './unit/goal-runner-detach.unit.test' },
  { id: 'chrys-opencode-adapter', modulePath: './unit/chrys-opencode-adapter.unit.test' },
  { id: 'codeagent-adapter', modulePath: './unit/codeagent-adapter.unit.test' },
  { id: 'agent-invoke-settle', modulePath: './unit/agent-invoke-settle.unit.test' },
  { id: 'goal-runner-hardening', modulePath: './unit/goal-runner-hardening.unit.test' },
  { id: 'goal-headless-guard', modulePath: './unit/goal-headless-guard.unit.test' },
  { id: 'patch-openspec-artifacts', modulePath: './unit/patch-openspec-artifacts.unit.test' },
  { id: 'goal-closure-gate', modulePath: './unit/goal-closure-gate.unit.test' },
  { id: 'testing-trace-gates', modulePath: './unit/testing-trace-gates.unit.test' },
  { id: 'goal-progress', modulePath: './unit/goal-progress.unit.test' },
  { id: 'goal-preflight', modulePath: './unit/goal-preflight.unit.test' },
  { id: 'headless-binary-resolve', modulePath: './unit/headless-binary-resolve.unit.test' },
  { id: 'phase-state', modulePath: './unit/phase-state.unit.test' },
  { id: 'phase-closure-finalizer', modulePath: './unit/phase-closure-finalizer.unit.test' },
  { id: 'receipt-path-reconcile', modulePath: './unit/receipt-path-reconcile.unit.test' },
  { id: 'feature-artifact-resolver', modulePath: './unit/feature-artifact-resolver.unit.test' },
  { id: 'phase-alias', modulePath: './unit/phase-alias.unit.test' },
  { id: 'capability-alias', modulePath: './unit/capability-alias.unit.test' },
  { id: 'migrate-feature-phase-paths', modulePath: './unit/migrate-feature-phase-paths.unit.test' },
  { id: 'exploration-strategy', modulePath: './unit/exploration-strategy.unit.test' },
  { id: 'goal-timeout', modulePath: './unit/goal-timeout.unit.test' },
  { id: 'goal-checkpoint', modulePath: './unit/goal-checkpoint.unit.test' },
  { id: 'run-unit-filter', modulePath: './unit/run-unit-filter.unit.test' },
  { id: 'gate-fingerprint', modulePath: './unit/gate-fingerprint.unit.test' },
  { id: 'process-integrity', modulePath: './unit/process-integrity.unit.test' },
  { id: 'unlock-wording-c9f4e7a2', modulePath: './unit/unlock-wording-c9f4e7a2.unit.test' },
  // plan d7f3a9c4 t1/t2：显式 --adapter-model 模型钉（五家回放 argv / 单点裁决授权矩阵）
  { id: 'goal-model-pin-d7f3a9c4', modulePath: './unit/goal-model-pin-d7f3a9c4.unit.test' },
  // plan d7f3a9c4 t3：pin 与金丝雀身份绑定 + receipt/消费面/三 env 链/telemetry/两条生产链回归
  { id: 'goal-canary-pin-binding-d7f3a9c4', modulePath: './unit/goal-canary-pin-binding-d7f3a9c4.unit.test' },
  // plan d7f3a9c4 t4：金丝雀 CLI 硬失败前置 BLOCKER（spawn race / CLI·config 参数不兼容）
  { id: 'goal-canary-hard-cli-d7f3a9c4', modulePath: './unit/goal-canary-hard-cli-d7f3a9c4.unit.test' },
  { id: 'visual-confirm', modulePath: './unit/visual-confirm.unit.test' },
  { id: 'phase-evidence-manifest', modulePath: './unit/phase-evidence-manifest.unit.test' },
  { id: 'closure-attestation', modulePath: './unit/closure-attestation.unit.test' },
  { id: 'headless-assumptions', modulePath: './unit/headless-assumptions.unit.test' },
  { id: 'verify-feature-completion', modulePath: './unit/verify-feature-completion.unit.test' },
  { id: 'confirmation-receipt', modulePath: './unit/confirmation-receipt.unit.test' },
  { id: 'behavior-switch-scan', modulePath: './unit/behavior-switch-scan.unit.test' },
  { id: 'p0-semantic-gates', modulePath: './unit/p0-semantic-gates.unit.test' },
  { id: 'fidelity-intent', modulePath: './unit/fidelity-intent.unit.test' },
  { id: 'blocker-suggestion-ratchet', modulePath: './unit/blocker-suggestion-ratchet.unit.test' },
  { id: 'report-suggestion-normalize', modulePath: './unit/report-suggestion-normalize.unit.test' },
  { id: 'hylyre-keyset-consistency', modulePath: './unit/hylyre-keyset-consistency.unit.test' },
  { id: 'receipt-slim', modulePath: './unit/receipt-slim.unit.test' },
  { id: 'capability-preflight', modulePath: './unit/capability-preflight.unit.test' },
  { id: 'lite-json-schema', modulePath: './unit/lite-json-schema.unit.test' },
  { id: 'worktree-digest', modulePath: './unit/worktree-digest.unit.test' },
  { id: 'goal-capability-gate', modulePath: './unit/goal-capability-gate.unit.test' },
  { id: 'negative-verdict-gate', modulePath: './unit/negative-verdict-gate.unit.test' },
  { id: 'quality-axes', modulePath: './unit/quality-axes.unit.test' },
  { id: 'effective-vision-context', modulePath: './unit/effective-vision-context.unit.test' },
  { id: 'mutation-backtrack', modulePath: './unit/mutation-backtrack.unit.test' },
  { id: 'intermediate-rounds-journal', modulePath: './unit/intermediate-rounds-journal.unit.test' },
  { id: 'integration-tc-flow', modulePath: './unit/integration-tc-flow.unit.test' },
  { id: 'blind-crop-prohibition', modulePath: './unit/blind-crop-prohibition.unit.test' },
  { id: 'visual-debt', modulePath: './unit/visual-debt.unit.test' },
  // plan 7c4f2e9b（cc-spec 卡死根治）六套件
  { id: 'claude-envelope', modulePath: './unit/claude-envelope.unit.test' },
  { id: 'ui-spec-schema-strict', modulePath: './unit/ui-spec-schema-strict.unit.test' },
  { id: 'pass-snapshot', modulePath: './unit/pass-snapshot.unit.test' },
  { id: 'blocker-actionability', modulePath: './unit/blocker-actionability.unit.test' },
  { id: 'timeout-ratchet-closure', modulePath: './unit/timeout-ratchet-closure.unit.test' },
  { id: 'attempt-axes-timeline', modulePath: './unit/attempt-axes-timeline.unit.test' },
];

const SUITES: Array<{ id: string; modulePath: string }> = [...CORE_SUITES, ...discoverProfileUnitSuites()];
/** 显式注册的 CORE 套件（review P1：缺失必须 FAIL——静默 SKIP 会让"真实行为测试"假绿） */
const EXPLICIT_SUITE_IDS = new Set(CORE_SUITES.map(s => s.id));
interface SuiteSummary {
  id: string;
  results: UnitCaseResult[];
}

async function main(): Promise<void> {
  const filterIdx = process.argv.indexOf('--filter');
  const filter = filterIdx >= 0 ? process.argv[filterIdx + 1] : undefined;
  const { toRun, caseNameFilter } = selectSuites(filter, SUITES);

  console.log('\nFramework Harness Unit Tests\n');
  console.log('='.repeat(72));

  const summaries: SuiteSummary[] = [];

  for (const suite of toRun) {
    const fullPath = path.resolve(__dirname, suite.modulePath + '.ts');
    if (!fs.existsSync(fullPath)) {
      // review P1：显式注册的 CORE 套件缺失 = 测试基建回归，必须 FAIL（静默 SKIP 会假绿）；
      // 自动发现（profile）套件缺失则 SKIP 属正常（profile 可能未带该测试）。
      if (EXPLICIT_SUITE_IDS.has(suite.id)) {
        console.log(`  [FAIL] suite ${suite.id} 缺失：${fullPath}`);
        summaries.push({
          id: suite.id,
          results: [{ name: '<suite-load>', ok: false, error: `显式注册的 CORE 套件文件缺失：${fullPath}` }],
        });
      } else {
        console.log(`  [SKIP] suite ${suite.id} 不存在：${fullPath}`);
      }
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(suite.modulePath) as { runAll: () => UnitCaseResult[] | Promise<UnitCaseResult[]> };
    if (typeof mod.runAll !== 'function') {
      console.log(`  [FAIL] suite ${suite.id} 未导出 runAll()`);
      summaries.push({ id: suite.id, results: [{ name: '<suite-load>', ok: false, error: '未导出 runAll()' }] });
      continue;
    }
    const all = await mod.runAll();
    const filtered = caseNameFilter ? all.filter(r => r.name.includes(caseNameFilter)) : all;
    summaries.push({ id: suite.id, results: filtered });
  }

  console.log('');
  let totalPass = 0;
  let totalFail = 0;
  for (const s of summaries) {
    const passed = s.results.filter(r => r.ok).length;
    const failed = s.results.length - passed;
    totalPass += passed;
    totalFail += failed;
    console.log(`Suite [${s.id}]  PASS=${passed}  FAIL=${failed}`);
    for (const r of s.results) {
      if (r.ok) {
        console.log(`  PASS  ${r.name}`);
      } else {
        console.log(`  FAIL  ${r.name}`);
        if (r.error) {
          for (const line of r.error.split('\n')) {
            console.log(`        ${line}`);
          }
        }
      }
    }
    console.log('');
  }

  console.log('='.repeat(72));
  console.log(`\n结果：${totalPass} passed, ${totalFail} failed (共 ${totalPass + totalFail})\n`);

  try {
    const report = writeUnitFailureReport(summaries);
    if (report.failureCount > 0) {
      console.log(`失败用例明细已写入：${report.path}（${report.failureCount} case）`);
    }
  } catch (error) {
    console.error(`[run-unit] 写失败用例报告失败：${(error as Error).message}`);
  }

  // b7e4d2a9 Todo1：不再直接 process.exit——exitCode + finally 严格清理（see 底部）
  process.exitCode = totalFail > 0 ? 1 : 0;
}

void (async () => {
  try {
    await main();
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    // 严格语义：临时 trust 根删不掉=测试留了垃圾——非零退出并打印路径（不许静默）；
    // process.once('exit') 的 best-effort 后备兜异常路径。
    const r = cleanupStrict();
    if (!r.ok) {
      console.error(`[test-trust-bootstrap] 临时 trust 根清理失败，遗留：${r.leftoverPath}`);
      process.exitCode = 1;
    }
  }
})();
