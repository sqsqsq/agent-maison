// ============================================================================
// exit 阶段（lite track）— 一次性出口门禁（C1 feature-track，plan d4a7c1e8）
// ============================================================================
// lite 的唯一检查点：change.md 验收/任务 checkbox 全勾（BLOCKER）+ scope 声明可用
// + 编译（复用 profile coding host 的 checkCodingCompile——与 coding 同源，不造平行体系）。
// diff_within_scope 接线待 C1 子批：当前 fail-closed（BLOCKER FAIL 占位）——红线缺位不得
// 放行，接线完成前 lite exit 不可闭环；lint 为 WARN 占位（可见缺项，不阻断）。

import * as fs from 'fs';
import type { PhaseChecker, CheckContext, CheckResult } from './utils/types';
import { isCapabilitySkipped } from '../capability-registry';
import { tryLoadProfileCodingHost } from '../profile-host-loader';
import { changeDocPath, parseChangeDoc } from './check-change';

export const checker: PhaseChecker = {
  phase: 'exit',
  async check(ctx: CheckContext): Promise<CheckResult[]> {
    const results: CheckResult[] = [];
    const abs = changeDocPath(ctx.projectRoot, ctx.feature);

    if (!fs.existsSync(abs)) {
      results.push({
        id: 'exit_change_doc_present',
        category: 'structure',
        description: 'exit 门禁以 change.md 为闭环判据，文件必须存在',
        severity: 'BLOCKER',
        status: 'FAIL',
        details: `未找到 ${abs}；请先完成 change 阶段`,
      });
      return results;
    }

    const doc = parseChangeDoc(fs.readFileSync(abs, 'utf-8'));

    // 1) 验收清单 + 任务 checkbox 全勾（lite 闭环态的核心判据；C2 起 closure 读本结果）
    const unchecked = [
      ...doc.acceptance.filter((c) => !c.checked).map((c) => `验收：${c.text}`),
      ...doc.tasks.filter((c) => !c.checked).map((c) => `任务：${c.text}`),
    ];
    const total = doc.acceptance.length + doc.tasks.length;
    results.push({
      id: 'exit_checkboxes_all_checked',
      category: 'structure',
      description: 'change.md 验收清单与任务 checkbox 必须全部为 [x]',
      severity: 'BLOCKER',
      status: total > 0 && unchecked.length === 0 ? 'PASS' : 'FAIL',
      details:
        total === 0
          ? 'change.md 没有任何 checkbox 条目（先过 change 阶段门禁）'
          : unchecked.length === 0
            ? `${total} 项全部勾选`
            : `未勾选 ${unchecked.length}/${total}：\n${unchecked.slice(0, 10).join('\n')}`,
    });

    // 2) scope 声明可用（diff 越界防护的判据来源）
    results.push({
      id: 'exit_scope_declared',
      category: 'traceability',
      description: 'change.md Scope 的 in_scope_modules 须可解析（越界防护判据）',
      severity: 'BLOCKER',
      status: doc.scope ? 'PASS' : 'FAIL',
      details: doc.scope ? `in_scope=${doc.scope.in_scope_modules.join(', ')}` : doc.scopeError ?? '',
    });

    // 3) 编译（复用 coding host——与 full track 同一实现与失败归因）
    if (isCapabilitySkipped(ctx.resolvedProfile, 'coding.compile')) {
      results.push({
        id: 'exit_compile',
        category: 'structure',
        description: '编译检查（profile 声明 SKIP coding.compile）',
        severity: 'MINOR',
        status: 'PASS',
        details: 'capability SKIP：按 profile 声明跳过（与 coding 阶段同语义）',
      });
    } else {
      const host = tryLoadProfileCodingHost(ctx.resolvedProfile.profileDir);
      if (!host || typeof host.checkCodingCompile !== 'function') {
        results.push({
          id: 'exit_compile',
          category: 'structure',
          description: '编译检查（复用 profile coding host）',
          severity: 'BLOCKER',
          status: 'FAIL',
          details: '宿主 profile 未提供 coding-host-rules.checkCodingCompile；exit 无法验证可编译性',
        });
      } else {
        try {
          const compileResults = await host.checkCodingCompile(ctx);
          for (const r of compileResults) {
            results.push({ ...r, id: r.id.startsWith('exit_') ? r.id : `exit_${r.id}` });
          }
        } catch (err) {
          results.push({
            id: 'exit_compile',
            category: 'structure',
            description: '编译检查执行失败',
            severity: 'BLOCKER',
            status: 'FAIL',
            details: (err as Error).message,
          });
        }
      }
    }

    // 4) diff_within_scope —— 红线（决策 4：任何档位不豁免）。exit 接线未完成 → fail-closed：
    //    BLOCKER FAIL，接线完成前 lite exit 不得放行（codex review：WARN 会让 exit 在越界防护
    //    未实现时整体 PASS——报告裁决只看 BLOCKER FAIL）。
    results.push({
      id: 'exit_diff_within_scope',
      category: 'traceability',
      description: 'diff 越界防护（红线恒不豁免）；exit 侧接线未完成 → fail-closed 不放行',
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        'exit 的 diff_within_scope 尚未接线（C1 子批）。红线缺位不得放行——接线完成后本项转为真实校验。',
    });
    // lint —— MAJOR 缺项可见（不阻断闭环），接线待 C1 子批
    results.push({
      id: 'exit_lint',
      category: 'traceability',
      description: 'lint 检查（exit 接线待 C1 子批）',
      severity: 'MAJOR',
      status: 'WARN',
      details: '本项尚未在 exit 接线——OpenSpec feature-track tasks 保持未勾；勿视作已验证',
    });

    return results;
  },
};

export default checker;
