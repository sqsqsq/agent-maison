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
/** G3：按钮变体 / 对齐枚举 */
export const BUTTON_VARIANT_ENUM = ['filled', 'tonal', 'outlined', 'ghost', 'text'] as const;
export const ALIGN_ENUM = ['start', 'center', 'end', 'space_between', 'stretch'] as const;

const TOKEN_ALLOWED_KEYS = new Set(['kind', 'value', 'source_bbox', 'source_ref', 'sampled']);
const ASSET_ALLOWED_KEYS = new Set([
  'key', 'acquisition', 'source_ref', 'source_bbox',
  'resolved_path', 'placeholder', 'rationale', 'human_crop_confirmed', 'crop_confirmed_by',
  // round5 P0-A 烤字 defer（TS 类型已有，validator 此前漏登记）
  'baked_text_defer', 'baked_text_defer_by',
  // P0-C（f2d8c4a6）：产物验真真人署名（与 crop_confirmed_by 授权语义正交）
  'bbox_verified_by',
]);
const ROOT_ALLOWED_KEYS = new Set(['schema_version', 'verified', 'verified_method', 'screens', 'tokens', 'assets', 'global_elements']);

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
  for (const k of ['id', 'layout', 'text', 'data_binding', 'style_ref', 'asset_ref', 'fidelity_note'] as const) {
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
  // G3：捕获保真字段（variant/align/width_ratio/layout_group/bg_color）
  if (n.variant !== undefined && !(BUTTON_VARIANT_ENUM as readonly string[]).includes(n.variant as string)) {
    errors.push(`${pathLabel}.variant 非法：${JSON.stringify(n.variant)}（须 ${BUTTON_VARIANT_ENUM.join('/')}）`);
  }
  if (n.align !== undefined && !(ALIGN_ENUM as readonly string[]).includes(n.align as string)) {
    errors.push(`${pathLabel}.align 非法：${JSON.stringify(n.align)}（须 ${ALIGN_ENUM.join('/')}）`);
  }
  if (n.width_ratio !== undefined && (typeof n.width_ratio !== 'number' || n.width_ratio < 0 || n.width_ratio > 1)) {
    errors.push(`${pathLabel}.width_ratio 须为 [0,1] 数值，收到 ${JSON.stringify(n.width_ratio)}`);
  }
  for (const k of ['layout_group', 'bg_color'] as const) {
    if (n[k] !== undefined && typeof n[k] !== 'string') {
      errors.push(`${pathLabel}.${k} 须为字符串`);
    }
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
      for (const k of ['source_ref', 'resolved_path', 'rationale', 'crop_confirmed_by', 'baked_text_defer_by', 'bbox_verified_by'] as const) {
        if (as[k] !== undefined && typeof as[k] !== 'string') {
          errors.push(`assets[${i}].${k} 须为字符串`);
        }
      }
      for (const k of ['placeholder', 'human_crop_confirmed', 'baked_text_defer'] as const) {
        if (as[k] !== undefined && typeof as[k] !== 'boolean') {
          errors.push(`assets[${i}].${k} 须为布尔`);
        }
      }
    });
  }

  // T5：global_elements（可选）——{ id, texts[], owner_screen_ids[], band?{start,end?} }
  if (root.global_elements !== undefined) {
    if (!Array.isArray(root.global_elements)) {
      errors.push('global_elements 须为数组');
    } else {
      root.global_elements.forEach((g, i) => {
        if (!g || typeof g !== 'object' || Array.isArray(g)) {
          errors.push(`global_elements[${i}] 须为对象`);
          return;
        }
        const ge = g as Record<string, unknown>;
        if (typeof ge.id !== 'string' || !ge.id.trim()) {
          errors.push(`global_elements[${i}].id 必填字符串`);
        }
        if (!Array.isArray(ge.texts) || ge.texts.length === 0 || !ge.texts.every(t => typeof t === 'string' && t.trim())) {
          errors.push(`global_elements[${i}].texts 须为非空字符串数组`);
        }
        if (
          !Array.isArray(ge.owner_screen_ids) ||
          ge.owner_screen_ids.length === 0 ||
          !ge.owner_screen_ids.every(s => typeof s === 'string' && s.trim())
        ) {
          // 空数组/空串=所有屏都被当非属主（全屏误判越界），属配置写错 → 拒（至少 1 个真实属主屏）
          errors.push(`global_elements[${i}].owner_screen_ids 须为非空字符串数组（至少 1 个属主屏；空数组/空串会致全屏误判越界）`);
        }
        if (ge.band !== undefined) {
          const b = ge.band as Record<string, unknown>;
          if (!b || typeof b !== 'object' || typeof b.start !== 'number' || b.start < 0 || b.start > 1) {
            errors.push(`global_elements[${i}].band.start 须为 [0,1] 数`);
          } else if (b.end !== undefined) {
            if (typeof b.end !== 'number' || b.end < 0 || b.end > 1) {
              errors.push(`global_elements[${i}].band.end 须为 [0,1] 数`);
            } else if (b.end < (b.start as number)) {
              // end < start → band 永远命不中，属配置写错 → 拒
              errors.push(`global_elements[${i}].band.end (${b.end}) 须 >= start (${b.start})（否则 band 永不命中）`);
            }
          }
        }
      });
    }
  }

  return errors;
}
