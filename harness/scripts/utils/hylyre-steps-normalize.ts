/**
 * Normalize common agent JSON shape mistakes before steps-file lint (adhoc).
 */
export interface NormalizeStepsResult {
  steps: unknown[];
  warnings: string[];
  changed: boolean;
}

function flattenActionWrapper(step: Record<string, unknown>): Record<string, unknown> | null {
  const action = step.action;
  if (!action || typeof action !== 'object' || Array.isArray(action)) return null;
  const a = action as Record<string, unknown>;
  const type = typeof a.type === 'string' ? a.type : '';
  if (type === 'touch' && (a.by_text || a.by_id || a.selector)) {
    const touch: Record<string, unknown> = {};
    if (a.by_text) touch.by_text = a.by_text;
    if (a.by_id) touch.by_id = a.by_id;
    if (a.selector) touch.selector = a.selector;
    return { touch };
  }
  if (type && PLANNED_FROM_ACTION.has(type)) {
    const inner = { ...a };
    delete inner.type;
    return { [type]: inner };
  }
  return null;
}

const PLANNED_FROM_ACTION = new Set([
  'touch',
  'input',
  'swipe',
  'scroll',
  'back',
  'home',
  'wait_for',
  'wait',
  'assert_toast',
]);

function normalizeOneStep(raw: unknown, index: number, warnings: string[]): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  let obj = { ...(raw as Record<string, unknown>) };
  const strip = ['step', 'note', 'tc_id', 'id'];
  let stripped = false;
  for (const k of strip) {
    if (k in obj) {
      delete obj[k];
      stripped = true;
    }
  }
  if (stripped) {
    warnings.push(`#${index}: 已剥离非法同级字段 step/note/tc_id/id`);
  }
  if ('action' in obj) {
    const flat = flattenActionWrapper(obj);
    if (flat) {
      warnings.push(`#${index}: 已将 action 包装展平为 direct 根键`);
      obj = flat;
    }
  }
  const roots = Object.keys(obj);
  if (roots.length === 1) return obj;
  return obj;
}

export function normalizePlannedStepsInput(parsed: unknown): NormalizeStepsResult {
  const warnings: string[] = [];
  let arr: unknown[] | null = null;
  let changed = false;

  if (Array.isArray(parsed)) {
    arr = parsed;
  } else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const o = parsed as Record<string, unknown>;
    if (Array.isArray(o.steps)) {
      arr = o.steps;
      warnings.push('已 unwrap 外层 { steps: [...] } → 顶层数组');
      changed = true;
    }
  }

  if (!arr) {
    return { steps: [], warnings: ['无法归一化为步骤数组'], changed: false };
  }

  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < arr.length; i++) {
    const before = JSON.stringify(arr[i]);
    const norm = normalizeOneStep(arr[i], i, warnings);
    if (norm) {
      out.push(norm);
      if (JSON.stringify(norm) !== before) changed = true;
    }
  }

  if (out.length !== arr.length) changed = true;
  return { steps: out, warnings, changed };
}
