/**
 * Synced from Hylyre wheel `hylyre/api/planned_step_keys.py` (vendor 0.2.0).
 * SSOT for STEP-001 lint; update when vendor wheel bumps.
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
