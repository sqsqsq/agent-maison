/**
 * Lint agent-authored Hylyre planned step arrays (adhoc --plan / --steps-file).
 */
import {
  FORBIDDEN_STEP_ROOT_KEY_SET,
  PLANNED_STEP_ROOT_KEY_SET,
} from './hylyre-planned-step-keys';

export interface PlannedStepLintViolation {
  index: number;
  rule_id: string;
  message: string;
}

export function validatePlannedStepObject(step: unknown, index: number): PlannedStepLintViolation[] {
  const out: PlannedStepLintViolation[] = [];
  if (!step || typeof step !== 'object' || Array.isArray(step)) {
    out.push({ index, rule_id: 'STEP-000', message: '步骤须为 JSON 对象' });
    return out;
  }
  const obj = step as Record<string, unknown>;
  const roots = Object.keys(obj);
  if (roots.length !== 1) {
    out.push({ index, rule_id: 'STEP-001', message: `每步须恰好一个根键，当前: ${roots.join(', ')}` });
    return out;
  }
  const root = roots[0];
  if (FORBIDDEN_STEP_ROOT_KEY_SET.has(root)) {
    out.push({ index, rule_id: 'STEP-002', message: `禁止根键: ${root}` });
  } else if (!PLANNED_STEP_ROOT_KEY_SET.has(root)) {
    out.push({ index, rule_id: 'STEP-001', message: `未知根键: ${root}` });
  }
  if (root === 'wait') {
    const wb = obj.wait;
    if (!wb || typeof wb !== 'object' || Array.isArray(wb)) {
      out.push({
        index,
        rule_id: 'STEP-WAIT-SECONDS',
        message: 'wait 须为对象且含 seconds（数字）',
      });
    } else {
      const w = wb as Record<string, unknown>;
      const sec = w.seconds;
      if (sec === undefined || sec === null) {
        out.push({
          index,
          rule_id: 'STEP-WAIT-SECONDS',
          message: 'wait 必须有 seconds（数字）；固定等待勿用 timeout',
        });
      } else if (typeof sec !== 'number' || !Number.isFinite(sec)) {
        out.push({
          index,
          rule_id: 'STEP-WAIT-SECONDS',
          message: 'wait.seconds 须为有限数字',
        });
      }
      if (w.timeout !== undefined) {
        out.push({
          index,
          rule_id: 'STEP-WAIT-SECONDS',
          message: 'wait 内禁止 timeout；改用 {"wait":{"seconds":N}}',
        });
      }
      if (w.duration !== undefined) {
        out.push({
          index,
          rule_id: 'STEP-WAIT-SECONDS',
          message: 'wait 内禁止 duration；改用 {"wait":{"seconds":N}}',
        });
      }
    }
  }
  if (root === 'start_app') {
    out.push({
      index,
      rule_id: 'STEP-002',
      message: '即席 steps 禁止 start_app；冷启由 harness 负责',
    });
  }
  if (root === 'touch') {
    const tb = obj.touch;
    if (!tb || typeof tb !== 'object' || Array.isArray(tb)) {
      out.push({ index, rule_id: 'STEP-TOUCH', message: 'touch 须为对象' });
    } else {
      const t = tb as Record<string, unknown>;
      if (t.selector !== undefined) {
        out.push({
          index,
          rule_id: 'STEP-TOUCH',
          message:
            'touch 禁止嵌套 selector；改用 {"touch":{"by_text":"…"}} 或 {"touch":{"by_id":"…"}}',
        });
      }
    }
  }
  if (root === 'wait_for') {
    const wf = obj.wait_for;
    if (!wf || typeof wf !== 'object' || Array.isArray(wf)) {
      out.push({ index, rule_id: 'STEP-WAIT', message: 'wait_for 须为对象且含 selector 或 by_text/by_id' });
    } else {
      const w = wf as Record<string, unknown>;
      const hasSelector =
        w.selector != null ||
        (typeof w.by_text === 'string' && w.by_text.trim().length > 0) ||
        (typeof w.by_id === 'string' && w.by_id.trim().length > 0);
      if (!hasSelector) {
        out.push({
          index,
          rule_id: 'STEP-WAIT',
          message: 'wait_for 缺少 selector / by_text / by_id（禁止仅 duration/timeout）',
        });
      }
    }
  }
  return out;
}

export function validatePlannedStepsArray(
  steps: unknown,
): { ok: true; steps: Record<string, unknown>[] } | { ok: false; violations: PlannedStepLintViolation[] } {
  if (!Array.isArray(steps)) {
    return {
      ok: false,
      violations: [{ index: -1, rule_id: 'STEP-000', message: '步骤列表须为 JSON 数组' }],
    };
  }
  const violations: PlannedStepLintViolation[] = [];
  const normalized: Record<string, unknown>[] = [];
  for (let i = 0; i < steps.length; i++) {
    violations.push(...validatePlannedStepObject(steps[i], i));
    if (steps[i] && typeof steps[i] === 'object' && !Array.isArray(steps[i])) {
      normalized.push(steps[i] as Record<string, unknown>);
    }
  }
  if (violations.length > 0) {
    return { ok: false, violations };
  }
  if (normalized.length === 0) {
    return {
      ok: false,
      violations: [{ index: -1, rule_id: 'STEP-000', message: '至少需要一个 Hylyre 步骤' }],
    };
  }
  return { ok: true, steps: normalized };
}
