/**
 * device-testing device_test.build — 业务源码新鲜度 vs 已有 HAP，判定是否跳过 hvigor。
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { loadFrameworkConfig } from '../../../harness/config';
import { buildChildEnv, describeHvigorEnvironment, discoverAppHapArtifacts, detectStaleSignedSuspect,
  listBuildProfileModules, parseProductJson5, resolveDevEcoInstallRoot, type HapDiscoveryCandidate } from './hvigor-runner';
import { resolveDeviceTestBuildMode } from './testing-build-conventions';
import { computeHapSha256Full } from './build-fingerprint';
import { isRebuildableHarBuildProfile, isRebuildableOhosTestIntermediate } from './generated-source-classifier';

const SKIP_DIR_NAMES = new Set([
  'build',
  'oh_modules',
  'node_modules',
  '.preview',
  '.git',
  '.hvigor',
  'dist',
]);

export interface DeviceTestBuildReuseInput {
  projectRoot: string;
  /**
   * **已冻结**的选定 product（review P2：由 provider 单次解析传入，本函数**不得**再
   * 做任何 product 解析——否则会绕开 provider 的 single-resolve 契约，形成隐式二次解析）。
   */
  product: string;
  buildMode?: 'debug' | 'release';
  /** 当前调用的报告目录；不跨 Feature 查找成功记录。 */
  reportDir?: string;
}

export interface DeviceTestBuildReuseDecision {
  reuse: boolean;
  reason: string;
  hapPath: string | null;
  hapMtimeMs: number | null;
  hapBuiltAt: string | null;
  inputsMaxMtimeMs: number;
  resolvedProduct: string;
  resolvedBuildMode: 'debug' | 'release';
  /** 陈旧配对不可复用；字段保留以兼容原诊断消费者。 */
  staleSuspect?: boolean;
  staleSuspectUnsignedPath?: string | null;
  staleSuspectNote?: string;
  /**
   * 产物发现过程（plan d7e4b2a9 review P2）：复用路径此前只调薄包装 findAppSignedHap，
   * scannedDirs/candidates 被丢弃，导致复用命中时歧义 WARN 静默。现改用
   * discoverAppHapArtifacts 并透传，使 check-testing.ts 的候选歧义提示在复用/
   * 非复用两条路径下行为一致。
   */
  scannedDirs?: string[];
  candidates?: HapDiscoveryCandidate[];
  artifactValidation?: ReturnType<typeof detectStaleSignedSuspect>;
  hapSha256Full?: string;
  buildInputsSha256?: string;
  /** The existing signed candidate has no matching input provenance to trust the incremental cache. */
  forceFullBuild: boolean;
  priorResult?: Record<string, unknown>;
}

export const DEVICE_TEST_BUILD_RESULT = 'device-test-build.result.json';

