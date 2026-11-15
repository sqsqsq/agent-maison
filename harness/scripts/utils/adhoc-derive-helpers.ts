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
  { root: 'touch', example: { touch: { by_text: '按钮文案', match: 'exact' } }, note: '点击mode默认normal，可选double/long；仅long可给press_time，默认2秒，保留wait_time' },
  { root: 'input', example: { input: { by_id: 'field_id', text: '100' } }, note: '输入文本' },
  { root: 'swipe', example: { swipe: { direction: 'UP', distance: 50 } }, note: '滑动；Nav 返回用 back 勿乱 swipe' },
  { root: 'scroll', example: { scroll: { direction: 'down', steps: 6 } }, note: '滚轮/列表滚动' },
  { root: 'back', example: { back: {} }, note: '系统/Nav 返回' },
  { root: 'wait', example: { wait: { seconds: 2 } }, note: '固定等待 N 秒；必填 seconds，勿写 timeout' },
  {
    root: 'wait_for',
    example: { wait_for: { by_text: '加载完成', match: 'exact', timeout: 10 } },
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
  { root: 'home', example: { home: {} }, note: '回桌面' },
  { root: 'scroll_to', example: { scroll_to: { by_text: '目标文案', match: 'exact', in: { by_type: 'List' } } }, note: '长列表滚动定位；屏内已匹配时不空滚' },
  { root: "drag", example: {"drag":{"start":{"by_id":"item"},"end":{"x":300,"y":500},"press_time":1.5}}, note: "起终点坐标或富选择器；press_time默认1.5，drag_time默认1；显式speed与drag_time互斥" },
  { root: "slide", example: {"slide":{"start":{"x":100,"y":200},"end":{"x":300,"y":500},"duration":0.3}}, note: "点到点滑动；duration默认0.3秒；不接受speed" },
  { root: "fling", example: {"fling":{"direction":"UP","distance":50,"speed":"fast"}}, note: "原生惯性抛滑；direction同swipe，speed仅fast/normal/slow，默认fast" },
  { root: "pinch_in", example: {"pinch_in":{"area":{"by_id":"canvas"},"scale":0.4,"direction":"diagonal"}}, note: "area必填；scale在(0,1)，默认0.4；direction仅diagonal/horizontal" },
  { root: "pinch_out", example: {"pinch_out":{"area":{"by_id":"canvas"},"scale":1.6,"direction":"diagonal"}}, note: "area必填；scale在(1,2)，默认1.6；direction仅diagonal/horizontal" },
  { root: "two_finger_swipe", example: {"two_finger_swipe":{"start1":{"x":100,"y":200},"end1":{"x":100,"y":400},"start2":{"x":200,"y":200},"end2":{"x":200,"y":400},"duration":0.5}}, note: "双指同时移动，duration默认0.5；可选area不改变屏幕绝对像素原点" },
  { root: "multi_finger_touch", example: {"multi_finger_touch":{"points":[{"x":100,"y":200},{"x":200,"y":200}],"duration":0.1}}, note: "2–4个触点同时按下，duration默认0.1；points是屏幕绝对整数像素或富选择器" },
  { root: "gesture", example: {"gesture":{"fingers":[{"points":[{"x":100,"y":200},{"x":200,"y":300},{"x":300,"y":200}]}],"speed":2000}}, note: "每指至少两个连续点，speed默认2000；单指/多指轨迹整条一次注入" },
  { root: "press_key", example: {"press_key":{"key":"ENTER","mode":"normal"}}, note: "Hypium KeyCode精确符号名或非负整数；mode默认normal，可选long/double" },
  { root: "press_combination_key", example: {"press_combination_key":{"keys":["CTRL_LEFT","A"]}}, note: "2–3个不同键同时按下；HMOS或未确认三键能力时blocked，不降级两键" },
  { root: "get_component_property", example: {"get_component_property":{"target":{"by_id":"field"},"property":"text"}}, note: "读取十项属性，真实控件target；查询是action，不计STEP-SETUP准备动作，不代替业务断言" },
  { root: "shell", example: {"shell":{"command":"printf 'hylyre\\n'","timeout":60}}, note: "明确授权设备command原文，timeout默认60秒；分开设备/传输退出码，超时不重试；查询不计断言" },
  { root: "clear_text", example: {"clear_text":{"target":{"by_id":"field"}}}, note: "target须真实输入控件；使用原生清空，不以input空字符串替代" },
  { root: "move_cursor", example: {"move_cursor":{"direction":"left","times":1}}, note: "当前焦点光标移动；left/right/up/down/begin/end，times默认1，不重新聚焦" },
  { root: "set_checked", example: {"set_checked":{"target":{"by_id":"checkbox"},"checked":true,"timeout":3}}, note: "checkable控件读前状态，按需点击一次并复读；已满足changed=false；action不代替业务断言，不能作为P0 checkpoint绑定动作" },
  { root: "current_app", example: {"current_app":{}}, note: "空对象；读取真实bundle/ability，ability不可得显式null，无bundle则blocked；不计STEP-SETUP准备动作" },
  { root: "has_app", example: {"has_app":{"bundle":"com.example.app"}}, note: "精确bundle安装查询；未安装是installed=false，仍为成功action；不计STEP-SETUP准备动作" },
  { root: "recent_tasks", example: {"recent_tasks":{}}, note: "进入系统最近任务；设备需支持相应手势导航" },
];

export const STEPS_FILE_CONTRACT = {
  top_level: 'json_array',
  one_root_key_per_step: true,
  forbid_wrapper_object_with_steps_key: true,
  forbid_per_step_fields: ['step', 'action', 'note'],
  observation_nl_not_in_steps: true,
  agent_may_replace_minimal_example: true,
  lint_cli: 'npm run lint-adhoc-steps -- --file <path>',
  recommended_write_path: 'doc/features/_adhoc/testing/staging/test-steps.json',
  forbidden_write_prefixes: ['framework/harness/', 'harness/'],
  run_output_dir_pattern: 'doc/features/_adhoc/testing/reports/<timestamp>/hylyre/',
} as const;
