import * as path from 'path';
import * as fs from 'fs';
import { loadFrameworkConfig } from '../../config';
import { loadInstanceExtensions } from '../../extension-loader';
import { isInsideProjectRoot } from './project-relative-path';

import type {
  CheckResult,
  ExtensionBundle,
  ExtensionBinding,
} from './types';
import {
  checkCanonicalComponentBlueprint,
  checkHostSeamMaterials,
  checkMaterializationOnly,
} from '../check-component-blueprint';
import { MATERIALIZATION_ARTIFACT, REVIEW_FEEDBACK_ARTIFACT } from './blueprint-host-seams';
import { ExtensionWriteBusyError, pendingExtensionUpgrades, prepareExtensionPlugins, withExtensionWrite } from './extension-lifecycle';
import { FEATURE_AUTHOR_AT, FEATURE_VERIFY_AT, FEATURE_CLOSE_AT, extensionResourceSha256 } from './knowledge-context';

type ExtensionUse = 'author' | 'check' | 'close' | 'standalone';

export function preparePhaseExtensionInputs(
  projectRoot: string, frameworkRoot: string, phases: readonly string[], use: ExtensionUse,
): ExtensionBundle {
  const timings = use === 'author' ? [FEATURE_AUTHOR_AT] : use === 'close' ? [FEATURE_CLOSE_AT]
    : use === 'check' ? [FEATURE_AUTHOR_AT, FEATURE_VERIFY_AT, FEATURE_CLOSE_AT] : [];
  const prepared = prepareExtensionPlugins(projectRoot, frameworkRoot, bundle => {
    const selected = new Set(bundle.bindings.filter(binding => binding.selected && !binding.issue
      && binding.phase && phases.includes(binding.phase)
      && (timings.includes(binding.at) || use === 'check' && binding.hookEvent && !binding.reason?.includes('lifecycle_hooks_enabled')))
      .map(binding => binding.ability));
    for (const plugin of Object.values(bundle.plugins)) {
      if (!plugin.enabled) continue;
      if (phases.some(phase =>
        (use === 'check' || use === 'standalone') && plugin.phaseRuleOverlayPaths[phase] !== undefined
        || phase === 'ut' && use !== 'close' && plugin.skillAssetAbsPaths['business-ut'] !== undefined
        || phase === 'docs' && use === 'check' && Object.keys(plugin.skillAssetAbsPaths).length > 0
        || use !== 'author' && Object.keys(plugin.capabilities).some(key => (key.startsWith(phase + '.') || phase === 'testing' && key.startsWith('device_test.'))))) {
        selected.add(plugin.id);
      }
    }
    return selected;
  });
  for (const entry of prepared.cleaned) console.warn(`[extension] ${entry.path}：${entry.reason}`);
  return prepared.bundle;
}

export function phaseExtensionMaterialFiles(bundle: ExtensionBundle | undefined, projectRoot: string, phase: string): string[] {
  if (!bundle?.manifestUsable) return [];
  const files = new Set<string>();
  const add = (ability: string, ...resources: Array<string | undefined>) => {
    for (const file of [bundle.manifestPath, bundle.plugins[ability]?.manifestPath, ...resources]) {
      if (file) files.add(path.relative(projectRoot, file).replace(/\\/g, '/'));
    }
  };
  for (const binding of bundle.bindings) {
    if (binding.enabled && binding.phase === phase) add(binding.ability, binding.absPath, ...binding.action?.produceAbsPaths ?? []);
  }
  for (const plugin of Object.values(bundle.plugins)) {
    const overlay = plugin.phaseRuleOverlayPaths[phase];
    if (overlay && bundle.phaseRuleOverlayPaths[phase] === overlay) add(plugin.id, overlay);
  }
  return [...files].sort();
}

type VerifierFile = { path: string; sha256: string | null };

function extensionVerifierFiles(projectRoot: string, files: readonly VerifierFile[]): VerifierFile[] {
  const relative = loadFrameworkConfig(projectRoot).paths.extension_dir ?? 'doc/extensions';
  const root = path.resolve(projectRoot, relative);
  return files.filter(file => isInsideProjectRoot(root, path.resolve(projectRoot, file.path)));
}

export function currentExtensionVerifierMaterial(
  projectRoot: string, frameworkRoot: string, files: readonly VerifierFile[],
): boolean {
  const used = extensionVerifierFiles(projectRoot, files);
  if (!used.length) return true;
  const view = loadInstanceExtensions(projectRoot, undefined, { frameworkRoot });
  const pending = pendingExtensionUpgrades(view);
  return view.manifestUsable && used.every(file => {
    const absolute = path.resolve(projectRoot, file.path);
    return ![...pending.keys()].some(id => isInsideProjectRoot(view.plugins[id].rootDir, absolute))
      && (extensionResourceSha256(absolute) ?? null) === file.sha256;
  });
}