function envForceBuild(): boolean {
  const v = process.env.HARNESS_DEVICE_TEST_FORCE_BUILD?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function outerLayerRoots(projectRoot: string): string[] {
  return (loadFrameworkConfig(projectRoot).architecture?.outer_layers ?? [])
    .map(layer => layer.id?.trim()).filter(Boolean).map(id => path.join(projectRoot, id));
}

const ROOT_BUILD_INPUTS = ['AppScope', 'build-profile.json5', 'hvigorfile.ts', 'hvigorfile.js', 'hvigor',
  'hvigorw', 'hvigorw.bat', 'local.properties', 'oh-package.json5', 'oh-package-lock.json5', '.ohpmrc',
  'code-linter.json5', 'framework.config.json'];

const PUBLIC_SIGNING_FIELDS = ['storeFile', 'keyAlias', 'signAlg', 'profile', 'certpath'];
const OPAQUE_SIGNING_FIELDS = ['storePassword', 'keyPassword'];

interface SigningConfig {
  name?: string;
  type?: string;
  material?: Record<string, string>;
}

interface BuildProfile {
  signingConfigs?: SigningConfig[];
  app?: { products?: Array<{ name?: string; signingConfig?: string }>; signingConfigs?: SigningConfig[] };
}

function opaqueFilename(file: string): boolean {
  const name = path.basename(file).toLowerCase();
  return ['.ohpmrc', '.npmrc', '.netrc', '.envrc', 'local.properties'].includes(name) || /^\.env(?:\.|$)/.test(name) ||
    /\.(?:p12|pfx|jks|jceks|bks|key|keystore|pkcs12|pkcs8|pem)$/.test(name);
}

function opaqueFileState(file: string): string {
  // Observe replacement and writes, including ordinary writes that restore mtime, without opening the file.
  const stat = fs.statSync(file, { bigint: true });
  if (!stat.isFile() || stat.ino <= 0n || stat.ctimeNs <= 0n) throw new Error('Opaque input identity unavailable');
  return [stat.dev, stat.ino, stat.size, stat.mode, stat.mtimeNs, stat.ctimeNs].join(':');
}

/** Byte identity of the selected application's inputs, independent of generated HAR rewrites. */
export function snapshotDeviceTestBuildInputs(projectRoot: string, product: string, buildMode: 'debug' | 'release'):
  { sha256: string; maxMtimeMs: number } | null {
  try {
    const root = path.resolve(projectRoot);
    const profileFile = path.join(root, 'build-profile.json5');
    if (!fs.lstatSync(profileFile).isFile()) return null;
    const devecoRoot = resolveDevEcoInstallRoot(root);
    const modules = listBuildProfileModules(root);
    const moduleRoots = new Map(modules.map(({ srcPath }) => [path.resolve(root, srcPath), srcPath.replace(/\\/g, '/')]));
    const entryPoints = new Set([root, ...moduleRoots.keys()]);
    const files = new Map<string, string>();
    const visited = new Set<string>();
    const profiles = new Map<string, BuildProfile>();
    const opaqueStores = new Set<string>();
    let maxMtimeMs = 0;

    const fileKey = (file: string) => process.platform === 'win32' ? file.toLowerCase() : file;
    const opaque = (file: string): boolean => opaqueFilename(file) || opaqueStores.has(fileKey(file));

    function readProfile(file: string): BuildProfile {
      if (opaque(file) || !fs.lstatSync(file).isFile()) throw new Error('Build profile identity unavailable');
      const profile = parseProductJson5(fs.readFileSync(file, 'utf8')) as BuildProfile;
      for (const owner of [profile, profile.app]) {
        if (!owner?.signingConfigs) continue;
        owner.signingConfigs = owner.signingConfigs.map(config => {
          const { name, type, material } = config;
          if ((name !== undefined && typeof name !== 'string') || (type !== undefined && typeof type !== 'string') ||
              Object.keys(config).some(key => !['name', 'type', 'material'].includes(key)) ||
              Object.keys(material ?? {}).some(key => !PUBLIC_SIGNING_FIELDS.includes(key) && !OPAQUE_SIGNING_FIELDS.includes(key))) {
            throw new Error('Signing configuration identity unavailable');
          }
          if (!material) return { name, type };
          if ('storeFile' in material) {
            if (typeof material.storeFile !== 'string' || !material.storeFile || /[$%]/.test(material.storeFile)) {
              throw new Error('Opaque store location unavailable');
            }
            const store = path.resolve(root, material.storeFile);
            opaqueStores.add(fileKey(store));
            if (fs.existsSync(store)) opaqueStores.add(fileKey(fs.realpathSync(store)));
          }
          if (OPAQUE_SIGNING_FIELDS.some(key => key in material)) {
            files.set(`signing-config-state:${path.relative(root, file)}`, opaqueFileState(file));
          }
          return { name, type, material: Object.fromEntries(PUBLIC_SIGNING_FIELDS
            .filter(key => typeof material[key] === 'string').map(key => [key, material[key]])) };
        });
      }
      return profile;
    }

    // Register declared store paths before traversing module directories, including extensionless stores.
    for (const file of [profileFile, ...[...moduleRoots.keys()].map(dir => path.join(dir, 'build-profile.json5'))]) {
      if (fs.existsSync(file)) profiles.set(file, readProfile(file));
    }

    function walk(file: string, optional = false): void {
      if (visited.has(file)) return;
      visited.add(file);
      let stat: fs.Stats;
      try { stat = fs.lstatSync(file); }
      catch (error) { if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
      const rel = path.relative(root, file).replace(/\\/g, '/');
      if (opaque(file)) {
        if (!stat.isDirectory()) files.set(rel, opaqueFileState(file));
        return;
      }
      if (stat.isDirectory()) {
        for (const name of fs.readdirSync(file)) {
          if (entryPoints.has(file) && SKIP_DIR_NAMES.has(name)) continue;
          if (name === '.git') continue;
          walk(path.join(file, name));
        }
        return;
      }
      if (!stat.isFile()) throw new Error('Build input is not a regular file');
      const basename = path.basename(file);
      const data = basename === 'build-profile.json5'
        ? JSON.stringify(profiles.get(file) ?? readProfile(file))
        : fs.readFileSync(file);
      const moduleSrcPath = moduleRoots.get(path.dirname(file));
      if (path.basename(file) === 'BuildProfile.ets' && moduleSrcPath &&
          isRebuildableHarBuildProfile(root, moduleSrcPath, data.toString('utf8'), product)) return;
      const intermediate = /^(.+)\/\.test\/([^/]+)\/intermediates\/src\/ohosTest\/(.+)$/.exec(rel);
      if (intermediate && Buffer.isBuffer(data)) {
        const module = moduleRoots.get(path.resolve(root, intermediate[1]));
        if (module && isRebuildableOhosTestIntermediate(root, module, product, intermediate[2], intermediate[3], data, devecoRoot)) return;
      }
      files.set(rel, `${stat.mode & 0o777}:${createHash('sha256').update(data).digest('hex')}`);
      maxMtimeMs = Math.max(maxMtimeMs, stat.mtimeMs);
      if (path.basename(file) === 'oh-package.json5') {
        const manifest = parseProductJson5(data.toString('utf8')) as { dependencies?: Record<string, string> };
        for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
          if (typeof version !== 'string' || !/^(?:@[\w.-]+\/)?[\w.-]+$/.test(name) || name.split('/').some(n => n === '.' || n === '..')) continue;
          const packageRoot = path.dirname(file);
          const dependency = version.startsWith('file:')
            ? path.resolve(packageRoot, version.slice('file:'.length))
            : [packageRoot, root].map(base => path.join(base, 'oh_modules', name)).find(abs => fs.existsSync(abs));
          if (!dependency) continue;
          const actual = fs.realpathSync(dependency);
          if (actual === root || fs.statSync(actual).isDirectory() && !fs.existsSync(path.join(actual, 'oh-package.json5'))) {
            throw new Error('Build dependency is not a declared package');
          }
          files.set(`dependency:${rel}:${name}`, path.relative(root, actual).replace(/\\/g, '/'));
          entryPoints.add(actual);
          walk(actual);
        }
      }
    }

    const bp = profiles.get(profileFile);
    if (!bp) return null;
    const signing = bp.app?.products?.find(item => item.name === product)?.signingConfig;
    if (signing) {
      const selected = bp.app?.signingConfigs?.filter(config => config.name === signing);
      if (selected?.length !== 1 || !selected[0].material) return null;
      for (const property of ['certpath', 'profile', 'storeFile']) {
        const file = selected[0].material[property];
        if (typeof file !== 'string' || !file || /[$%]/.test(file)) return null;
        const abs = path.resolve(root, file);
        if (property === 'storeFile') {
          files.set('signing:storeFile', opaqueFileState(abs));
          continue;
        }
        const real = fs.realpathSync(abs);
        const publicFormat = property === 'certpath' ? /\.(?:cer|crt)$/i : /\.(?:p7b|p7c)$/i;
        if (!publicFormat.test(abs) || opaque(abs) || opaque(real) || !fs.statSync(real).isFile()) return null;
        files.set(`signing:${property}`, createHash('sha256').update(fs.readFileSync(real)).digest('hex'));
      }
    }
    for (const entry of new Set([...ROOT_BUILD_INPUTS.map(p => path.join(root, p)), ...moduleRoots.keys(), ...outerLayerRoots(root)])) {
      if (entry === root || !entry.startsWith(root + path.sep)) return null;
      walk(entry, true);
    }
    const hvigorConfig = loadFrameworkConfig(root).toolchain?.hvigor;
    const environment = describeHvigorEnvironment(buildChildEnv(root), root);
    const dimensions = [product, buildMode, hvigorConfig, devecoRoot, environment];
    const sorted = [...files].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return { sha256: createHash('sha256').update(JSON.stringify([dimensions, sorted])).digest('hex'), maxMtimeMs };
  } catch { return null; }
}

export function evaluateDeviceTestBuildReuse(opts: DeviceTestBuildReuseInput): DeviceTestBuildReuseDecision {
  const resolvedProduct = opts.product;
  const resolvedBuildMode = resolveDeviceTestBuildMode(opts.buildMode);
  const snapshot = snapshotDeviceTestBuildInputs(opts.projectRoot, resolvedProduct, resolvedBuildMode);
  const inputsMaxMtimeMs = snapshot?.maxMtimeMs ?? 0;
  const discovery = discoverAppHapArtifacts(opts.projectRoot, resolvedProduct);
  const candidate = discovery.signedPath;
  const validation = candidate ? detectStaleSignedSuspect(candidate) : undefined;
  const sha = validation?.status === 'valid' ? computeHapSha256Full(candidate) : null;
  const hapMtimeMs = validation?.signedMtimeMs ?? null;
  let prior: Record<string, unknown> | null = null;
  try {
    if (opts.reportDir) prior = JSON.parse(fs.readFileSync(path.join(opts.reportDir, DEVICE_TEST_BUILD_RESULT), 'utf-8'));
  } catch { /* A legacy or missing record cannot attest to current input content. */ }
  const sameBuild = candidate && prior?.buildSucceeded === true && prior.resolvedProduct === resolvedProduct &&
    prior.resolvedBuildMode === resolvedBuildMode && typeof prior.hapPath === 'string' &&
    path.resolve(prior.hapPath) === path.resolve(candidate);
  const sameInputs = snapshot && sameBuild && prior?.buildInputsSha256 === snapshot.sha256;
  const base: DeviceTestBuildReuseDecision = {
    reuse: false, reason: '', hapPath: validation?.status === 'valid' ? candidate : null,
    hapMtimeMs, hapBuiltAt: hapMtimeMs === null ? null : new Date(hapMtimeMs).toISOString(),
    inputsMaxMtimeMs, resolvedProduct, resolvedBuildMode,
    buildInputsSha256: snapshot?.sha256,
    forceFullBuild: Boolean(candidate && (!sameInputs || !sha || prior?.hapSha256Full !== sha)),
    scannedDirs: discovery.scannedDirs, candidates: discovery.candidates,
    artifactValidation: validation,
    staleSuspect: validation?.staleSuspect,
    staleSuspectUnsignedPath: validation?.unsignedPath,
    staleSuspectNote: validation?.note,
  };
  const reject = (reason: string): DeviceTestBuildReuseDecision => ({ ...base, reason });
  if (envForceBuild()) return reject('HARNESS_DEVICE_TEST_FORCE_BUILD 已设置，强制执行 hvigor');
  if (!candidate) return reject('所选 product 未找到 signed 主 HAP');
  if (validation?.status !== 'valid') return reject(validation?.note ?? '配对产物未通过验证');
  if (!snapshot) return reject('构建输入未能完整核实，需执行构建');
  if (!prior) return reject('当前成功构建记录缺失或不可读，需执行构建');
  if (!sameBuild) {
    return reject('原成功构建记录与当前包路径/product/buildMode 不匹配，需执行构建');
  }
  if (!sha || prior.hapSha256Full !== sha) return reject('当前包内容摘要与原成功构建记录不匹配，需执行构建');
  if (!sameInputs) return reject('构建输入内容变化或原记录缺少内容摘要，需执行构建');
  return { ...base, reuse: true, hapSha256Full: sha, priorResult: prior,
    reason: '已核对当前报告的成功记录、包路径/内容摘要、product/buildMode、源码新鲜度及配对产物，复用已有包' };
}
