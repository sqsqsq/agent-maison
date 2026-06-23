// ============================================================================
// ui-spec-schema-validate.ts — ui-spec.yaml 运行时 schema 校验（手写轻量校验器）
// ============================================================================
// SSOT：harness/schemas/ui-spec.schema.json（draft-07）。仓库惯例不引 ajv，
// 沿用 code-graph/file-schema.ts 的手写校验器模式：枚举/类型/additionalProperties
// 在运行时硬校验，弥补 spec-ui-spec-check.ts 仅手工查少数字段的盲区。
// ============================================================================

import type { UiSpecDoc } from '../../../harness/scripts/utils/ui-spec-shared';

export const COMPONENT_TYPE_ENUM = [
  'input',
  'action_button',
  'overlay_panel',
  'navigation_frame',
  'content_display',
  'list_selection',
  'logic_condition',
] as const;

export const TOKEN_KIND_ENUM = ['color', 'spacing', 'font_size', 'radius', 'divider'] as const;
export const VERIFIED_ENUM = ['verified', 'unverified', 'human_confirmed'] as const;
export const VERIFIED_METHOD_ENUM = ['vl_multimodal', 'human_gate', 'none'] as const;
export const PRIORITY_ENUM = ['P0', 'P1', 'P2', 'P3'] as const;
export const ACQUISITION_ENUM = ['crop', 'svg_grab', 'repo_ref'] as const;

const TOKEN_ALLOWED_KEYS = new Set(['kind', 'value', 'source_bbox', 'source_ref', 'sampled']);
const ASSET_ALLOWED_KEYS = new Set([
  'key', 'acquisition', 'source_ref', 'source_bbox',
  'resolved_path', 'placeholder', 'rationale', 'human_crop_confirmed',
]);
const ROOT_ALLOWED_KEYS = new Set(['schema_version', 'verified', 'verified_method', 'screens', 'tokens', 'assets']);

function isBbox(v: unknown): boolean {
  return (
    Array.isArray(v) &&
    v.length === 4 &&
    v.every(n => typeof n === 'number' && n >= 0 && n <= 1)
  );
}

function validateComponentNode(
  node: unknown,
  pathLabel: string,
  errors: string[],
  seenNodeIds: Set<string>,
): void {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    errors.push(`${pathLabel} 须为对象`);
    return;
  }
  const n = node as Record<string, unknown>;
  if (typeof n.type !== 'string' || !(COMPONENT_TYPE_ENUM as readonly string[]).includes(n.type)) {
    errors.push(`${pathLabel}.type 非法：${JSON.stringify(n.type)}（须 ${COMPONENT_TYPE_ENUM.join('/')}）`);
  }
  if (typeof n.order !== 'number' || !Number.isInteger(n.order) || n.order < 0) {
    errors.push(`${pathLabel}.order 须为 ≥0 整数，收到 ${JSON.stringify(n.order)}`);
  }
  for (const k of ['id', 'layout', 'text', 'data_binding', 'style_ref', 'asset_ref'] as const) {
    if (n[k] !== undefined && typeof n[k] !== 'string') {
      errors.push(`${pathLabel}.${k} 须为字符串`);
    }
  }
  if (typeof n.id === 'string' && n.id.trim()) {
    if (seenNodeIds.has(n.id)) {
      errors.push(`${pathLabel}.id "${n.id}" 重复（全文档 componentNode id 须唯一）`);
    } else {
      seenNodeIds.add(n.id);
    }
  }
  if (n.bbox !== undefined && !isBbox(n.bbox)) {
    errors.push(`${pathLabel}.bbox 须为 4 元归一化 [x,y,w,h]`);
  }
  if (n.children !== undefined) {
    if (!Array.isArray(n.children)) {
      errors.push(`${pathLabel}.children 须为数组`);
    } else {
      n.children.forEach((c, i) => validateComponentNode(c, `${pathLabel}.children[${i}]`, errors, seenNodeIds));
    }
  }
}

/**
 * 对照 ui-spec.schema.json 做运行时 enum/类型/additionalProperties 校验。
 * 返回错误清单（空数组 = schema 合法）。仅做结构校验，不判保真。
 */
