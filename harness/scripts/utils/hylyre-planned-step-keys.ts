/**
 * Synced from Hylyre vendor source `src/hylyre/api/planned_step_keys.py` (vendor 0.6.2).
 * SSOT for STEP-001 lint; update when the vendor release bumps.
 */
export const PLANNED_STEP_ROOT_KEYS: readonly string[] = [
  'action',
  'touch',
  'input',
  'swipe',
  'scroll',
  'scroll_to',
  'back',
  'home',
  'stop_app',
  'clear_app',
  'wait',
  'wait_for',
  'wait_gone',
  'wait_idle',
  'assert_toast',
  'start_app',
  'drag',
  'slide',
  'fling',
  'pinch_in',
  'pinch_out',
  'two_finger_swipe',
  'multi_finger_touch',
  'gesture',
  'press_key',
  'press_combination_key',
  'get_component_property',
  'shell',
  'clear_text',
  'move_cursor',
  'set_checked',
  'current_app',
  'has_app',
  'recent_tasks',
] as const;

/** CLI subcommand names that must NOT appear as step JSON root keys (STEP-002). */
export const FORBIDDEN_STEP_ROOT_KEYS: readonly string[] = [
  'dump_ui',
  'dump-ui',
  'page_save',
  'page-save',
  'app',
  'find',
  'doctor',
  'collect',
  'screenshot',
] as const;

export const PLANNED_STEP_ROOT_KEY_SET = new Set<string>(PLANNED_STEP_ROOT_KEYS);

export const FORBIDDEN_STEP_ROOT_KEY_SET = new Set<string>(FORBIDDEN_STEP_ROOT_KEYS);
