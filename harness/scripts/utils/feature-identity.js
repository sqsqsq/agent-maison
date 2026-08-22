// ============================================================================
// feature-identity.js — 逻辑 Feature 身份 ↔ 物理相对路径唯一 SSOT（零依赖 CJS）
// ============================================================================
//
// M5A（plan e2a7c4b9 §4.3）：框架内"逻辑 featureId → 物理 Feature 相对路径"的唯一
// 实现。零 npm 依赖、纯 Node 内置（Buffer / path 语义由调用方决定），同时被：
//   - TypeScript harness（harness/config.ts、各 scripts/utils/*.ts）通过
//     `feature-identity.d.ts` 类型化 import（CJS require）；
//   - 下发到消费方 `.claude/.cac/hooks/` 的 plain-Node Hook（check-phase-completion.mjs、
//     record-verifier-report.mjs 等）通过 `createRequire(import.meta.url)` 同步 require
//     （Node ESM → CJS 互操作；hook 用自锚工程根拼 `framework/harness/scripts/utils/`
//     定位本文件，见各 hook 的 resolveFeatureRel 实现）。
// Hook 不得自带 decoder 副本——路径语义漂移会制造 `<features_dir>/<encoded-featureId>`
// 影子目录，破坏 proof 13/14（plan §7）。
//
// 语义（plan §3/§4.3，硬切无兼容）：
//   - 逻辑键（events/receipt/reports/manifest 全框架引用，全局唯一）：
//     featureId = "cu-" + base64url(blueprint_id + "\0" + change_unit_id)；
//   - 物理相对路径（相对 <features_dir>）：legacy Feature = <feature_id>；
//     CU Feature = <blueprint_id>/<change_unit_id>；
//   - <feature> 占位符（receipt_dir_pattern / reports_dir_pattern / …）一律替换为
//     物理相对路径，绝不塞编码后的逻辑 id；
//   - 判别：`cu-` + 合法 canonical payload → CU Feature；`cu-` + 非法 payload →
//     fail-closed（抛错，不回退成平铺 Feature，避免损坏/手写 id 静默制造影子路径）；
//     其它 id → legacy Feature。
// ============================================================================
'use strict';

const CU_PREFIX = 'cu-';
const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const NUL = '\0';

class FeatureIdentityError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'FeatureIdentityError';
  }
}

/**
 * 校验单个安全路径段（沿用既有 component_id/change_unit_id 口径，拒绝空值、分隔符、
 * 相对段 `.`/`..`）。承担路径身份的 blueprint_id / change_unit_id 统一走此断言。
 */
function assertSafeSegment(value, name) {
  if (
    typeof value !== 'string' ||
    !SAFE_SEGMENT_PATTERN.test(value) ||
    value === '.' ||
    value === '..'
  ) {
    throw new FeatureIdentityError(
      `${name}_invalid`,
      `${name}=${JSON.stringify(value)} 非法；只允许单个安全路径段（^[A-Za-z0-9][A-Za-z0-9._-]*$），不接受空值、分隔符或 ..。`,
    );
  }
}

/**
 * 派生 CU Feature 逻辑键：`cu-` + base64url(blueprint_id \0 change_unit_id)。
 * blueprint_id / change_unit_id 必须为安全路径段；change_unit_id 不得为保留名
 * `blueprint`（与工作区 blueprint/ 目录同层命名空间冲突，plan §3 规则 1）。
 */
function encodeCuFeatureId(blueprintId, changeUnitId) {
  assertSafeSegment(blueprintId, 'blueprint_id');
  assertSafeSegment(changeUnitId, 'change_unit_id');
  if (changeUnitId === 'blueprint') {
    throw new FeatureIdentityError(
      'change_unit_id_reserved',
      `change_unit_id=${JSON.stringify(changeUnitId)} 为保留名，不得与工作区 blueprint/ 目录同名。`,
    );
  }
  const payload = Buffer.from(`${blueprintId}${NUL}${changeUnitId}`, 'utf8').toString('base64url');
  return CU_PREFIX + payload;
}

/**
 * 解析 CU 前缀 featureId；非 `cu-` 前缀返回 null（legacy）；`cu-` 前缀但 payload
 * 非法/非 canonical → 抛 FeatureIdentityError（fail-closed，不回退平铺）。
 */
