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
    navigation_hint: buildNavigationHintForCase(navRow),
    snapshot_cache_empty,
    available_pages,
    selector_hints,
    allowed_step_roots: [...PLANNED_STEP_ROOT_KEYS],
    forbidden_in_steps: ['start_app', ...FORBIDDEN_STEP_ROOT_KEYS],
    canonical_format:
      'Agent must author Hylyre JSON (test-plan.hylyre.md or test-steps.json); harness does not translate NL.',
    next_action:
      'Read selector_hints; write plan with real by_text/by_id from dump or cache; then: npm run adhoc-device-test -- --bundle <id> --plan <path>',
  };
}
