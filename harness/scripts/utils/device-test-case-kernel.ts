import type { AcceptanceSpec } from './types';
import { splitNaturalLanguageSteps } from './adhoc-nl-split';
import { collectDeviceScopeP0P1 } from './acceptance-layering';

export type DeviceCaseMode = 'acceptance' | 'adhoc';

export interface NormalizedDeviceTestCase {
  id: string;
  name: string;
  priority: string;
  source_ref: string;
  steps: string[];
  expected: string;
}

export interface DeviceCaseNormalization {
  schema_version: '1.0';
  mode: DeviceCaseMode;
  depth: 'full' | 'adhoc';
  cases: NormalizedDeviceTestCase[];
  issues: string[];
}

export type DeviceCaseInput =
  | { mode: 'acceptance'; acceptance: AcceptanceSpec }
  | { mode: 'adhoc'; natural_language: string };

function validateCases(mode: DeviceCaseMode, cases: NormalizedDeviceTestCase[]): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const item of cases) {
    if (!item.id.trim()) issues.push('case id 不能为空');
    if (seen.has(item.id)) issues.push(`case id 重复: ${item.id}`);
    seen.add(item.id);
    if (item.steps.length === 0 || item.steps.some((step) => !step.trim())) {
      issues.push(`${item.id || '<unknown>'} 缺少可执行步骤`);
    }
    if (!item.source_ref.trim()) issues.push(`${item.id || '<unknown>'} 缺少 source_ref`);
  }
  if (mode === 'adhoc' && cases.length === 0) issues.push('adhoc 自然语言未归一出任何步骤');
  return issues;
}

/**
 * Phase 与 adhoc 共用的 cases 契约边界。这里仅做确定性归一和结构检查；
 * 设备、安装、运行、视觉等 policy gate 仍由原有 testing/adhoc driver 判定。
 */
export function normalizeDeviceTestCases(input: DeviceCaseInput): DeviceCaseNormalization {
  let cases: NormalizedDeviceTestCase[];
  if (input.mode === 'adhoc') {
    const steps = splitNaturalLanguageSteps(input.natural_language);
    cases = steps.length === 0
      ? []
      : [{
          id: 'TC-001',
          name: 'adhoc flow',
          priority: 'P0',
          source_ref: 'ad-hoc',
          steps,
          expected: '',
        }];
  } else {
    const deviceScope = collectDeviceScopeP0P1(input.acceptance);
    const criteriaIds = new Set(deviceScope.criteria.map((item) => item.id));
    const boundaryIds = new Set(deviceScope.boundaries.map((item) => item.id));
    const criteria = (input.acceptance.criteria ?? [])
      .filter((criterion) => criteriaIds.has(criterion.id))
      .map((criterion, index): NormalizedDeviceTestCase => ({
        id: `TC-AC-${String(index + 1).padStart(3, '0')}`,
        name: criterion.description,
        priority: criterion.priority.trim().toUpperCase(),
        source_ref: criterion.id,
        steps: criterion.verification_steps?.filter(Boolean) ?? [],
        expected: criterion.expected_result,
      }));
    const boundaries = (input.acceptance.boundaries ?? [])
      .filter((boundary) => boundaryIds.has(boundary.id))
      .map((boundary, index): NormalizedDeviceTestCase => ({
        id: `TC-BD-${String(index + 1).padStart(3, '0')}`,
        name: boundary.description,
        priority: boundary.priority?.trim().toUpperCase() || 'P1',
        source_ref: boundary.id,
        steps: [boundary.scenario, boundary.handling].filter(Boolean),
        expected: boundary.expected_behavior,
      }));
    cases = [...criteria, ...boundaries];
  }

  return {
    schema_version: '1.0',
    mode: input.mode,
    depth: input.mode === 'acceptance' ? 'full' : 'adhoc',
    cases,
    issues: validateCases(input.mode, cases),
  };
}
