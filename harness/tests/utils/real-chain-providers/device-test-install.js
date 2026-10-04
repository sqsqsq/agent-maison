// real-chain（plan d4a1f7c3 §4.2）：device_test.install 的**可执行替身**。
// 不碰 hdc、不碰真机；只把「装了哪些字节」这一个事实如实回传：`hapSha256Full` 由
// hmos-app 的**生产实现** computeHapSha256Full 计算，evidence compose 会用同一函数复算比对，
// 替身自己算一份 sha 会把这道 TOCTOU 校验洗成自证。
const fs = require('fs');
const path = require('path');

const HMOS_HARNESS = path.resolve(__dirname, '..', '..', '..', 'hmos-app', 'harness');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { computeHapSha256Full, computeHapBuildFingerprint } = require(path.join(HMOS_HARNESS, 'build-fingerprint.ts'));
const { featurePhaseReportsDir } = require(path.resolve(__dirname, '..', '..', '..', '..', 'harness', 'config.ts'));

exports.provider = {
  id: 'hdc_app',
  capability: 'device_test.install',
  exports: ['installDeviceTestApp'],
};

exports.installDeviceTestApp = function installDeviceTestApp(opts) {
  const hapSha256Full = computeHapSha256Full(opts.hapPath);
  const stat = fs.statSync(opts.hapPath);
  // 与真实 install provider 同一产物契约；runtime 正式提交前从实际 HAP/meta 重核。
  const reportsDir = featurePhaseReportsDir(opts.projectRoot, opts.feature, opts.phase, opts.frameworkRoot);
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, 'device-test-install.meta.json'), JSON.stringify({
    ok: true, reused: false, hapPath: opts.hapPath,
    hapMtimeMs: stat.mtimeMs, hapSizeBytes: stat.size,
    hapSha256: computeHapBuildFingerprint(opts.hapPath),
    timestamp: new Date().toISOString(),
  }, null, 2) + '\n', 'utf8');
  return {
    executed: true,
    reused: false,
    ok: true,
    probe: { ok: true, devices: ['real-chain-seam'], kind: 'physical' },
    install: { ok: true, command: 'real-chain seam: device_test.install' },
    errors: [],
    hapSha256Full,
  };
};
