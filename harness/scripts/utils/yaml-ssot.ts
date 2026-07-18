// ============================================================================
// yaml-ssot — YAML SSOT 文件加载共享工具
// ============================================================================
// module-catalog / glossary 等「整文件 YAML SSOT」解析器共用的加载骨架：
//   - 文件存在性检查 → 读取 → YAML.parse → 顶层对象校验
//   - toStringArray：把 unknown 收敛为 string[]
// 各解析器只保留自己的字段级 normalize 逻辑，避免样板重复。
// ============================================================================

import * as fs from 'fs';
import * as YAML from 'yaml';

export type YamlSsotLoadError =
  | { kind: 'file_not_found'; path: string }
  | { kind: 'invalid_yaml'; message: string }
  | { kind: 'invalid_schema'; message: string };

/**
 * 读取并解析一个 YAML SSOT 文件，返回顶层对象（`Record<string, unknown>`）。
 * 文件缺失 / 读取失败 → `file_not_found`（携带 `relPath`）；
 * YAML 解析失败 → `invalid_yaml`；顶层不是对象 → `invalid_schema`。
 */
export function loadYamlSsotRoot(
  fullPath: string,
  relPath: string,
):
  | { ok: true; root: Record<string, unknown> }
  | { ok: false; error: YamlSsotLoadError } {
  if (!fs.existsSync(fullPath)) {
    return { ok: false, error: { kind: 'file_not_found', path: relPath } };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return { ok: false, error: { kind: 'file_not_found', path: relPath } };
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: { kind: 'invalid_yaml', message: (err as Error).message },
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      ok: false,
      error: { kind: 'invalid_schema', message: 'root must be an object' },
    };
  }

  return { ok: true, root: parsed as Record<string, unknown> };
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}
