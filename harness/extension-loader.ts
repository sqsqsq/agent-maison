// ============================================================================
// Instance extension loader — doc/extensions/manifest.yaml
// ============================================================================
//
// 无 manifest / 无目录 → 空 bundle（零副作用）。
// manifest 存在但校验失败 → errors[] 非空且不应用 provides（零污染）。
//
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import type {
  HarnessResolvedProfile,
  ProfileCapabilitySpec,
  CapabilitySeverityKeyword,
  ExtensionBundle,
  ExtensionKnowledgeEntry,
  ExtensionMcpAction,
  ExtensionPhaseBinding,
  ExtensionPhaseBindingSlot,
} from './scripts/utils/types';
import { normalizeCapabilityKey, normalizeCapabilitiesMap } from './scripts/utils/capability-alias';
import { normalizePhaseId } from './scripts/utils/phase-alias';
import { validateProjectRelativePath } from './scripts/utils/project-relative-path';
import { resolveWorkflowSpec } from './workflow-loader';
import { workflowFeaturePhases } from './scripts/utils/runtime-policy';

export type { ExtensionBundle } from './scripts/utils/types';

const SEVERITY_SET = new Set<CapabilitySeverityKeyword>(['BLOCKER', 'SKIP', 'WARN', 'MAJOR', 'MINOR']);
const ACTION_SEVERITY_SET = new Set(['MAJOR', 'BLOCKER']);
const BINDING_SLOTS = new Set<ExtensionPhaseBindingSlot>([
  'before_phase_work', 'before_phase_verify', 'after_phase_verify_before_close',
]);
const SAFE_ID = /^[a-z][a-z0-9_-]*$/;

