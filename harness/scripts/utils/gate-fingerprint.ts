// ============================================================================
// gate-fingerprint.ts — 阶段门禁集指纹（回执 stale 治理，2026-07-03 用户拍板）
// ----------------------------------------------------------------------------
// 背景（round6 Checkpoint-2 实锤）：宿主升级 framework 后，goal run 直接采信旧 spec 回执
// （"启动前已闭环"），P0-D 两道新门禁从未执行——漏抽元素原样带进 coding。根因：阶段回执/产物
// 不随 framework 门禁集升级失效。
// 方案：harness-runner 产 summary.json 时**机器写入** gate_fingerprint（agent 零参与、不可自报）；
// check-receipt 消费回执时重算当前指纹比对——缺失/失配 = 门禁集已变，旧产物 stale，
// 不得豁免阶段，必须重跑 harness 重验。goal 与普通模式共用 check-receipt 校验点，天然一致。
// 指纹粒度＝framework version + 对应 phase-rules yaml 内容 hash：规则文件是门禁集的声明面。
// 【粒度边界（cursor review 指出并已治理）】本机制依赖"新增/升级门禁必同步 rules 条目"这条纪律——
// round6 曾有两处违例（P1-A coding 门禁、P1-C testing 门禁未同步声明面），已于 2026-07-03 补齐
// （coding-rules/testing-rules 各补声明条目）。今后 in-check 强化若不改 rules，指纹不变=存量回执
// 不失效（盲区），只能靠 version 分量兜底——**改门禁语义必须同步 rules 声明条目**，此为硬纪律。
// 纯实现 bugfix 不动 rules 不触发存量 feature 全量重跑（重跑成本高，宁取声明面粒度）。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/** phase → phase-rules 文件名（与 specs/phase-rules/ 布局一致；prd/design 为 legacy 别名） */
const PHASE_RULES_FILE: Record<string, string> = {
  spec: 'spec-rules.yaml',
  prd: 'spec-rules.yaml',
  plan: 'plan-rules.yaml',
  design: 'plan-rules.yaml',
  coding: 'coding-rules.yaml',
  review: 'review-rules.yaml',
  ut: 'ut-rules.yaml',
  testing: 'testing-rules.yaml',
  catalog: 'catalog-rules.yaml',
  glossary: 'glossary-rules.yaml',
  docs: 'docs-rules.yaml',
  init: 'init-rules.yaml',
};

const HASH_PREFIX_LEN = 12;

/**
 * 计算某 phase 的当前门禁集指纹：`<frameworkVersion>:<rulesSha256前12>`。
 * frameworkRoot＝framework 根（repo 根或宿主 framework/ 目录，两种布局下
 * specs/phase-rules 与 package.json 相对位置一致）。
 * rules 文件缺失/版本不可读 → null（调用方按"无法建立指纹"处理，不硬造）。
 */
export function computeGateFingerprint(frameworkRoot: string, phase: string): string | null {
  const rulesFile = PHASE_RULES_FILE[phase?.trim?.() ?? ''];
  if (!rulesFile) return null;
  const rulesAbs = path.join(frameworkRoot, 'specs', 'phase-rules', rulesFile);
  const pkgAbs = path.join(frameworkRoot, 'package.json');
  try {
    const version = (JSON.parse(fs.readFileSync(pkgAbs, 'utf-8')) as { version?: string }).version;
    if (!version) return null;
    const rulesHash = crypto
      .createHash('sha256')
      // EOL 归一：发布物化/检出可能改写行尾，语义未变不应使回执失效
      .update(fs.readFileSync(rulesAbs, 'utf-8').replace(/\r\n/g, '\n'))
      .digest('hex')
      .slice(0, HASH_PREFIX_LEN);
    return `${version}:${rulesHash}`;
  } catch {
    return null;
  }
}

/**
 * 回执消费侧校验：summary 里的机器指纹与当前门禁集是否一致。
 * 返回 null=新鲜；返回字符串=stale 原因（调用方判 BLOCKER，指引重跑 harness）。
 * 语义（从严）：
 *  - summary 无 gate_fingerprint 字段 = 门禁集指纹机制之前的旧产物 → stale
 *    （正是本机制要打击的对象：framework 升级后旧回执整体豁免新门禁）；
 *  - 当前指纹计算不出（rules 缺失等）→ 也判 stale（无法证明门禁集未变 ≠ 可放行）。
 */
export function assertGateFingerprintFresh(
  summary: { gate_fingerprint?: unknown },
  frameworkRoot: string,
  phase: string,
): string | null {
  const current = computeGateFingerprint(frameworkRoot, phase);
  const recorded = typeof summary.gate_fingerprint === 'string' ? summary.gate_fingerprint : null;
  if (!current) {
    return `无法计算当前门禁集指纹（specs/phase-rules/${PHASE_RULES_FILE[phase] ?? '?'} 或 package.json 不可读）——框架部署不完整，不得凭旧回执闭环。`;
  }
  if (!recorded) {
    return `阶段产物无门禁集指纹（framework 升级前的旧 summary）——门禁集可能已变化（当前 ${current}），旧回执不得豁免；重跑 ${phase} harness 重验后再闭环。`;
  }
  if (recorded !== current) {
    return `门禁集已升级（产物指纹 ${recorded} → 当前 ${current}）——旧阶段产物在新门禁下未经验证；重跑 ${phase} harness 重验后再闭环。`;
  }
  return null;
}
