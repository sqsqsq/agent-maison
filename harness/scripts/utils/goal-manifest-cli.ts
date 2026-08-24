/**
 * Manifest + CLI override pairing — strict per-field validation.
 */

import type { GoalManifest, AdapterModelPin } from './goal-manifest';
import type { FeaturePhase } from './phase-transition-policy';

export interface ManifestCliArgv {
  manifest?: string;
  start?: string;
  end?: string;
  adapter?: string;
  requirement?: string;
  /** plan c4e8a1f7 T2：--requirement-file 的来源列表（由 goal-runner 解析后填入，非 CLI 直接旗标） */
  requirement_source_files?: string[];
  /** t6：--fidelity（只升不降）与 --fidelity-receipt（降档凭证路径） */
  fidelity?: string;
  'fidelity-receipt'?: string;
  'override-start'?: boolean;
  'override-end'?: boolean;
  'override-manifest'?: boolean;
}

export function validateManifestCliOverrides(
  argv: ManifestCliArgv,
): { ok: true } | { ok: false; message: string } {
  if (!argv.manifest) return { ok: true };

  const missing: string[] = [];
  if (argv.start && !argv['override-start']) {
    missing.push('--start requires --override-start');
  }
  if (argv.end && !argv['override-end']) {
    missing.push('--end requires --override-end');
  }
  if ((argv.adapter || argv.requirement) && !argv['override-manifest']) {
    missing.push('--adapter/--requirement require --override-manifest');
  }

  if (missing.length > 0) {
    return {
      ok: false,
      message: `[goal-runner] BLOCKER: --manifest override mismatch: ${missing.join('; ')}`,
    };
  }
  return { ok: true };
}

export function applyManifestCliOverrides(manifest: GoalManifest, argv: ManifestCliArgv): void {
  if (argv['override-start'] && argv.start) {
    manifest.start_phase = String(argv.start) as FeaturePhase;
  }
  if (argv['override-end'] && argv.end) {
    manifest.end_phase = String(argv.end) as FeaturePhase;
  }
  if (argv['override-manifest'] && argv.adapter) {
    manifest.adapter = String(argv.adapter);
  }
  if (argv['override-manifest'] && argv.requirement) {
    manifest.requirement = String(argv.requirement);
    // plan c4e8a1f7 T2（评审 P0/P1 修复）：来源**随 requirement 替换**——普通
    // --manifest + --requirement-file + --override-manifest 下，旧来源属于旧需求文本，
    // 保留/追加会把旧来源目录图片重新引入 capability/prompt/receipt/Visual Handoff
    // 分母（历史图片污染）。
    //  · --requirement-file 提供新来源 → 整体替换（不复用 manifest 文件自身旧来源）；
    //  · inline --requirement（无来源）→ 清空旧来源（inline 需求无 sibling 扫描面）。
    // successor 显式增量“继承源来源并追加增量来源”由 inheritSuccessorManifest 负责
    // （发生在 override 之前），本函数不做叠加。
    const newSources = argv.requirement_source_files;
    if (newSources && newSources.length > 0) {
      manifest.requirement_source_files = [...newSources];
    } else {
      delete manifest.requirement_source_files;
    }
  }
  // t6：--fidelity 无需 override 开关（新字段无既有 manifest 冲突面）；只升不降与
  // 降档凭证校验在 fidelity preflight 内执行（flag 本身不构成授权）。
  if (argv.fidelity) {
    manifest.fidelity = String(argv.fidelity) as GoalManifest['fidelity'];
  }
  if (argv['fidelity-receipt']) {
    manifest.fidelity_receipt = String(argv['fidelity-receipt']);
  }
}

// ----------------------------------------------------------------------------
// plan d7f3a9c4 t1/t2：显式模型钉 CLI 校验 + 单点裁决
// ----------------------------------------------------------------------------

/**
 * --adapter-model 的 CLI 值归一与校验（fail-fast）：先 trim，再校验非空、长度 ≤128、
 * 无控制字符。**不做模型名白名单**（格式责任在用户，CLI fail-fast）。
 * 返回归一后的值；未提供（undefined）时原样返回。
 */
export function normalizeAdapterModelCliValue(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') {
    throw new Error('[goal-runner] BLOCKER: --adapter-model 须为字符串值参数');
  }
  const value = raw.trim();
  if (!value) {
    throw new Error('[goal-runner] BLOCKER: --adapter-model 值经 trim 后为空');
  }
  if (value.length > 128) {
    throw new Error('[goal-runner] BLOCKER: --adapter-model 长度须 ≤128');
  }
  if (/[\u0000-\u001F\u007F]/.test(value)) {
    throw new Error('[goal-runner] BLOCKER: --adapter-model 不得含控制字符');
  }
  return value;
}

