// ============================================================================
// defaultProjectRoot — CLI 脚本的项目根推断
// ============================================================================
// 多个 harness CLI 入口（derive-*-hint、adhoc-device-test 等）在 consumer 布局
// （framework/harness/）下运行时，需要把 cwd 回推两级得到实例工程根；standalone
// 直接用 cwd。历史上每个入口各自内联了一份，此处收敛为单一 SSOT。
// ============================================================================

import * as path from 'path';

export function defaultProjectRoot(): string {
  const cwd = process.cwd();
  if (path.basename(cwd) === 'harness' && path.basename(path.dirname(cwd)) === 'framework') {
    return path.resolve(cwd, '..', '..');
  }
  return cwd;
}
