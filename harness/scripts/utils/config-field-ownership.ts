// ============================================================================
// config-field-ownership.ts — project vs personal 字段归属 SSOT（Scheme A）
// ============================================================================

export const PERSONAL_DEVECO_LEAF_KEYS = ['installPath', 'hvigorBin'] as const;

export const HMOS_DEVICE_TUNING_KEYS = [
  'killHdcServerOnFinish',
  'aaTestTimeoutMs',
  'testRunner',
] as const;

export const LOCAL_CANONICAL_TOP_KEYS = new Set(['schema_version', 'agent_adapter', 'toolchain', 'vision']);

/** E1（多模态降级阶梯 plan d4a8f3c6）：framework.local.json.vision 顶层允许键。 */
export const LOCAL_VISION_KEYS = new Set(['image_input_override', 'canary']);
/** framework.local.json.vision.canary 允许键。 */
export const LOCAL_VISION_CANARY_KEYS = new Set(['adapter', 'verdict', 'probed_at', 'reason']);

/** 唯一 known-legacy 顶层键（非 canonical，读盘时剥离） */
export const LOCAL_LEGACY_TOP_KEY = 'setup';

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function readDevecoObject(raw: Record<string, unknown>): Record<string, unknown> | null {
  const tc = raw.toolchain;
  if (!tc || typeof tc !== 'object' || Array.isArray(tc)) return null;
  const deveco = (tc as Record<string, unknown>).devEcoStudio;
  if (!deveco || typeof deveco !== 'object' || Array.isArray(deveco)) return null;
  return deveco as Record<string, unknown>;
}

/** project config 是否含须外迁/清场的 personal 字段（含整节 devEcoStudio） */
export function projectHasMisplacedPersonalFields(raw: Record<string, unknown>): boolean {
  if (isNonEmptyString(raw.agent_adapter)) return true;
  return readDevecoObject(raw) !== null;
}

/** migrate-config 探测：与 misplaced 同义（legacy 待清场） */
export function projectHasLegacyPersonalFields(raw: Record<string, unknown>): boolean {
  return projectHasMisplacedPersonalFields(raw);
}

export function projectDevecoHasPersonalLeaves(deveco: Record<string, unknown>): boolean {
  return isNonEmptyString(deveco.installPath) || isNonEmptyString(deveco.hvigorBin);
}

export function projectDevecoHasTuningLeaves(deveco: Record<string, unknown>): boolean {
  for (const key of HMOS_DEVICE_TUNING_KEYS) {
    if (key in deveco && deveco[key] !== undefined && deveco[key] !== null && deveco[key] !== '') {
      return true;
    }
  }
  return false;
}

/** project devEcoStudio 是否仍有待迁入 hmosDevice 的调优键 */
export function projectNeedsDevecoTuningMigration(raw: Record<string, unknown>): boolean {
  const deveco = readDevecoObject(raw);
  if (!deveco) return false;
  return projectDevecoHasTuningLeaves(deveco);
}

export function ensureHmosDeviceOnToolchain(base: Record<string, unknown>): Record<string, unknown> {
  const tc = base.toolchain;
  const tcObj =
    tc && typeof tc === 'object' && !Array.isArray(tc)
      ? { ...(tc as Record<string, unknown>) }
      : {};
  if (!tcObj.hmosDevice || typeof tcObj.hmosDevice !== 'object' || Array.isArray(tcObj.hmosDevice)) {
    tcObj.hmosDevice = {};
  }
  base.toolchain = tcObj;
  return tcObj.hmosDevice as Record<string, unknown>;
}

/** 将 legacy deveco 调优键迁入 toolchain.hmosDevice（就地修改 base） */
export function migrateDevecoTuningToHmosDevice(base: Record<string, unknown>): boolean {
  const deveco = readDevecoObject(base);
  if (!deveco) return false;
  const hmos = ensureHmosDeviceOnToolchain(base);
  let changed = false;
  for (const key of HMOS_DEVICE_TUNING_KEYS) {
    if (!(key in deveco)) continue;
    const v = deveco[key];
    if (v === undefined || v === null || v === '') continue;
    if (hmos[key] === undefined) {
      hmos[key] = v;
      changed = true;
    }
    delete deveco[key];
    changed = true;
  }
  const tc = base.toolchain as Record<string, unknown>;
  if (Object.keys(deveco).length === 0) {
    delete tc.devEcoStudio;
    changed = true;
  }
  if (Object.keys(tc).length === 0) {
    delete base.toolchain;
  }
  return changed;
}

/** strip personal 叶子后删除空 devEcoStudio（就地修改） */
export function stripPersonalLeavesFromProjectDeveco(base: Record<string, unknown>): boolean {
  const deveco = readDevecoObject(base);
  if (!deveco) return false;
  let changed = false;
  for (const key of PERSONAL_DEVECO_LEAF_KEYS) {
    if (key in deveco) {
      delete deveco[key];
      changed = true;
    }
  }
  const tc = base.toolchain as Record<string, unknown>;
  if (Object.keys(deveco).length === 0) {
    delete tc.devEcoStudio;
    changed = true;
  }
  if (Object.keys(tc).length === 0) {
    delete base.toolchain;
    changed = true;
  }
  return changed;
}
