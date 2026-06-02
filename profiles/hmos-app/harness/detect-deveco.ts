// ============================================================================
// detect-deveco.ts — DevEco Studio 安装路径探测
// ============================================================================
//
// 用途：personal setup / planner `detect-deveco` 任务在写 `framework.local.json > toolchain.devEcoStudio`
//      之前调用本脚本，给用户一个推荐 installPath 候选 +「为什么是它」的解释。
//      非交互（纯输出 JSON 或文本），决定权仍在用户手里——我们不替用户落盘。
//
// 用法（在仓库根，或带 --json 给上层 Skill / Hook 解析）：
//
//   # 自动扫描所有候选路径，输出最佳匹配 + 完整候选列表
//   npx ts-node framework/harness/scripts/detect-deveco.ts
//
//   # 验证指定路径
//   npx ts-node framework/harness/scripts/detect-deveco.ts --path "D:/Program Files/Huawei/DevEco Studio"
//
//   # 机器可读 JSON 输出（给 framework-init 用）
//   npx ts-node framework/harness/scripts/detect-deveco.ts --json
//
// 退出码：
//   0 — 找到至少一个 status=ok 的 DevEco 安装
//   1 — 都没找到（用户多半没装，或装在非常规路径）
//   2 — --path 指定但路径下结构不完整（关键子目录缺失）
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  deriveHvigorBinFromInstallPath,
  deriveSdkHomeFromInstallPath,
  deriveJbrHomeFromInstallPath,
} from '../../../harness/config';

type DetectStatus = 'ok' | 'incomplete' | 'not_found';

export interface DetectResult {
  /** ok：所有关键子目录命中；incomplete：installPath 存在但缺子目录；not_found：installPath 自己都不存在 */
  status: DetectStatus;
  /** 被探测的 DevEco Studio 根路径（仅 ok / incomplete 时有意义） */
  installPath?: string;
  /** 探测来源：scan = 内置候选扫描；user = 用户 --path 指定 */
  source: 'scan' | 'user';
  hvigorBin?: string;
  sdkHome?: string;
  jbrHome?: string;
  /** 缺失项的人话描述，便于直接给用户看 */
  missing: string[];
}

export interface DetectScanReport {
  recommended?: DetectResult;
  candidates: DetectResult[];
}

// ----------------------------------------------------------------------------
// 候选路径列表（按平台 + 常见 vendor 安装位置）
// ----------------------------------------------------------------------------

function getCandidates(): string[] {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return [
      'D:/Program Files/Huawei/DevEco Studio',
      'C:/Program Files/Huawei/DevEco Studio',
      'D:/Huawei/DevEco Studio',
      'C:/Huawei/DevEco Studio',
      'D:/DevEco Studio',
      'C:/DevEco Studio',
      // 用户级安装（无管理员权限装）：
      path.join(home, 'AppData/Local/Programs/Huawei/DevEco Studio').replace(/\\/g, '/'),
    ];
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/DevEco-Studio.app/Contents',
      '/Applications/DevEco Studio.app/Contents',
      path.join(home, 'Applications/DevEco-Studio.app/Contents'),
    ];
  }
  // Linux & 其他
  return [
    '/opt/deveco-studio',
    '/usr/local/deveco-studio',
    path.join(home, 'deveco-studio'),
    path.join(home, 'DevEco Studio'),
  ];
}

// ----------------------------------------------------------------------------
// 单点探测
// ----------------------------------------------------------------------------

