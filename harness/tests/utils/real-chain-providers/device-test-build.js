// real-chain（plan d4a1f7c3 §4.2）：device_test.build 的**可执行替身**。
// 单测里没有 DevEco/hvigor，所以不跑编译；但它必须像真 provider 一样**产出一个 HAP 文件**
// ——下游 install 要对它算完整摘要、compose 要在写 evidence 前复算同一摘要（TOCTOU 钉死）。
// 返定值而不落盘的老替身走不到 testing PASS，这就是 plan §10.4 说的「可执行替身」。
const fs = require('fs');
const path = require('path');

exports.provider = {
  id: 'hvigor_app',
  capability: 'device_test.build',
  exports: ['runDeviceTestAppBuild'],
};

/** 与真 provider 同形状的返回值（DeviceTestBuildResult）；hvigor 段按 isHvigorBuildSuccessful 的判据给。 */
exports.runDeviceTestAppBuild = function runDeviceTestAppBuild(opts) {
  const outDir = path.join(opts.projectRoot, 'build', 'default', 'outputs', 'default');
  fs.mkdirSync(outDir, { recursive: true });
  const hapPath = path.join(outDir, 'entry-default-signed.hap');
  // 内容跟着产品源码走：源码变了 HAP 摘要就变，执行键随之变化（复用判定才有意义）。
  const sources = [];
  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (/\.ets$/.test(ent.name)) sources.push(`${path.relative(opts.projectRoot, abs).replace(/\\/g, '/')}\n${fs.readFileSync(abs, 'utf-8')}`);
    }
  };
  walk(path.join(opts.projectRoot, '02-Feature'));
  sources.sort();
  fs.writeFileSync(hapPath, `real-chain seam hap\n${sources.join('\n')}`, 'utf-8');
  return {
    hvigor: {
      executed: true,
      timedOut: false,
      exitCode: 0,
      successMarkerFound: true,
      command: 'real-chain seam: device_test.build',
      logPath: null,
      logExcerpt: '',
      errors: [],
      diagnostics: [],
    },
    hapPath,
    resolvedProduct: 'default',
    resolvedBuildMode: 'debug',
    reused: false,
    scannedDirs: [outDir],
    candidates: [{ path: hapPath }],
  };
};
