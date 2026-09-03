import * as fs from 'fs';
import * as path from 'path';

import type {
  CheckResult,
  ExtensionBundle,
  ExtensionMcpAction,
  ExtensionPhaseBindingSlot,
} from './types';
import {
  checkCanonicalComponentBlueprint,
  checkHostSeamMaterials,
  checkMaterializationOnly,
} from '../check-component-blueprint';
import { MATERIALIZATION_ARTIFACT, REVIEW_FEEDBACK_ARTIFACT } from './blueprint-host-seams';

function rel(projectRoot: string, target: string): string {
  return path.relative(projectRoot, target).replace(/\\/g, '/');
}

export function formatExtensionPhasePrompt(
  bundle: ExtensionBundle | undefined,
  phase: string,
  projectRoot: string,
): string {
  if (!bundle || bundle.manifestVersion !== '1.1' || bundle.errors.length > 0 || !bundle.featurePhases.includes(phase)) return '';
  const knowledge = bundle.knowledge.filter(item => item.legacy
    || (Array.isArray(item.audience) && item.audience.includes(phase)));
  const slots = bundle.phaseBindings[phase] ?? {};
  if (knowledge.length === 0 && Object.keys(slots).length === 0) return '';
  const lines = ['## Instance extension inputs', ''];
  if (knowledge.length > 0) {
    lines.push('### Knowledge index', '');
    for (const item of knowledge) {
      lines.push('- `' + rel(projectRoot, item.absPath) + '`' + (item.summary ? ` — ${item.summary}` : ''));
    }
    lines.push('');
  }
  for (const slot of ['before_phase_work', 'before_phase_verify', 'after_phase_verify_before_close'] as const) {
    const items = slots[slot];
    if (!items?.length) continue;
    lines.push(`### ${slot}`, '');
    for (const item of items) {
      const action = item.kind === 'mcp' ? bundle.mcpActions[item.ref] : undefined;
      lines.push(action
        ? '- mcp `' + item.ref + '` → tool `' + action.tool + '`; ' + action.usage
          + '; produces: ' + action.produces.map(value => '`' + value + '`').join(', ')
        : `- ${item.kind} ` + '`' + item.ref + '`');
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export function checkExtensionManifest(bundle: ExtensionBundle | undefined): CheckResult[] {
  if (!bundle || bundle.errors.length === 0) return [];
  return bundle.errors.map((error, index) => ({
    id: `extension_manifest_${error.code}_${index}`,
    category: 'structure',
    description: `实例扩展 manifest/路径合法：${error.code}`,
    severity: 'BLOCKER',
    status: 'FAIL',
    details: [error.message, error.path ?? '', bundle.manifestPath ?? ''].filter(Boolean).join('\n'),
    suggestion: '运行 /extension inspect，修复同一 manifest 诊断后重跑当前 phase。',
  }));
}

export function inspectExtensionProduce(
  projectRoot: string,
  target: string,
): { seam: string | null; issues: Array<{ id: string; message: string }> } {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return { seam: null, issues: [] };
  }
  const artifact = value && typeof value === 'object' && !Array.isArray(value)
    ? String((value as Record<string, unknown>).artifact ?? '')
    : '';
  if (artifact === MATERIALIZATION_ARTIFACT) {
    const blueprintId = String((value as Record<string, unknown>).blueprint_id ?? '');
    return {
      seam: 'requirement-source-materialization',
      issues: checkMaterializationOnly(projectRoot, blueprintId, target).issues
        .filter(item => item.severity === 'BLOCKER')
        .map(item => ({ id: item.id, message: item.message })),
    };
  }
  if (artifact === REVIEW_FEEDBACK_ARTIFACT) {
    try {
      const blueprintId = String((value as Record<string, unknown>).blueprint_id ?? '');
      const loaded = checkCanonicalComponentBlueprint(projectRoot, blueprintId);
      const seam = checkHostSeamMaterials(projectRoot, loaded, { feedback: target });
      return {
        seam: 'blueprint-review-feedback',
        issues: [...loaded.issues, ...seam.issues]
          .filter(item => item.severity === 'BLOCKER')
          .map(item => ({ id: item.id, message: item.message })),
      };
    } catch (error) {
      return { seam: 'blueprint-review-feedback', issues: [{ id: 'component_blueprint_check_failed', message: (error as Error).message }] };
    }
  }
  return { seam: null, issues: [] };
}

function actionProduceChecks(
  action: ExtensionMcpAction,
  projectRoot: string,
  phase: string,
  slot: ExtensionPhaseBindingSlot,
): CheckResult[] {
  const results: CheckResult[] = [];
  for (let index = 0; index < action.produceAbsPaths.length; index++) {
    const target = action.produceAbsPaths[index]!;
    const targetRel = action.produces[index]!;
    const id = `extension_produces_${phase}_${slot}_${action.id}_${index}`;
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      results.push({
        id, category: 'structure', description: `extension action ${action.id} 产物存在`,
        severity: action.required ? action.severity : 'MINOR',
        status: action.required ? 'FAIL' : 'SKIP',
        details: `missing=${targetRel}; required=${action.required}`,
        suggestion: `按 manifest usage 调用宿主工具 ${action.tool} 并生成 ${targetRel}。`,
      });
      continue;
    }
    const m7 = inspectExtensionProduce(projectRoot, target);
    if (m7.issues.length > 0) {
      results.push({
        id, category: 'structure', description: `extension action ${action.id} 的 ${m7.seam} 产物通过既有接缝校验`,
        severity: 'BLOCKER', status: 'FAIL',
        details: `${targetRel}\n${m7.issues.map(issue => `${issue.id}: ${issue.message}`).join('\n')}`,
        suggestion: '按 check:component-blueprint 的既有诊断修正接缝文件。',
      });
      continue;
    }
    results.push({
      id, category: 'structure',
      description: `extension action ${action.id} 产物可用${m7.seam ? `（${m7.seam}）` : ''}`,
      severity: 'MINOR', status: 'PASS', details: targetRel,
    });
  }
  return results;
}

export function checkExtensionBindingProduces(args: {
  bundle: ExtensionBundle | undefined;
  projectRoot: string;
  phase: string;
  slot: ExtensionPhaseBindingSlot;
}): CheckResult[] {
  const { bundle, projectRoot, phase, slot } = args;
  if (!bundle || bundle.manifestVersion !== '1.1' || bundle.errors.length > 0) return [];
  const bindings = bundle.phaseBindings[phase]?.[slot] ?? [];
  return bindings.flatMap(binding => {
    if (binding.kind !== 'mcp') return [];
    const action = bundle.mcpActions[binding.ref];
    return action ? actionProduceChecks(action, projectRoot, phase, slot) : [];
  });
}