export interface ResolveFinalModelPinInput {
  /** 已归一/校验的 --adapter-model CLI 值（无 pin 时 undefined），或 undefined */
  cliValue?: string;
  /** reconcile 后的 effective adapter */
  effectiveAdapter: string;
  /** reconcile 前的原始 adapter（manifest/source 既有值；不能用 pin.adapter 推断） */
  originalAdapter?: string;
  /** manifest 既有 pin（来自 --manifest / --resume / successor 继承） */
  manifestPin?: AdapterModelPin;
  /** 是否 --resume */
  isResume: boolean;
  /** 是否 fresh 且带 --manifest */
  hasManifestFlag: boolean;
  /** 是否 successor（manifest.successor_of 已设；**仅出生特权，resume 不适用**） */
  isSuccessor: boolean;
  /** --override-manifest */
  overrideManifest: boolean;
  /** --override-adapter */
  overrideAdapter: boolean;
}

export type ResolveFinalModelPinResult =
  | { ok: true; pin?: AdapterModelPin }
  | { ok: false; message: string };

/**
 * plan d7f3a9c4 t2：final pin **单点裁决**（唯一产生 final pin 的纯函数）。
 *
 * 落点：adapter reconcile 之后、manifest 身份哈希计算之前（goal-runner 接线）。
 * 规则逐条写死（fresh / fresh+manifest / resume / force-resume / successor / 换
 * adapter+模型 的完整授权矩阵）：
 *  - fresh 普通启动：直接接受 --adapter-model；
 *  - fresh + --manifest：与 manifest pin 同值幂等；新增或不同值须 --override-manifest；
 *  - resume / force-resume：不传=用 manifest 冻结 pin；同值幂等；不同值必须
 *    --override-manifest；--force-resume 本身不绕过 pin drift；
 *  - adapter 变了（**以 originalAdapter 判定，非 pin.adapter**）但未给新模型 → BLOCKER；
 *  - **pin.adapter 与 effectiveAdapter 不一致**（manifestPin.adapter ≠ effective，与 run 是否
 *    换 adapter 无关的不变量）无新 CLI pin 时 → BLOCKER；有新 CLI pin 时按授权规则替换；
 *  - resume 同时换 adapter 与模型 → --override-adapter 与 --override-manifest 两个
 *    都必须有；
 *  - successor **出生**（isSuccessor && !isResume）：默认继承源 pin；出生时显式
 *    --adapter-model 是**新 run 出生输入**，可覆盖继承值且**不要求 --override-manifest**；
 *    successor 换 adapter 须 --adapter <new> --override-adapter --adapter-model <new-model>，
 *    禁止把旧 adapter 的模型字符串回放到新 adapter。**后续 resume 不享受出生特权**——
 *    一律走 resume 授权规则。
 *  - chrys / generic 传 pin（CLI 或继承的 manifest pin）→ fail-fast（argv 无法回放，
 *    否则形成"manifest 声称已钉而实际未钉"）。
 */
