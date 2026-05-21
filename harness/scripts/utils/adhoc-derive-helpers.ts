/**
 * Mechanical helpers for ad-hoc derive (no Hylyre JSON translation for complex flows).
 */
import { splitNaturalLanguageSteps } from './adhoc-nl-split';

const OBSERVATION_RE =
  /查看|汇总|所有|列表|整理|信息|存在|展示|罗列|统计|读取|抓取|dump/i;

const OPEN_APP_RE = /^打开(应用|app)?$/i;

const TOUCH_EXTRACT_RE = /^(?:点击|点|触摸|按)(?:击)?(.+)$/;

/** NL steps that should use dump-ui after navigation, not go into steps-file. */
export function classifyObservationSteps(naturalSteps: string[]): string[] {
  return naturalSteps.filter(s => OBSERVATION_RE.test(s));
}

export function classifyNavigationSteps(naturalSteps: string[]): string[] {
  const obs = new Set(classifyObservationSteps(naturalSteps));
  return naturalSteps.filter(s => !obs.has(s));
}

export function hasObservationIntent(stepsRaw: string, naturalSteps: string[]): boolean {
  if (OBSERVATION_RE.test(stepsRaw)) return true;
  return classifyObservationSteps(naturalSteps).length > 0;
}

/** Extract by_text from 「点击某某」; returns null if not mechanically mappable. */
export function extractTouchByText(nlStep: string): string | null {
  const s = nlStep.trim();
  if (OPEN_APP_RE.test(s)) return null;
  const m = s.match(TOUCH_EXTRACT_RE);
  if (m?.[1]) return m[1].trim();
  return null;
}

export function buildMinimalTouchExample(
  navigationSteps: string[],
): { kind: 'minimal_touch_only'; agent_may_extend: true; steps: Record<string, unknown>[] } | null {
  const steps: Record<string, unknown>[] = [];
  for (const nl of navigationSteps) {
    if (OPEN_APP_RE.test(nl.trim())) continue;
    const text = extractTouchByText(nl);
    if (!text) return null;
    steps.push({ touch: { by_text: text } });
  }
  if (steps.length === 0) return null;
  return { kind: 'minimal_touch_only', agent_may_extend: true, steps };
}

export function splitStepsRaw(stepsRaw: string): string[] {
  return splitNaturalLanguageSteps(stepsRaw);
}

/** Hylyre 0.1.0: wait 用 seconds；wait_for/wait_gone/wait_idle/assert_toast 用 timeout。 */
export const WAIT_FIELD_TIMING_REF: Array<{
  root: string;
  duration_field: 'seconds' | 'timeout';
  default_seconds?: number;
  note: string;
}> = [
  {
    root: 'wait',
    duration_field: 'seconds',
    note: '固定 sleep；必填 seconds；禁止 timeout/duration',
  },
  {
    root: 'wait_for',
    duration_field: 'timeout',
    default_seconds: 10,
    note: '等待元素出现；须 selector/by_text/by_id；超时字段 timeout（非 seconds）',
  },
  {
    root: 'wait_gone',
    duration_field: 'timeout',
    default_seconds: 10,
    note: '等待元素消失；须 selector/by_text/by_id',
  },
  {
    root: 'wait_idle',
    duration_field: 'timeout',
    default_seconds: 10,
    note: '等待 UI 空闲；可选 idle_time（默认 0.7）；超时字段 timeout',
  },
  {
    root: 'assert_toast',
    duration_field: 'timeout',
    default_seconds: 3,
    note: 'Toast 断言；必填 text；超时字段 timeout',
  },
];

export const STEP_SHAPE_CATALOG: Array<{
  root: string;
  example: Record<string, unknown>;
  note: string;
}> = [
  { root: 'touch', example: { touch: { by_text: '按钮文案' } }, note: '点击；优先 by_text，稳定后用 by_id' },
  { root: 'input', example: { input: { by_id: 'field_id', text: '100' } }, note: '输入文本' },
  { root: 'swipe', example: { swipe: { direction: 'UP', distance: 50 } }, note: '滑动；Nav 返回用 back 勿乱 swipe' },
  { root: 'scroll', example: { scroll: { direction: 'down', steps: 6 } }, note: '滚轮/列表滚动' },
  { root: 'back', example: { back: {} }, note: '系统/Nav 返回' },
  { root: 'wait', example: { wait: { seconds: 2 } }, note: '固定等待 N 秒；必填 seconds，勿写 timeout' },
  {
    root: 'wait_for',
    example: { wait_for: { by_text: '加载完成', timeout: 10 } },
    note: '等待元素出现；须 selector/by_text/by_id；超时用 timeout（默认 10）',
  },
  {
    root: 'wait_gone',
    example: { wait_gone: { by_id: 'loading_spinner', timeout: 10 } },
    note: '等待元素消失；须 selector/by_text/by_id',
  },
  {
    root: 'wait_idle',
    example: { wait_idle: { idle_time: 0.7, timeout: 10 } },
    note: '等待 UI 空闲；idle_time 可选（默认 0.7）',
  },
  { root: 'assert_toast', example: { assert_toast: { text: '成功', timeout: 3 } }, note: 'Toast 断言；必填 text' },
];

export const STEPS_FILE_CONTRACT = {
  top_level: 'json_array',
  one_root_key_per_step: true,
  forbid_wrapper_object_with_steps_key: true,
  forbid_per_step_fields: ['step', 'action', 'note'],
  observation_nl_not_in_steps: true,
  agent_may_replace_minimal_example: true,
  lint_cli: 'npm run lint-adhoc-steps -- --file <path>',
} as const;
