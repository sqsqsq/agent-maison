import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { loadFrameworkConfig } from '../../config';
import { tryLoadProfileHarnessModule } from '../../profile-host-loader';
import { loadResolvedProfile } from '../../profile-loader';
import { projectImplementationModules, resolveModulePathPrefixes } from './diff-scope';
import { loadCatalog } from './catalog-parser';
import { isInsideProjectRoot, realProjectPath } from './project-relative-path';

export type RequestExecutionPhase = 'compile' | 'ut' | 'testing';

export interface RequestExecutionInputs {
  scope: string[];
  sha256: string;
}

export interface RequestBuildArtifact { path: string; sha256: string; module: string }

type ProfileRequestInputs = {
  readRequestBuildInputs?: typeof readRequestExecutionInputs;
  readRequestCompileHap?(projectRoot: string): RequestBuildArtifact | null;
};

function profileRequestInputs(profileDir: string): ProfileRequestInputs | null | undefined {
  const reader = 'request-build-inputs';
  if (['.ts', '.js'].some(ext => fs.existsSync(path.join(profileDir, 'harness', reader + ext)))) {
    return tryLoadProfileHarnessModule<ProfileRequestInputs>(profileDir, reader);
  }
}

export function readRequestCompileHap(projectRoot: string, profileDir: string): RequestBuildArtifact | null {
  try { return profileRequestInputs(profileDir)?.readRequestCompileHap?.(projectRoot) ?? null; }
  catch { return null; }
}

const projectInputs = ['framework.config.json', 'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
  'tsconfig.json', 'jsconfig.json'];
const generatedDir = /^(?:build|dist|node_modules|oh_modules|coverage|\.git)$/;
const opaqueInput = /(?:^\.(?:env(?:\.|$)|npmrc$|ohpmrc$|netrc$)|(?:^|[_.-])(?:secrets?|credentials?|private[-_.]?key)(?:[_.-]|$)|\.(?:key|pem|pfx|p12|jks|keystore)$)/i;

/** Bounded current input bytes for an existing request execution. Scope never grants writes. */
export function readRequestExecutionInputs(projectRoot: string, frameworkRoot: string, phase: RequestExecutionPhase,
  targets: readonly string[]): RequestExecutionInputs | null {
  try {
    const root = fs.realpathSync(projectRoot);
    const normalize = (file: string) => file.split(path.sep).join('/');
    const resolve = (file: string) => realProjectPath(root, file, 'request execution input');
    const known = [...new Set(targets.map(file => normalize(path.relative(root, resolve(file)))))].sort();
    if (!known.length) return null;
    const profile = loadResolvedProfile(root, loadFrameworkConfig(root), frameworkRoot);
    const host = profileRequestInputs(profile.profileDir);
    if (host?.readRequestBuildInputs) return host.readRequestBuildInputs(root, frameworkRoot, phase, known);
    if (host === null) return null;
    const catalog = loadCatalog(root);
    const named = catalog.ok ? catalog.catalog.modules.map(module => module.name) : [];
    const catalogRoots = resolveModulePathPrefixes(root, named).prefixByModule;
    const modules = projectImplementationModules(root, [...catalogRoots].map(([name, prefix]) => ({ name, package_path: prefix.replace(/\/$/, '') })));
    const scope = new Set<string>();
    for (const file of known) {
      const module = modules.filter(item => file.startsWith(item.package_path + '/')).sort((left, right) => right.package_path.length - left.package_path.length)[0];
      if (module) scope.add(module.package_path);
      else if (!projectInputs.includes(file)) return null;
    }
    if (!scope.size) return null;
    const files = new Map<string, string | null>();
    const physicalFramework = path.resolve(frameworkRoot);
    function read(file: string): void {
      const absolute = path.resolve(root, file);
      const stat = fs.lstatSync(absolute, { throwIfNoEntry: false, bigint: true });
      if (stat?.isSymbolicLink()) throw new Error('无法核验模块内链接的实际构建输入');
      if (absolute !== root && physicalFramework !== root && isInsideProjectRoot(physicalFramework, absolute)) return;
      if (stat?.isDirectory()) {
        for (const name of fs.readdirSync(absolute)) if (!generatedDir.test(name)) read(file + '/' + name);
      } else {
        files.set(file, !stat?.isFile() ? null : opaqueInput.test(path.basename(file))
          ? `metadata:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
          : createHash('sha256').update(fs.readFileSync(resolve(file))).digest('hex'));
      }
    }
    for (const file of projectInputs) read(file);
    for (const dir of scope) {
      resolve(dir);
      read(dir);
    }
    for (const file of known) read(file);
    const roots = [...scope].sort();
    return { scope: roots, sha256: createHash('sha256').update(JSON.stringify([profile.name, roots, [...files].sort(([a], [b]) => a.localeCompare(b))])).digest('hex') };
  } catch { return null; }
}
