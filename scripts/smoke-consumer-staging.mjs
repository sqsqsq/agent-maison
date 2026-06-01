#!/usr/bin/env node
// smoke-consumer-staging.mjs — 可选：模拟消费者 init 后环境，验证发布件 npm test (= check:global)
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { packRelease } from './pack-release.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const MODULE_CATALOG_YAML = `schema_version: "1.0"
modules: []
`;

const GLOSSARY_YAML = `schema_version: "1.0"
terms: []
`;

const FRAMEWORK_CONFIG_JSON = `{
  "schema_version": "1.1",
  "project_profile": {
    "name": "generic"
  }
}
`;

/** @param {string} msg */
function fail(msg) {
  throw new Error(msg);
}

/** @param {string[]} args @param {import('child_process').SpawnSyncOptionsWithStringEncoding} options */
function npmSpawnSync(args, options) {
  if (process.platform === 'win32') {
    const command = ['npm', ...args].join(' ');
    return spawnSync('cmd.exe', ['/d', '/s', '/c', command], {
      ...options,
      shell: false,
    });
  }
  return spawnSync('npm', args, { ...options, shell: false });
}

export async function smokeConsumerStaging() {
  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'am-smoke-pack-'));
  const consumerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-smoke-consumer-'));

  try {
    console.log('[smoke-consumer] staging release...');
    const { stagingRoot } = await packRelease({ dryRun: false, stageOnly: true, outDir: tmpOut });
    if (!stagingRoot || !fs.existsSync(stagingRoot)) {
      fail('packRelease --stage-only did not produce stagingRoot');
    }

    const docDir = path.join(consumerRoot, 'doc');
    fs.mkdirSync(docDir, { recursive: true });
    fs.writeFileSync(path.join(docDir, 'module-catalog.yaml'), MODULE_CATALOG_YAML, 'utf8');
    fs.writeFileSync(path.join(docDir, 'glossary.yaml'), GLOSSARY_YAML, 'utf8');
    fs.writeFileSync(path.join(consumerRoot, 'framework.config.json'), FRAMEWORK_CONFIG_JSON, 'utf8');

    const frameworkDest = path.join(consumerRoot, 'framework');
    fs.cpSync(stagingRoot, frameworkDest, { recursive: true });

    const harnessRoot = path.join(frameworkDest, 'harness');
    console.log('[smoke-consumer] npm install in framework/harness...');
    const install = npmSpawnSync(['install'], {
      cwd: harnessRoot,
      encoding: 'utf-8',
    });
    if (install.error || install.status !== 0) {
      if (install.error) console.error(install.error.message);
      console.error(install.stdout);
      console.error(install.stderr);
      fail(`npm install failed (exit ${install.status ?? 'spawn error'})`);
    }

    console.log('[smoke-consumer] npm test (= check:global)...');
    const test = npmSpawnSync(['test'], {
      cwd: harnessRoot,
      encoding: 'utf-8',
      env: { ...process.env, HARNESS_INIT_INTERNAL_GLOBAL_RUN: '1' },
    });
    if (test.error || test.status !== 0) {
      if (test.error) console.error(test.error.message);
      if (test.stdout) console.log(test.stdout);
      if (test.stderr) console.error(test.stderr);
      fail(`npm test failed (exit ${test.status ?? 'spawn error'})`);
    }
    if (test.stdout) console.log(test.stdout);

    console.log('[smoke-consumer] PASS');
  } finally {
    fs.rmSync(tmpOut, { recursive: true, force: true });
    fs.rmSync(consumerRoot, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  smokeConsumerStaging().catch(err => {
    console.error('[smoke-consumer] FAIL:', err.message);
    process.exit(1);
  });
}