export function validateUiSpecSchema(doc: UiSpecDoc): string[] {
  const errors: string[] = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return ['ui-spec 根须为对象'];
  }
  const root = doc as unknown as Record<string, unknown>;

  for (const k of Object.keys(root)) {
    if (!ROOT_ALLOWED_KEYS.has(k)) {
      errors.push(`根含非法字段 "${k}"（additionalProperties=false）`);
    }
  }

  if (root.schema_version !== '1.0') {
    errors.push(`schema_version 须为 "1.0"，收到 ${JSON.stringify(root.schema_version)}`);
  }
  if (root.verified !== undefined && !(VERIFIED_ENUM as readonly string[]).includes(root.verified as string)) {
    errors.push(`verified 非法：${JSON.stringify(root.verified)}（须 ${VERIFIED_ENUM.join('/')}）`);
  }
  if (
    root.verified_method !== undefined &&
    !(VERIFIED_METHOD_ENUM as readonly string[]).includes(root.verified_method as string)
  ) {
    errors.push(`verified_method 非法：${JSON.stringify(root.verified_method)}（须 ${VERIFIED_METHOD_ENUM.join('/')}）`);
  }

  const seenScreenIds = new Set<string>();
  const seenNodeIds = new Set<string>();

  // screens
  if (!Array.isArray(root.screens) || root.screens.length === 0) {
    errors.push('screens 须为非空数组');
  } else {
    root.screens.forEach((s, i) => {
      if (!s || typeof s !== 'object' || Array.isArray(s)) {
        errors.push(`screens[${i}] 须为对象`);
        return;
      }
      const sc = s as Record<string, unknown>;
      if (typeof sc.id !== 'string' || !sc.id.trim()) {
        errors.push(`screens[${i}].id 必填字符串`);
      } else if (seenScreenIds.has(sc.id)) {
        errors.push(`screens[${i}].id "${sc.id}" 重复（screens[].id 须唯一）`);
      } else {
        seenScreenIds.add(sc.id);
        if (seenNodeIds.has(sc.id)) {
          errors.push(`screens[${i}].id "${sc.id}" 与 componentNode id 冲突（全文档 id 须唯一）`);
        } else {
          seenNodeIds.add(sc.id);
        }
      }
      if (typeof sc.priority !== 'string' || !(PRIORITY_ENUM as readonly string[]).includes(sc.priority)) {
        errors.push(`screens[${i}].priority 非法：${JSON.stringify(sc.priority)}（须 ${PRIORITY_ENUM.join('/')}）`);
      }
      if (sc.lightweight !== undefined && typeof sc.lightweight !== 'boolean') {
        errors.push(`screens[${i}].lightweight 须为布尔`);
      }
      if (sc.ref_id !== undefined && typeof sc.ref_id !== 'string') {
        errors.push(`screens[${i}].ref_id 须为字符串`);
      }
      if (sc.root !== undefined) {
        validateComponentNode(sc.root, `screens[${i}].root`, errors, seenNodeIds);
      }
    });
  }

  // tokens
  if (!root.tokens || typeof root.tokens !== 'object' || Array.isArray(root.tokens)) {
    errors.push('tokens 须为对象');
  } else {
    for (const [key, tok] of Object.entries(root.tokens as Record<string, unknown>)) {
      if (!tok || typeof tok !== 'object' || Array.isArray(tok)) {
        errors.push(`token ${key} 须为对象`);
        continue;
      }
      const t = tok as Record<string, unknown>;
      for (const k of Object.keys(t)) {
        if (!TOKEN_ALLOWED_KEYS.has(k)) {
          errors.push(`token ${key} 含非法字段 "${k}"`);
        }
      }
      if (typeof t.kind !== 'string' || !(TOKEN_KIND_ENUM as readonly string[]).includes(t.kind)) {
        errors.push(`token ${key}.kind 非法：${JSON.stringify(t.kind)}（须 ${TOKEN_KIND_ENUM.join('/')}）`);
      }
      if (typeof t.value !== 'string') {
        errors.push(`token ${key}.value 须为字符串`);
      }
      if (t.source_bbox !== undefined && !isBbox(t.source_bbox)) {
        errors.push(`token ${key}.source_bbox 须为 4 元归一化 [x,y,w,h]`);
      }
      if (t.source_ref !== undefined && typeof t.source_ref !== 'string') {
        errors.push(`token ${key}.source_ref 须为字符串`);
      }
      if (t.sampled !== undefined && typeof t.sampled !== 'boolean') {
        errors.push(`token ${key}.sampled 须为布尔`);
      }
    }
  }

  // assets
  if (!Array.isArray(root.assets)) {
    errors.push('assets 须为数组');
  } else {
    root.assets.forEach((a, i) => {
      if (!a || typeof a !== 'object' || Array.isArray(a)) {
        errors.push(`assets[${i}] 须为对象`);
        return;
      }
      const as = a as Record<string, unknown>;
      for (const k of Object.keys(as)) {
        if (!ASSET_ALLOWED_KEYS.has(k)) {
          errors.push(`assets[${i}] 含非法字段 "${k}"`);
        }
      }
      if (typeof as.key !== 'string' || !as.key.trim()) {
        errors.push(`assets[${i}].key 必填字符串`);
      }
      if (typeof as.acquisition !== 'string' || !(ACQUISITION_ENUM as readonly string[]).includes(as.acquisition)) {
        errors.push(`assets[${i}].acquisition 非法：${JSON.stringify(as.acquisition)}（须 ${ACQUISITION_ENUM.join('/')}）`);
      }
      if (as.source_bbox !== undefined && !isBbox(as.source_bbox)) {
        errors.push(`assets[${i}].source_bbox 须为 4 元归一化 [x,y,w,h]`);
      }
      for (const k of ['source_ref', 'resolved_path', 'rationale'] as const) {
        if (as[k] !== undefined && typeof as[k] !== 'string') {
          errors.push(`assets[${i}].${k} 须为字符串`);
        }
      }
      for (const k of ['placeholder', 'human_crop_confirmed'] as const) {
        if (as[k] !== undefined && typeof as[k] !== 'boolean') {
          errors.push(`assets[${i}].${k} 须为布尔`);
        }
      }
    });
  }

  return errors;
}