export function resolveFinalModelPin(
  input: ResolveFinalModelPinInput,
): ResolveFinalModelPinResult {
  const {
    cliValue,
    effectiveAdapter,
    originalAdapter,
    manifestPin,
    isResume,
    hasManifestFlag,
    isSuccessor,
    overrideManifest,
    overrideAdapter,
  } = input;
  const makePin = (value: string): AdapterModelPin => ({ adapter: effectiveAdapter, value });
  // adapter 变化以 **reconcile/applyManifestCliOverrides 前的原始 adapter** 判定（旧 run/source
  // 无 pin 时，pin.adapter 不存在，无法据此推断原 adapter）。
  const adapterChanged = originalAdapter !== undefined && originalAdapter !== effectiveAdapter;
  // 独立不变量：既有 frozen pin 的 adapter 必须等于 effectiveAdapter。即便 run 的 adapter
  // 未变（originalAdapter===effectiveAdapter），只要 manifestPin.adapter 不一致，也不得原样
  // 把另一个 adapter 的模型值回放给当前 adapter。
  const pinAdapterMismatch = Boolean(manifestPin && manifestPin.adapter !== effectiveAdapter);
  const unsupported = effectiveAdapter === 'chrys' || effectiveAdapter === 'generic';

  // chrys / generic 无回放缝：最终 pin 存在（CLI flag 或继承/加载的 manifest pin）
  // 即 fail-fast——否则 manifest 声称已钉、argv 实际不回放。
  if (unsupported && (cliValue !== undefined || manifestPin !== undefined)) {
    return {
      ok: false,
      message:
        `[goal-runner] BLOCKER: adapter ${effectiveAdapter} 不支持 --adapter-model 模型钉` +
        '（无模型回放旗标）；请移除 CLI flag，或清除 manifest 中的 adapter_model_pin。',
    };
  }

  // successor **出生**特权（仅 fresh，非 resume）——出生输入优先，默认继承源 pin。
  if (isSuccessor && !isResume) {
    if (cliValue === undefined) {
      // 无 CLI 出生输入：继承/冻结 pin。run 换 adapter 或继承 pin.adapter 与 effective 不一致
      // 都不得静默回放（旧 adapter 模型不得进新 adapter）。
      if (adapterChanged) {
        return {
          ok: false,
          message:
            `[goal-runner] BLOCKER: successor 换 adapter（${originalAdapter}→${effectiveAdapter}）` +
            '却未提供新 --adapter-model——旧 adapter 的模型字符串不得回放到新 adapter，' +
            '须 --adapter <new> --override-adapter --adapter-model <new-model>。',
        };
      }
      if (pinAdapterMismatch) {
        return {
          ok: false,
          message:
            `[goal-runner] BLOCKER: successor 继承的 adapter_model_pin.adapter=${manifestPin!.adapter} ` +
            `与 effective adapter=${effectiveAdapter} 不一致（继承 pin 损坏）。adapter 未改变，` +
            '修复只需出生参数：--adapter-model <模型>（覆盖继承 pin；无需 --adapter、' +
            '无需任何 override 旗标）。',
        };
      }
      return { ok: true, pin: manifestPin };
    }
    // 有 CLI 出生输入：显式 --adapter-model 可直接覆盖继承值，**不要求 --override-manifest**。
    // 只有 run 真的换 adapter（adapterChanged）才须 --override-adapter；损坏的继承 pin.adapter
    // 由出生输入修复，不反向取得 adapter 授权裁决权。
    if (adapterChanged && !overrideAdapter) {
      return {
        ok: false,
        message:
          `[goal-runner] BLOCKER: successor 换 adapter 须 --override-adapter + 新 --adapter-model` +
          '（旧 adapter 的模型字符串不得回放到新 adapter）。',
      };
    }
    return { ok: true, pin: makePin(cliValue) };
  }

  // fresh 普通启动（无 --manifest、无 --resume、无既有 pin）：直接接受。
  if (!isResume && !hasManifestFlag && !manifestPin) {
    return { ok: true, pin: cliValue === undefined ? undefined : makePin(cliValue) };
  }

  // manifest 绑定 run（fresh+--manifest 或 resume），或已有冻结 pin。
  // adapter 变了（以 originalAdapter 判定）或 frozen pin.adapter 与 effective 不一致但未给
  // 新模型 → BLOCKER。
  if (cliValue === undefined) {
    if (adapterChanged) {
      return {
        ok: false,
        message:
          `[goal-runner] BLOCKER: adapter 已由 ${originalAdapter} 变为 ${effectiveAdapter}，` +
          '但未提供 --adapter-model 重新钉模型——须显式 --adapter-model（配合相应 override）。',
      };
    }
    if (pinAdapterMismatch) {
      return {
        ok: false,
        message:
          `[goal-runner] BLOCKER: manifest adapter_model_pin.adapter=${manifestPin!.adapter} 与最终` +
          ` effective adapter=${effectiveAdapter} 不一致——须显式 --adapter-model（配合相应 override）` +
          '重新钉当前 adapter 的模型，不得把另一 adapter 的模型值回放给当前 adapter。',
      };
    }
    return { ok: true, pin: manifestPin };
  }

  // cliValue 在场、manifest 绑定 run。
  if (manifestPin && manifestPin.value === cliValue && !adapterChanged && !pinAdapterMismatch) {
    // 同值幂等
    return { ok: true, pin: makePin(cliValue) };
  }
  // resume 同时换 adapter 与模型 → 两个 override 都必须有。
  if (adapterChanged && isResume) {
    if (!(overrideManifest && overrideAdapter)) {
      return {
        ok: false,
        message:
          '[goal-runner] BLOCKER: resume 同时换 adapter 与模型须 --override-adapter 与 ' +
          '--override-manifest 都提供（不得部分授权）。',
      };
    }
    return { ok: true, pin: makePin(cliValue) };
  }
  // 新增/不同值（含 pinAdapterMismatch 的替换；fresh+manifest 或 resume）→ 必须 --override-manifest。
  if (!overrideManifest) {
    return {
      ok: false,
      message:
        '[goal-runner] BLOCKER: --adapter-model 与冻结 manifest pin 不一致或为新增' +
        '（adapter_model_pin 非 start/end 字段，--override-start/--override-end 不授权它）' +
        '——须 --override-manifest。',
    };
  }
  return { ok: true, pin: makePin(cliValue) };
}