function emptyBundle(rootDir: string | null): ExtensionBundle {
  return {
    rootDir,
    manifestPath: null,
    manifestVersion: null,
    featurePhases: [],
    skills: [],
    knowledgePaths: [],
    knowledge: [],
    mcpActions: {},
    phaseBindings: {},
    hooks: {},
    extensionCapabilities: {},
    phaseRuleOverlayPaths: {},
    skillAssetAbsPaths: {},
    errors: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeResolve(extRoot: string, rel: string): string {
  return path.resolve(extRoot, validateProjectRelativePath(extRoot, rel.trim().replace(/^\.\/+/, ''), 'extension 引用'));
}

function safeResolveProject(projectRoot: string, rel: string): string {
  return path.resolve(projectRoot, validateProjectRelativePath(projectRoot, rel, 'mcp_actions.produces'));
}

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  const set = new Set(allowed);
  return Object.keys(value).filter(key => !set.has(key));
}

function pushError(bundle: ExtensionBundle, code: string, message: string, p?: string): void {
  bundle.errors.push({ severity: 'MAJOR', code, message, path: p });
}

function wipeProvides(b: ExtensionBundle): void {
  b.skills = [];
  b.knowledgePaths = [];
  b.knowledge = [];
  b.mcpActions = {};
  b.phaseBindings = {};
  b.hooks = {};
  b.extensionCapabilities = {};
  b.phaseRuleOverlayPaths = {};
  b.skillAssetAbsPaths = {};
}

function finalize(bundle: ExtensionBundle): ExtensionBundle {
  if (bundle.errors.length > 0) {
    wipeProvides(bundle);
  }
  return bundle;
}

/**
 * 扫描实例 extension 目录；manifest 缺失时返回空 bundle。
 */
export function loadInstanceExtensions(
  projectRoot: string,
  extensionDirRel?: string,
  options?: { frameworkRoot?: string },
): ExtensionBundle {
  let rel: string;
  try {
    rel = validateProjectRelativePath(projectRoot, extensionDirRel ?? 'doc/extensions', 'paths.extension_dir');
  } catch (error) {
    const invalid = emptyBundle(null);
    pushError(invalid, 'extension_dir_path', (error as Error).message);
    return invalid;
  }
  const extRoot = path.join(projectRoot, ...rel.split('/').filter(Boolean));

  if (!fs.existsSync(extRoot) || !fs.statSync(extRoot).isDirectory()) {
    return emptyBundle(null);
  }

  const manifestPath = path.join(extRoot, 'manifest.yaml');
  if (!fs.existsSync(manifestPath)) {
    const b = emptyBundle(extRoot);
    return finalize(b);
  }

  const bundle = emptyBundle(extRoot);
  bundle.manifestPath = manifestPath;

  let raw: unknown;
  try {
    raw = YAML.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (e) {
    pushError(bundle, 'manifest_yaml_parse', `无法解析 YAML：${(e as Error).message}`, manifestPath);
    return finalize(bundle);
  }

  if (!isRecord(raw)) {
    pushError(bundle, 'manifest_not_object', 'manifest 根必须是 object', manifestPath);
    return finalize(bundle);
  }

  const sv = raw.schema_version;
  const schemaVersion = typeof sv === 'string' ? sv.trim() : '';
  if (!schemaVersion) {
    pushError(bundle, 'manifest_schema_version', '缺少或非法 schema_version（须为非空字符串）', manifestPath);
  } else if (schemaVersion !== '1.0' && schemaVersion !== '1.1') {
    pushError(
      bundle,
      'manifest_schema_version_unsupported',
      `不支持的 schema_version="${schemaVersion}"（当前支持 1.0 / 1.1）`,
      manifestPath,
    );
  }

  const name = raw.name;
  if (typeof name !== 'string' || !name.trim()) {
    pushError(bundle, 'manifest_name', 'name 必须为非空字符串', manifestPath);
  } else if (schemaVersion === '1.1' && !SAFE_ID.test(name.trim())) {
    pushError(bundle, 'manifest_name', 'manifest 1.1 name 必须是小写 slug', manifestPath);
  }

  if (bundle.errors.length > 0) {
    return finalize(bundle);
  }
  bundle.manifestVersion = schemaVersion as '1.0' | '1.1';
  const is11 = bundle.manifestVersion === '1.1';
  let featurePhases = new Set<string>();
  if (is11) {
    try {
      const workflow = resolveWorkflowSpec(projectRoot, {
        frameworkRoot: options?.frameworkRoot ?? path.resolve(__dirname, '..'),
      });
      featurePhases = new Set([
        ...workflowFeaturePhases(workflow, 'full'),
        ...workflowFeaturePhases(workflow, 'lite'),
      ]);
      bundle.featurePhases = [...featurePhases].sort();
    } catch (error) {
      pushError(bundle, 'manifest_workflow_unresolvable', (error as Error).message, manifestPath);
    }
  }
  if (is11) {
    for (const key of unknownKeys(raw, ['schema_version', 'name', 'version', 'description', 'framework_compat', 'provides', 'phase_bindings'])) {
      pushError(bundle, 'manifest_unknown_field', `manifest 1.1 不支持字段：${key}`, manifestPath);
    }
  }

  const provides = raw.provides === undefined && is11 ? {} : raw.provides;
  if (provides === undefined || provides === null) {
    if (is11 && provides === null) pushError(bundle, 'provides_not_object', 'manifest 1.1 provides 必须是 object', manifestPath);
    return finalize(bundle);
  }
  if (!isRecord(provides)) {
    pushError(bundle, 'provides_not_object', 'provides 必须是 object', manifestPath);
    return finalize(bundle);
  }
  if (is11) {
    for (const key of unknownKeys(provides, ['skills', 'knowledge', 'hooks', 'capabilities', 'skill_assets', 'phase_rules_overlays', 'mcp_actions'])) {
      pushError(bundle, 'provides_unknown_field', `manifest 1.1 provides 不支持字段：${key}`, manifestPath);
    }
  }

  const skillsRaw = provides.skills;
  if (skillsRaw !== undefined) {
    if (!Array.isArray(skillsRaw)) {
      pushError(bundle, 'provides_skills', 'provides.skills 必须是字符串数组', manifestPath);
    } else {
      for (const s of skillsRaw) {
        if (typeof s !== 'string' || !s.trim()) {
          pushError(bundle, 'provides_skills_item', `非法 skill id：${String(s)}`, manifestPath);
        } else if (!is11 || SAFE_ID.test(s.trim())) {
          const id = s.trim();
          bundle.skills.push(id);
          if (is11) {
            const skillPath = safeResolve(extRoot, `skills/${id}/SKILL.md`);
            if (!fs.existsSync(skillPath) || !fs.statSync(skillPath).isFile()) {
              pushError(bundle, 'skill_missing', `manifest skill 缺少 skills/${id}/SKILL.md`, skillPath);
            }
          }
        } else {
          pushError(bundle, 'provides_skills_item', `manifest 1.1 skill id 非法：${s.trim()}`, manifestPath);
        }
      }
    }
  }

  const knowRaw = provides.knowledge;
  if (knowRaw !== undefined) {
    if (!Array.isArray(knowRaw)) {
      pushError(bundle, 'provides_knowledge', 'provides.knowledge 必须是数组', manifestPath);
    } else {
      for (const k of knowRaw) {
        let entry: ExtensionKnowledgeEntry | null = null;
        if (typeof k === 'string' && k.trim()) {
          const itemPath = k.trim();
          entry = {
            path: itemPath,
            absPath: '',
            summary: '',
            audience: is11 ? [] : [],
            legacy: true,
          };
        } else if (is11 && isRecord(k)) {
          const extra = unknownKeys(k, ['path', 'summary', 'audience']);
          if (extra.length > 0) {
            pushError(bundle, 'knowledge_unknown_field', `knowledge 条目不支持字段：${extra.join(', ')}`, manifestPath);
            continue;
          }
          const itemPath = typeof k.path === 'string' ? k.path.trim() : '';
          const summary = typeof k.summary === 'string' ? k.summary.trim() : '';
          const audienceRaw = k.audience;
          let audience: 'global' | string[] | null = null;
          if (audienceRaw === 'global') audience = 'global';
          else if (Array.isArray(audienceRaw) && audienceRaw.length > 0 && audienceRaw.every(item =>
            typeof item === 'string' && featurePhases.has(item))) {
            audience = [...new Set(audienceRaw as string[])];
          }
          if (!itemPath || !summary || audience === null) {
            pushError(bundle, 'provides_knowledge_item', 'knowledge 对象须含 path/summary 与 audience: global|Feature phase[]', manifestPath);
            continue;
          }
          entry = { path: itemPath, absPath: '', summary, audience, legacy: false };
        } else {
          pushError(bundle, 'provides_knowledge_item', `非法 knowledge 项：${String(k)}`, manifestPath);
          continue;
        }
        try {
          const abs = safeResolve(extRoot, entry.path);
          if (!fs.existsSync(abs) || (is11 && !fs.statSync(abs).isFile())) {
            pushError(bundle, 'knowledge_missing', `knowledge 文件不存在：${entry.path}`, abs);
          } else {
            bundle.knowledgePaths.push(abs);
            bundle.knowledge.push({ ...entry, absPath: abs });
          }
        } catch (e) {
          pushError(bundle, 'knowledge_resolve', (e as Error).message, manifestPath);
        }
      }
    }
  }

  if (is11 && provides.mcp_actions !== undefined) {
    if (!isRecord(provides.mcp_actions)) {
      pushError(bundle, 'provides_mcp_actions', 'provides.mcp_actions 必须是 object', manifestPath);
    } else for (const [id, value] of Object.entries(provides.mcp_actions)) {
      if (!SAFE_ID.test(id) || !isRecord(value)) {
        pushError(bundle, 'mcp_action_shape', `mcp action 非法：${id}`, manifestPath);
        continue;
      }
      const extra = unknownKeys(value, ['tool', 'required', 'severity', 'produces', 'usage']);
      if (extra.length > 0) {
        pushError(bundle, 'mcp_action_forbidden_field', `mcp_actions.${id} 不支持字段：${extra.join(', ')}`, manifestPath);
        continue;
      }
      const tool = typeof value.tool === 'string' ? value.tool.trim() : '';
      const usage = typeof value.usage === 'string' ? value.usage.trim() : '';
      const required = value.required;
      const severity = value.severity ?? 'MAJOR';
      const produces = Array.isArray(value.produces)
        ? value.produces.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
        : [];
      if (!tool || !usage || typeof required !== 'boolean' || produces.length === 0 || produces.length !== (value.produces as unknown[] | undefined)?.length || !ACTION_SEVERITY_SET.has(String(severity))) {
        pushError(bundle, 'mcp_action_shape', `mcp_actions.${id} 须含 tool/required/produces/usage，severity 仅 MAJOR|BLOCKER`, manifestPath);
        continue;
      }
      try {
        const action: ExtensionMcpAction = {
          id, tool, usage, required, severity: severity as 'MAJOR' | 'BLOCKER', produces,
          produceAbsPaths: produces.map(item => safeResolveProject(projectRoot, item)),
        };
        bundle.mcpActions[id] = action;
      } catch (error) {
        pushError(bundle, 'mcp_action_produces_path', (error as Error).message, manifestPath);
      }
    }
  }

  if (is11 && raw.phase_bindings !== undefined) {
    if (!isRecord(raw.phase_bindings)) {
      pushError(bundle, 'phase_bindings_shape', 'phase_bindings 必须是 Feature phase -> slot 映射', manifestPath);
    } else for (const [phase, slotsRaw] of Object.entries(raw.phase_bindings)) {
      if (!featurePhases.has(phase) || !isRecord(slotsRaw)) {
        pushError(bundle, 'phase_binding_phase', `phase_bindings 仅接受 Feature phase：${phase}`, manifestPath);
        continue;
      }
      for (const slot of Object.keys(slotsRaw)) {
        if (!BINDING_SLOTS.has(slot as ExtensionPhaseBindingSlot)) {
          pushError(bundle, 'phase_binding_slot', `不支持 phase_bindings.${phase}.${slot}`, manifestPath);
        }
      }
      const parsed: Partial<Record<ExtensionPhaseBindingSlot, ExtensionPhaseBinding[]>> = {};
      for (const slot of BINDING_SLOTS) {
        const list = slotsRaw[slot];
        if (list === undefined) continue;
        if (!Array.isArray(list)) {
          pushError(bundle, 'phase_binding_items', `phase_bindings.${phase}.${slot} 必须是数组`, manifestPath);
          continue;
        }
        const items: ExtensionPhaseBinding[] = [];
        for (const value of list) {
          if (!isRecord(value) || unknownKeys(value, ['kind', 'ref']).length > 0
            || !['knowledge', 'skill', 'mcp'].includes(String(value.kind))
            || typeof value.ref !== 'string' || !value.ref.trim()) {
            pushError(bundle, 'phase_binding_item', `phase_bindings.${phase}.${slot} 条目须为 {kind,ref}`, manifestPath);
            continue;
          }
          items.push({ kind: value.kind as ExtensionPhaseBinding['kind'], ref: value.ref.trim() });
        }
        if (items.length > 0) parsed[slot] = items;
      }
      bundle.phaseBindings[phase] = parsed;
    }
    const knowledgeRefs = new Set(bundle.knowledge.map(item => item.path));
    for (const [phase, slots] of Object.entries(bundle.phaseBindings)) for (const [slot, items] of Object.entries(slots)) {
      for (const item of items ?? []) {
        const exists = item.kind === 'mcp'
          ? Boolean(bundle.mcpActions[item.ref])
          : item.kind === 'skill'
            ? bundle.skills.includes(item.ref)
            : knowledgeRefs.has(item.ref);
        if (!exists) pushError(bundle, 'phase_binding_ref_missing', `phase_bindings.${phase}.${slot} 引用不存在：${item.kind}:${item.ref}`, manifestPath);
      }
    }
  }

  const hooksRaw = provides.hooks;
  if (hooksRaw !== undefined) {
    if (!isRecord(hooksRaw)) {
      pushError(bundle, 'provides_hooks', 'provides.hooks 必须是 object', manifestPath);
    } else {
      for (const [ph, evMap] of Object.entries(hooksRaw)) {
        if (!isRecord(evMap)) {
          pushError(bundle, 'provides_hooks_phase', `hooks.${ph} 必须是 event->paths 映射`, manifestPath);
          continue;
        }
        const byEvent: Record<string, string[]> = {};
        for (const [ev, pathsList] of Object.entries(evMap)) {
          if (!Array.isArray(pathsList)) {
            pushError(bundle, 'provides_hooks_event', `hooks.${ph}.${ev} 必须是路径数组`, manifestPath);
            continue;
          }
          const acc: string[] = [];
          for (const hp of pathsList) {
            if (typeof hp !== 'string' || !hp.trim()) {
              pushError(bundle, 'provides_hooks_path', `非法 hook 路径：${String(hp)}`, manifestPath);
              continue;
            }
            try {
              const abs = safeResolve(extRoot, hp.trim());
              if (!fs.existsSync(abs)) {
                pushError(bundle, 'hook_path_missing', `hook 文件不存在：${hp.trim()}`, abs);
              } else {
                acc.push(abs);
              }
            } catch (e) {
              pushError(bundle, 'hook_resolve', (e as Error).message, manifestPath);
            }
          }
          if (acc.length > 0) {
            byEvent[ev] = acc;
          }
        }
        if (Object.keys(byEvent).length > 0) {
          const canon = normalizePhaseId(ph, ph as 'spec');
          if (ph !== canon) {
            // eslint-disable-next-line no-console
            console.warn(
              `[extension-loader] hooks 已弃用 phase key "${ph}"，已规范化为 "${canon}"`,
            );
          }
          bundle.hooks[canon] = { ...(bundle.hooks[canon] ?? {}), ...byEvent };
        }
      }
    }
  }

  const capsRaw = provides.capabilities;
  if (capsRaw !== undefined) {
    if (!isRecord(capsRaw)) {
      pushError(bundle, 'provides_capabilities', 'provides.capabilities 必须是 object', manifestPath);
    } else {
      for (const [capKey, spec] of Object.entries(capsRaw)) {
        if (!capKey.trim()) continue;
        if (!isRecord(spec)) {
          pushError(bundle, 'capability_spec', `capability "${capKey}" 必须是 object`, manifestPath);
          continue;
        }
        const prov = spec.provider;
        const sev = spec.severity;
        if (typeof prov !== 'string' || !prov.trim()) {
          pushError(bundle, 'capability_provider', `capability "${capKey}" 缺少 provider`, manifestPath);
          continue;
        }
        if (typeof sev !== 'string' || !SEVERITY_SET.has(sev as CapabilitySeverityKeyword)) {
          pushError(
            bundle,
            'capability_severity',
            `capability "${capKey}" severity 非法：${String(sev)}`,
            manifestPath,
          );
          continue;
        }
        try {
          const absProv = safeResolve(extRoot, prov.trim());
          if (!fs.existsSync(absProv)) {
            pushError(bundle, 'capability_provider_missing', `provider 文件不存在：${prov.trim()}`, absProv);
            continue;
          }
          const canonKey = normalizeCapabilityKey(capKey.trim());
          bundle.extensionCapabilities[canonKey] = {
            provider: absProv,
            severity: sev as CapabilitySeverityKeyword,
          };
        } catch (e) {
          pushError(bundle, 'capability_resolve', (e as Error).message, manifestPath);
        }
      }
    }
  }

  const skillAssetsRaw = provides.skill_assets;
  if (skillAssetsRaw !== undefined) {
    if (!isRecord(skillAssetsRaw)) {
      pushError(bundle, 'provides_skill_assets', 'provides.skill_assets 必须是 object', manifestPath);
    } else {
      for (const [skillId, bucket] of Object.entries(skillAssetsRaw)) {
        const sid = skillId.trim();
        if (!sid) {
          pushError(bundle, 'skill_assets_skill_id', 'skill_assets skill id 不能为空', manifestPath);
          continue;
        }
        if (!isRecord(bucket)) {
          pushError(bundle, 'skill_assets_bucket', `skill_assets.${sid} 必须是 assetKey→path 映射`, manifestPath);
          continue;
        }
        const acc: Record<string, string> = {};
        for (const [assetKey, rel] of Object.entries(bucket)) {
          const key = assetKey.trim();
          if (!key || typeof rel !== 'string' || !rel.trim()) {
            pushError(bundle, 'skill_assets_entry', `skill_assets.${sid}.${assetKey} 非法`, manifestPath);
            continue;
          }
          try {
            const abs = safeResolve(extRoot, rel.trim());
            if (!fs.existsSync(abs)) {
              pushError(bundle, 'skill_assets_missing', `skill_assets 文件不存在：${rel.trim()}`, abs);
            } else {
              acc[key] = abs;
            }
          } catch (e) {
            pushError(bundle, 'skill_assets_resolve', (e as Error).message, manifestPath);
          }
        }
        if (Object.keys(acc).length > 0) {
          bundle.skillAssetAbsPaths[sid] = { ...(bundle.skillAssetAbsPaths[sid] ?? {}), ...acc };
        }
      }
    }
  }

  const overRaw = provides.phase_rules_overlays;
  if (overRaw !== undefined) {
    if (!isRecord(overRaw)) {
      pushError(bundle, 'provides_overlays', 'provides.phase_rules_overlays 必须是 object', manifestPath);
    } else {
      for (const [ph, p] of Object.entries(overRaw)) {
        if (typeof p !== 'string' || !p.trim()) {
          pushError(bundle, 'overlay_path', `phase "${ph}" overlay 路径非法`, manifestPath);
          continue;
        }
        try {
          const abs = safeResolve(extRoot, p.trim());
          if (!fs.existsSync(abs)) {
            pushError(bundle, 'overlay_missing', `phase_rules_overlay 文件不存在：${p.trim()}`, abs);
          } else {
            const rawPh = ph.trim();
            const canon = normalizePhaseId(rawPh, rawPh as 'spec');
            if (rawPh !== canon) {
              // eslint-disable-next-line no-console
              console.warn(
                `[extension-loader] phase_rules_overlays 已弃用 phase key "${rawPh}"，已规范化为 "${canon}"`,
              );
            }
            bundle.phaseRuleOverlayPaths[canon] = abs;
          }
        } catch (e) {
          pushError(bundle, 'overlay_resolve', (e as Error).message, manifestPath);
        }
      }
    }
  }

  return finalize(bundle);
}

/** undefined=无 manifest/合法 1.0 目录驱动；数组=1.1 严格清单或非法 manifest 的空选择。 */
export function extensionSkillIdsForBridge(bundle: ExtensionBundle): readonly string[] | undefined {
  if (bundle.errors.length > 0) return [];
  if (!bundle.manifestPath) return undefined;
  return bundle.manifestVersion === '1.1' ? bundle.skills : undefined;
}

/**
 * 将 extension 合并进已解析的 profile（capabilities：扩展覆盖同名 key；有错则不合并能力）。
 */
export function applyInstanceExtensions(
  resolved: HarnessResolvedProfile,
  projectRoot: string,
  extensionDirRel?: string,
): HarnessResolvedProfile {
  const bundle = loadInstanceExtensions(projectRoot, extensionDirRel);
  const mergedCaps: Record<string, ProfileCapabilitySpec> = {
    ...(resolved.capabilities as Record<string, ProfileCapabilitySpec>),
  };
  if (bundle.errors.length === 0) {
    Object.assign(mergedCaps, bundle.extensionCapabilities);
  }
  return {
    ...resolved,
    capabilities: normalizeCapabilitiesMap(mergedCaps),
    extensionBundle: bundle,
  };
}