function tryParseCuFeatureId(featureId) {
  if (typeof featureId !== 'string' || !featureId.startsWith(CU_PREFIX)) return null;
  const payload = featureId.slice(CU_PREFIX.length);
  if (payload.length === 0) {
    throw new FeatureIdentityError(
      'change_unit_feature_id_invalid',
      `Feature id 以 ${CU_PREFIX} 开头但 payload 为空，不得回退为平铺 Feature：${JSON.stringify(featureId)}`,
    );
  }
  let decoded;
  try {
    decoded = Buffer.from(payload, 'base64url').toString('utf8');
  } catch {
    throw new FeatureIdentityError(
      'change_unit_feature_id_invalid',
      `Feature id payload 无法 base64url 解码，不得回退为平铺 Feature：${JSON.stringify(featureId)}`,
    );
  }
  const sep = decoded.indexOf(NUL);
  if (sep <= 0 || sep === decoded.length - 1 || decoded.indexOf(NUL, sep + 1) !== -1) {
    throw new FeatureIdentityError(
      'change_unit_feature_id_invalid',
      `Feature id payload 缺唯一 NUL 分隔，不得回退为平铺 Feature：${JSON.stringify(featureId)}`,
    );
  }
  const blueprintId = decoded.slice(0, sep);
  const changeUnitId = decoded.slice(sep + 1);
  assertSafeSegment(blueprintId, 'blueprint_id');
  assertSafeSegment(changeUnitId, 'change_unit_id');
  if (encodeCuFeatureId(blueprintId, changeUnitId) !== featureId) {
    throw new FeatureIdentityError(
      'change_unit_feature_id_invalid',
      `Feature id 非 canonical base64url 编码，不得回退为平铺 Feature：${JSON.stringify(featureId)}`,
    );
  }
  return { blueprintId, changeUnitId };
}

/**
 * 解析 CU 派生 featureId；非 CU 派生（无 `cu-` 前缀）→ 抛错。
 */
function parseCuFeatureId(featureId) {
  const parsed = tryParseCuFeatureId(featureId);
  if (!parsed) {
    throw new FeatureIdentityError(
      'change_unit_feature_id_not_cu',
      `Feature id 非 CU 派生 identity（缺 ${CU_PREFIX} 前缀）：${JSON.stringify(featureId)}`,
    );
  }
  return parsed;
}

/**
 * 唯一实现：逻辑 featureId → 物理 Feature 相对路径（相对 <features_dir>）。
 *   - legacy：原样返回 featureId（目录名即身份）；
 *   - CU：`<blueprint_id>/<change_unit_id>`；
 *   - `cu-` + 非法 payload：抛错（fail-closed）；
 *   - 空/非字符串：抛错。
 *
 * 正反向往返（plan §7 proof 11）：derive → featureRelativePath → 从目录重建
 * （enumerateFeatures）→ parse 必须逐字节一致，全部枚举点经本函数取得同一结果。
 */
function featureRelativePath(featureId) {
  if (typeof featureId !== 'string' || featureId.length === 0) {
    throw new FeatureIdentityError(
      'feature_id_invalid',
      `featureId 必须为非空字符串，实际=${JSON.stringify(featureId)}`,
    );
  }
  const parsed = tryParseCuFeatureId(featureId);
  if (parsed) return `${parsed.blueprintId}/${parsed.changeUnitId}`;
  return featureId;
}

/**
 * 判别分类：只返回 kind='cu' | 'legacy'（plan §5.2 共享枚举函数口径）；
 * `cu-` + 非法 payload 抛错（fail-closed）。
 */
function classifyFeatureId(featureId) {
  const parsed = tryParseCuFeatureId(featureId);
  if (parsed) return { kind: 'cu', blueprintId: parsed.blueprintId, changeUnitId: parsed.changeUnitId };
  return { kind: 'legacy' };
}

module.exports = {
  CU_PREFIX,
  SAFE_SEGMENT_PATTERN,
  FeatureIdentityError,
  assertSafeSegment,
  encodeCuFeatureId,
  parseCuFeatureId,
  tryParseCuFeatureId,
  featureRelativePath,
  classifyFeatureId,
};