export function issueWithExtensionVerifierMaterial<T>(
  projectRoot: string, frameworkRoot: string, files: readonly VerifierFile[], issue: () => T,
): T | null {
  if (!extensionVerifierFiles(projectRoot, files).length) return issue();
  try {
    return withExtensionWrite(projectRoot, frameworkRoot, () => {
      if (currentExtensionVerifierMaterial(projectRoot, frameworkRoot, files)) return issue();
      console.warn('[verifier-request] 参与的扩展材料已变化，请重跑当前检查。');
      return null;
    });
  } catch (error) {
    if (!(error instanceof ExtensionWriteBusyError)) throw error;
    console.warn('[verifier-request] ' + error.message);
    return null;
  }
}

export function checkExtensionManifest(bundle: ExtensionBundle | undefined): CheckResult[] {
  if (!bundle) return [];
  if (bundle.manifestUsable) return bundle.errors.filter(error => error.code === 'plugin_unavailable').map(error => ({
    id: `extension_prepare_${error.ability}`, category: 'structure', description: error.message,
    severity: 'MINOR', status: 'WARN', details: [error.path, error.message].filter(Boolean).join(' · '),
  }));
  if (bundle.errors.every(error => error.code === 'manifest_legacy_layout')) return bundle.errors.map(error => ({
    id: 'extension_legacy_layout',
    category: 'structure', description: error.message, severity: 'MINOR', status: 'WARN',
    details: [error.path, error.message].filter(Boolean).join(' · '),
  }));
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
  binding: ExtensionBinding,
  projectRoot: string,
): CheckResult[] {
  const results: CheckResult[] = [];
  const action = binding.action!;
  for (let index = 0; index < action.produceAbsPaths.length; index++) {
    const target = action.produceAbsPaths[index]!;
    const targetRel = action.produces[index]!;
    const id = `extension_produces_${binding.phase}_${binding.at.split('@')[0].split('.').pop()}_${binding.ability}_${binding.id}_${index}`;
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      results.push({
        id, category: 'structure', description: `extension action ${binding.ability}/${action.id} 产物存在`,
        severity: binding.required ? binding.severity ?? 'MAJOR' : 'MINOR',
        status: binding.required ? 'FAIL' : 'SKIP',
        details: `missing=${targetRel}; required=${!!binding.required}`,
        suggestion: `按 manifest usage 调用宿主工具 ${action.tool} 并生成 ${targetRel}。`,
      });
      continue;
    }
    const m7 = inspectExtensionProduce(projectRoot, target);
    if (m7.issues.length > 0) {
      results.push({
        id, category: 'structure', description: `extension action ${binding.ability}/${action.id} 的 ${m7.seam} 产物通过既有接缝校验`,
        severity: 'BLOCKER', status: 'FAIL',
        details: `${targetRel}\n${m7.issues.map(issue => `${issue.id}: ${issue.message}`).join('\n')}`,
        suggestion: '按 check:component-blueprint 的既有诊断修正接缝文件。',
      });
      continue;
    }
    results.push({
      id, category: 'structure',
      description: `extension action ${binding.ability}/${action.id} 产物可用${m7.seam ? `（${m7.seam}）` : ''}`,
      severity: 'MINOR', status: 'PASS', details: targetRel,
    });
  }
  return results;
}

export function checkExtensionBindingProduces(args: {
  bundle: ExtensionBundle | undefined;
  projectRoot: string;
  phase: string;
  at: string;
}): CheckResult[] {
  const { bundle, projectRoot, phase, at } = args;
  if (!bundle || !bundle.manifestUsable) return [];
  const candidates = bundle.bindings.filter(binding => binding.phase === phase && binding.at === at);
  const unavailable = bundle.bindings.filter(binding => binding.phase === phase && binding.selected && binding.required && !binding.enabled
    && (binding.at === at || at === FEATURE_AUTHOR_AT && binding.at.startsWith('harness.') && !binding.reason?.includes('lifecycle_hooks_enabled')));
  const checks: CheckResult[] = unavailable.map(binding => ({
    id: `extension_required_binding_${binding.ability}_${binding.id}`,
    category: 'structure', description: `实例扩展所需绑定 ${binding.ability}/${binding.id} 可用`,
    severity: binding.severity ?? 'MAJOR', status: 'FAIL',
    details: `${binding.source} · ${binding.at} · ${binding.ref}: ${binding.reason}`,
    suggestion: '运行 /extension inspect 查看此绑定的缺口。',
  }));
  for (const binding of candidates) {
    if (binding.enabled && binding.action) checks.push(...actionProduceChecks(binding, projectRoot));
  }
  return checks;
}
