// ============================================================================
// diagnostic-header.ts — 共享诊断头 util（t6，plan e6a3c9f4 / openspec toolchain-probe-truth）
// ----------------------------------------------------------------------------
// 自 ut-hvigor-test-failure.ts 抽出（b4e7a2c9 建立的 ≤180 字首行范式）：诊断头必须
// 单行、归一空白、硬截断——details 首行即结论，不埋日志尾（经 goal 800→300 截断仍存活）。
// hvigor build（coding compile）链与 UT 聚合模块共同消费；抽共享层避免 hvigor-runner
// 反向依赖 UT 聚合模块（codex round4 意见）。
// ============================================================================

export function buildCompactDiagnosticHeader(text: string, max = 180): string {
  const normalized = text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  if (max <= 0) return '';
  if (normalized.length <= max) return normalized;
  if (max === 1) return '…';
  return `${normalized.slice(0, max - 1).trimEnd()}…`;
}
