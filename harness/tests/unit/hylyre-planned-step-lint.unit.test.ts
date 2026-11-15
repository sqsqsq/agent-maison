// ============================================================================
// hylyre-planned-step-lint.unit.test.ts
// ============================================================================

import { validatePlannedStepsArray } from '../../scripts/utils/hylyre-planned-step-lint';
import { STEP_SHAPE_CATALOG } from '../../scripts/utils/adhoc-derive-helpers';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'Hylyre 0.6.0 catalog roots pass STEP-001; existing start_app policy remains',
    run: () => {
      for (const shape of STEP_SHAPE_CATALOG) {
        const result = validatePlannedStepsArray([shape.example]);
        if (!result.ok) {
          throw new Error(`${shape.root}: ${JSON.stringify(result.violations)}`);
        }
      }
      const startApp = validatePlannedStepsArray([{ start_app: { bundle: 'com.example.app' } }]);
      if (startApp.ok || !startApp.violations.some(v => v.rule_id === 'STEP-002')) throw new Error('adhoc start_app policy changed');
      const unknown = validatePlannedStepsArray([{ unknown_device_operation: {} }]);
      if (unknown.ok || !unknown.violations.some(v => v.rule_id === 'STEP-001')) throw new Error('unknown root must fail');
      const multiple = validatePlannedStepsArray([{ current_app: {}, recent_tasks: {} }]);
      if (multiple.ok || !multiple.violations.some(v => v.rule_id === 'STEP-001')) throw new Error('multiple roots must fail');
    },
  },
  {
    name: 'validatePlannedStepsArray: touch ok',
    run: () => {
      const r = validatePlannedStepsArray([{ touch: { by_text: '首页' } }]);
      if (!r.ok) throw new Error(JSON.stringify(r));
    },
  },
  {
    name: 'validatePlannedStepsArray: wait_for duration only FAIL',
    run: () => {
      const r = validatePlannedStepsArray([{ wait_for: { duration: 2000 } }]);
      if (r.ok) throw new Error('expected FAIL');
      if (!r.violations.some(v => v.rule_id === 'STEP-WAIT')) {
        throw new Error(`violations: ${JSON.stringify(r.violations)}`);
      }
    },
  },
  {
    name: 'validatePlannedStepsArray: wait_for with by_text ok',
    run: () => {
      const r = validatePlannedStepsArray([{ wait_for: { by_text: '首页', duration: 2000 } }]);
      if (!r.ok) throw new Error(JSON.stringify(r));
    },
  },
  {
    name: 'validatePlannedStepsArray: wait with seconds ok',
    run: () => {
      const r = validatePlannedStepsArray([{ wait: { seconds: 2 } }]);
      if (!r.ok) throw new Error(JSON.stringify(r));
    },
  },
  {
    name: 'validatePlannedStepsArray: wait with timeout FAIL',
    run: () => {
      const r = validatePlannedStepsArray([{ wait: { timeout: 3 } }]);
      if (r.ok) throw new Error('expected FAIL');
      if (!r.violations.some(v => v.rule_id === 'STEP-WAIT-SECONDS')) {
        throw new Error(`violations: ${JSON.stringify(r.violations)}`);
      }
    },
  },
  {
    name: 'validatePlannedStepsArray: wait missing seconds FAIL',
    run: () => {
      const r = validatePlannedStepsArray([{ wait: {} }]);
      if (r.ok) throw new Error('expected FAIL');
      if (!r.violations.some(v => v.rule_id === 'STEP-WAIT-SECONDS')) {
        throw new Error(`violations: ${JSON.stringify(r.violations)}`);
      }
    },
  },
  {
    name: 'validatePlannedStepsArray: touch selector nested FAIL',
    run: () => {
      const r = validatePlannedStepsArray([{ touch: { selector: { text: '确认' } } }]);
      if (r.ok) throw new Error('expected FAIL');
      if (!r.violations.some(v => v.rule_id === 'STEP-TOUCH')) {
        throw new Error(`violations: ${JSON.stringify(r.violations)}`);
      }
    },
  },
  {
    name: 'validatePlannedStepsArray: start_app FAIL',
    run: () => {
      const r = validatePlannedStepsArray([{ start_app: { bundle: 'com.test' } }]);
      if (r.ok) throw new Error('expected FAIL');
      if (!r.violations.some(v => v.rule_id === 'STEP-002' && v.message.includes('start_app'))) {
        throw new Error(`violations: ${JSON.stringify(r.violations)}`);
      }
    },
  },
  {
    name: 'validatePlannedStepsArray: scroll_to ok',
    run: () => {
      const r = validatePlannedStepsArray([{ scroll_to: { by_text: '招商银行', in: { by_type: 'List' } } }]);
      if (!r.ok) throw new Error(JSON.stringify(r));
    },
  },
  {
    name: 'validatePlannedStepsArray: touch rich selector scope ok',
    run: () => {
      const r = validatePlannedStepsArray([{ touch: { by_text: '下一步', scope: 'top_overlay' } }]);
      if (!r.ok) throw new Error(JSON.stringify(r));
    },
  },
  {
    name: 'validatePlannedStepsArray: wait_for all rich selector ok',
    run: () => {
      const r = validatePlannedStepsArray([
        { wait_for: { all: [{ by_text: '下一步' }, { enabled: true }], timeout: 10 } },
      ]);
      if (!r.ok) throw new Error(JSON.stringify(r));
    },
  },
  {
    name: 'validatePlannedStepsArray: wait_for by_key ok',
    run: () => {
      const r = validatePlannedStepsArray([{ wait_for: { by_key: 'submit_btn', timeout: 5 } }]);
      if (!r.ok) throw new Error(JSON.stringify(r));
    },
  },
  {
    name: 'validatePlannedStepsArray: wait_for scope top_overlay ok',
    run: () => {
      const r = validatePlannedStepsArray([
        { wait_for: { by_text: '下一步', scope: 'top_overlay', timeout: 10 } },
      ]);
      if (!r.ok) throw new Error(JSON.stringify(r));
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

if (require.main === module) {
  const r = runAll();
  for (const x of r) {
    console.log(x.ok ? `PASS ${x.name}` : `FAIL ${x.name}: ${x.error}`);
  }
  process.exit(r.every(x => x.ok) ? 0 : 1);
}