function detectAt(installPath: string, source: 'scan' | 'user'): DetectResult {
  const norm = installPath.replace(/\\/g, '/');

  if (!fs.existsSync(norm)) {
    return { status: 'not_found', source, installPath: norm, missing: [`installPath 不存在：${norm}`] };
  }

  const hvigorBin = deriveHvigorBinFromInstallPath(norm);
  const sdkHome = deriveSdkHomeFromInstallPath(norm);
  const jbrHome = deriveJbrHomeFromInstallPath(norm);
  const javaExe = jbrHome
    ? path.join(jbrHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    : null;

  const missing: string[] = [];
  const hasHvigor = !!hvigorBin && fs.existsSync(hvigorBin);
  const hasSdk = !!sdkHome && fs.existsSync(sdkHome);
  const hasJbr = !!javaExe && fs.existsSync(javaExe);

  if (!hasHvigor) missing.push(`hvigor wrapper 缺失：${hvigorBin ?? '(无法推导)'}`);
  if (!hasSdk) missing.push(`HarmonyOS SDK 缺失：${sdkHome ?? '(无法推导)'}`);
  if (!hasJbr) missing.push(`JBR (Java 运行时) 缺失：${javaExe ?? '(无法推导)'}`);

  return {
    status: missing.length === 0 ? 'ok' : 'incomplete',
    source,
    installPath: norm,
    hvigorBin: hasHvigor ? hvigorBin! : undefined,
    sdkHome: hasSdk ? sdkHome! : undefined,
    jbrHome: hasJbr ? jbrHome! : undefined,
    missing,
  };
}

// ----------------------------------------------------------------------------
// 主入口
// ----------------------------------------------------------------------------

export function detectScan(): DetectScanReport {
  const candidates = getCandidates().map(p => detectAt(p, 'scan'));
  // 优先级：ok > incomplete > not_found
  const score = (r: DetectResult): number => (r.status === 'ok' ? 2 : r.status === 'incomplete' ? 1 : 0);
  const sorted = [...candidates].sort((a, b) => score(b) - score(a));
  const best = sorted[0];
  return {
    recommended: best && score(best) > 0 ? best : undefined,
    candidates,
  };
}

function parseArgs(argv: string[]): { path?: string; json: boolean } {
  const out: { path?: string; json: boolean } = { json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--path') out.path = argv[i + 1];
    else if (argv[i] === '--json') out.json = true;
  }
  return out;
}

function printText(res: DetectResult | DetectScanReport): void {
  if ('candidates' in res) {
    console.log(`\nDevEco Studio 路径自动探测（共扫描 ${res.candidates.length} 个候选）\n`);
    if (res.recommended) {
      console.log(`✔ 推荐 installPath：${res.recommended.installPath}`);
      console.log(`  状态：${res.recommended.status}`);
      if (res.recommended.hvigorBin) console.log(`  hvigor：${res.recommended.hvigorBin}`);
      if (res.recommended.sdkHome) console.log(`  SDK   ：${res.recommended.sdkHome}`);
      if (res.recommended.jbrHome) console.log(`  JBR   ：${res.recommended.jbrHome}`);
      if (res.recommended.missing.length) {
        console.log(`  缺失项：`);
        for (const m of res.recommended.missing) console.log(`    - ${m}`);
      }
    } else {
      console.log('✘ 未在常见路径找到 DevEco Studio。');
      console.log('  请手动确认安装位置后用 --path 指定，例如：');
      console.log('    npx ts-node framework/harness/scripts/detect-deveco.ts --path "D:/Program Files/Huawei/DevEco Studio"');
    }
    console.log(`\n所有候选状态：`);
    for (const c of res.candidates) {
      const tag = c.status === 'ok' ? '✔' : c.status === 'incomplete' ? '◐' : '✘';
      console.log(`  ${tag} [${c.status.padEnd(11)}] ${c.installPath}`);
    }
  } else {
    console.log(`\n指定路径检测：${res.installPath}`);
    console.log(`  状态：${res.status}`);
    if (res.hvigorBin) console.log(`  hvigor：${res.hvigorBin}`);
    if (res.sdkHome) console.log(`  SDK   ：${res.sdkHome}`);
    if (res.jbrHome) console.log(`  JBR   ：${res.jbrHome}`);
    if (res.missing.length) {
      console.log(`  缺失项：`);
      for (const m of res.missing) console.log(`    - ${m}`);
    }
  }
  console.log('');
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.path) {
    const res = detectAt(args.path, 'user');
    if (args.json) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      printText(res);
    }
    process.exit(res.status === 'ok' ? 0 : res.status === 'incomplete' ? 2 : 1);
  }

  const report = detectScan();
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printText(report);
  }
  process.exit(report.recommended && report.recommended.status === 'ok' ? 0 : 1);
}

if (require.main === module) {
  main();
}
