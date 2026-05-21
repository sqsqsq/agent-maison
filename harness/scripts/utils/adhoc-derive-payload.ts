/**
 * Ad-hoc derive hint payload (schema 4) — mechanical hints only; no Hylyre JSON generation.
 */
import { buildNavigationHintForCase } from './test-plan-derive-hint';
import {
  appSnapshotCacheAbsFor,
  buildSelectorHints,
  isSnapshotCacheEmpty,
  listSnapshotPages,
} from './app-snapshot-cache-hint';
import {
  FORBIDDEN_STEP_ROOT_KEYS,
  PLANNED_STEP_ROOT_KEYS,
} from './hylyre-planned-step-keys';
import { splitNaturalLanguageSteps } from './adhoc-nl-split';
import {
  STEPS_FILE_CONTRACT,
  STEP_SHAPE_CATALOG,
  buildMinimalTouchExample,
  classifyNavigationSteps,
  classifyObservationSteps,
  hasObservationIntent,
} from './adhoc-derive-helpers';

const HYLYRE_TEMPLATE_REF =
  'framework/profiles/hmos-app/skills/6-device-testing/templates/test-plan-hylyre-template.md';

export function buildAdhocDerivePayload(
  projectRoot: string,
  bundle: string,
  stepsRaw: string,
): Record<string, unknown> {
  const natural_steps = splitNaturalLanguageSteps(stepsRaw);
  const cacheAbs = appSnapshotCacheAbsFor(projectRoot);
  const snapshot_cache_empty = isSnapshotCacheEmpty(cacheAbs, bundle);
  const available_pages = listSnapshotPages(cacheAbs, bundle);
  const selector_hints = buildSelectorHints(cacheAbs, bundle, natural_steps);

  const observation_steps = classifyObservationSteps(natural_steps);
  const navigation_steps = classifyNavigationSteps(natural_steps);
  const steps_file_minimal_example = buildMinimalTouchExample(navigation_steps);
  const has_observation = hasObservationIntent(stepsRaw, natural_steps);

  const navRow = {
    tc_id: 'TC-001',
    name: 'adhoc flow',
    precondition: '已启动 app',
    steps_natural_language: stepsRaw,
    expected: '',
    priority: 'P0',
    ac_ref: 'ad-hoc',
  };

  return {
    schema: 4,
    mode: 'adhoc',
    bundle,
    generated_at: new Date().toISOString(),
    natural_steps,
    observation_steps,
    navigation_steps,
    has_observation,
    navigation_hint: buildNavigationHintForCase(navRow),
    snapshot_cache_empty,
    available_pages,
    selector_hints,
    steps_file_contract: {
      ...STEPS_FILE_CONTRACT,
      allowed_step_roots: [...PLANNED_STEP_ROOT_KEYS],
      forbidden_in_steps: ['start_app', ...FORBIDDEN_STEP_ROOT_KEYS],
    },
    steps_file_minimal_example,
    step_shape_catalog: STEP_SHAPE_CATALOG,
    hylyre_template_ref: HYLYRE_TEMPLATE_REF,
    allowed_step_roots: [...PLANNED_STEP_ROOT_KEYS],
    forbidden_in_steps: ['start_app', ...FORBIDDEN_STEP_ROOT_KEYS],
    canonical_format:
      'steps-file 顶层为 JSON 数组；每步恰好一个根键；示例可整段替换；lint 只校验语法不校验业务。',
    next_action: has_observation
      ? 'Read contract + minimal_example (if any); write navigation-only steps-file; lint; adhoc-device-test --steps-file; then --dump-ui-only + summarize-adhoc-dump'
      : 'Read selector_hints + contract; write steps-file; npm run lint-adhoc-steps; adhoc-device-test --steps-file',
  };
}
