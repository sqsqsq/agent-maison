// ============================================================================
// generated-source-classifier.unit.test.ts — 构建生成物分类器（plan d9e4b7c1 T1）
// ============================================================================
//
// 覆盖矩阵（v13 冻结验收）：
//   1. 宿主真实模板形态（bc-openCard 事故三文件同款）→ generated_legit
//   2. 常量值与冻结配置不符（DEBUG/BUILD_MODE/HAR_VERSION/TARGET_NAME）→ not_generated
//   3. 模板外语句 / 类体越界 / 双类块 → not_generated
//   4. 路径不在声明模块根（含嵌套目录伪装）→ not_generated
//   5. removed / type-changed → not_generated（永不降级）
//   6. TARGET_NAME 推导：targets×applyToProducts 唯一命中 / 回落 default / 多义 fail-closed
//   7. 注释措辞漂移容忍（不做字节等值）
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  classifyGeneratedSourceChange,
  parseBuildProfileTemplate,
  deriveExpectedTargetName,
  type FrozenDeviceTestConfig,
} from '../../generated-source-classifier';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function withTmpDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-src-cls-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const HOST_TEMPLATE = `/**
 * Use these variables when you tailor your ArkTS code. They must be of the const type.
 */
export const HAR_VERSION = '1.0.0';
export const BUILD_MODE_NAME = 'debug';
export const DEBUG = true;
export const TARGET_NAME = 'default';

/**
 * BuildProfile Class is used only for compatibility purposes.
 */
export default class BuildProfile {
\tstatic readonly HAR_VERSION = HAR_VERSION;
\tstatic readonly BUILD_MODE_NAME = BUILD_MODE_NAME;
\tstatic readonly DEBUG = DEBUG;
\tstatic readonly TARGET_NAME = TARGET_NAME;
}`;

interface HostOpts {
  targets?: string;
  version?: string;
  content?: string;
}

/** 最小宿主布局：build-profile.json5 + 模块根 oh-package + BuildProfile.ets */
function writeHost(dir: string, opts: HostOpts = {}): void {
  const targets = opts.targets ?? '';
  fs.writeFileSync(
    path.join(dir, 'build-profile.json5'),
    `{
  "app": { "products": [{ "name": "default" }] },
  "modules": [
    { "name": "AccountManager", "srcPath": "./04-BusinessBase/AccountManager"${targets} }
  ]
}`,
    'utf-8',
  );
  const modDir = path.join(dir, '04-BusinessBase', 'AccountManager');
  fs.mkdirSync(modDir, { recursive: true });
  fs.writeFileSync(
    path.join(modDir, 'oh-package.json5'),
    `{ "name": "accountmanager", "version": "${opts.version ?? '1.0.0'}" }`,
    'utf-8',
  );
  fs.writeFileSync(path.join(modDir, 'BuildProfile.ets'), opts.content ?? HOST_TEMPLATE, 'utf-8');
}

const FROZEN_DEBUG: FrozenDeviceTestConfig = { product: 'default', buildMode: 'debug' };
const MOD_REL = '04-BusinessBase/AccountManager/BuildProfile.ets';

export function runAll(): UnitCaseResult[] {
  const cases: UnitCaseResult[] = [];
  const t = (name: string, fn: () => void): void => {
    try {
      fn();
      cases.push({ name, ok: true });
    } catch (e) {
      cases.push({ name, ok: false, error: (e as Error).message });
    }
  };

  t('宿主真实模板形态 → generated_legit', () => {
    withTmpDir(dir => {
      writeHost(dir);
      const r = classifyGeneratedSourceChange(dir, { path: MOD_REL, how: 'modified' }, FROZEN_DEBUG);
      if (r.kind !== 'generated_legit') throw new Error(`expected legit, got ${JSON.stringify(r)}`);
    });
  });

  t('added 同样可降级', () => {
    withTmpDir(dir => {
      writeHost(dir);
      const r = classifyGeneratedSourceChange(dir, { path: MOD_REL, how: 'added' }, FROZEN_DEBUG);
      if (r.kind !== 'generated_legit') throw new Error(JSON.stringify(r));
    });
  });

  t('removed / type-changed 永不降级', () => {
    withTmpDir(dir => {
      writeHost(dir);
      for (const how of ['removed', 'type-changed'] as const) {
        const r = classifyGeneratedSourceChange(dir, { path: MOD_REL, how }, FROZEN_DEBUG);
        if (r.kind !== 'not_generated') throw new Error(`${how} 不应降级`);
      }
    });
  });

  t('DEBUG 与冻结 buildMode 不符 → not_generated', () => {
    withTmpDir(dir => {
      writeHost(dir, { content: HOST_TEMPLATE.replace('export const DEBUG = true;', 'export const DEBUG = false;') });
      const r = classifyGeneratedSourceChange(dir, { path: MOD_REL, how: 'modified' }, FROZEN_DEBUG);
      if (r.kind !== 'not_generated') throw new Error('DEBUG 翻转应判违规');
    });
  });

  t('BUILD_MODE_NAME=release 但冻结 debug → not_generated；冻结 release 则 legit', () => {
    withTmpDir(dir => {
      const releaseContent = HOST_TEMPLATE
        .replace("export const BUILD_MODE_NAME = 'debug';", "export const BUILD_MODE_NAME = 'release';")
        .replace('export const DEBUG = true;', 'export const DEBUG = false;');
      writeHost(dir, { content: releaseContent });
      const r1 = classifyGeneratedSourceChange(dir, { path: MOD_REL, how: 'modified' }, FROZEN_DEBUG);
      if (r1.kind !== 'not_generated') throw new Error('冻结 debug 时 release 产物应判违规');
      const r2 = classifyGeneratedSourceChange(
        dir, { path: MOD_REL, how: 'modified' }, { product: 'default', buildMode: 'release' },
      );
      if (r2.kind !== 'generated_legit') throw new Error(`冻结 release 时应 legit：${JSON.stringify(r2)}`);
    });
  });

  t('HAR_VERSION 与模块 oh-package 不符 → not_generated', () => {
    withTmpDir(dir => {
      writeHost(dir, { version: '2.3.4' });
      const r = classifyGeneratedSourceChange(dir, { path: MOD_REL, how: 'modified' }, FROZEN_DEBUG);
      if (r.kind !== 'not_generated') throw new Error('版本不符应判违规');
    });
  });

  t('模板外语句 → not_generated（额外代码是风险面）', () => {
    withTmpDir(dir => {
      writeHost(dir, { content: `${HOST_TEMPLATE}\nexport const EXTRA = 'x';` });
      const r1 = classifyGeneratedSourceChange(dir, { path: MOD_REL, how: 'modified' }, FROZEN_DEBUG);
      if (r1.kind !== 'not_generated') throw new Error('多余 const 应判违规');
      writeHost(dir, { content: `${HOST_TEMPLATE}\nconsole.log('hi');` });
      const r2 = classifyGeneratedSourceChange(dir, { path: MOD_REL, how: 'modified' }, FROZEN_DEBUG);
      if (r2.kind !== 'not_generated') throw new Error('残留语句应判违规');
    });
  });

  t('半写/截断文件 → not_generated（tree-kill 边缘 fail-closed）', () => {
    withTmpDir(dir => {
      writeHost(dir, { content: HOST_TEMPLATE.slice(0, Math.floor(HOST_TEMPLATE.length / 2)) });
      const r = classifyGeneratedSourceChange(dir, { path: MOD_REL, how: 'modified' }, FROZEN_DEBUG);
      if (r.kind !== 'not_generated') throw new Error('截断内容应判违规');
    });
  });

  t('路径不在声明模块根（嵌套目录伪装）→ not_generated', () => {
    withTmpDir(dir => {
      writeHost(dir);
      const nested = path.join(dir, '04-BusinessBase', 'AccountManager', 'src', 'fake');
      fs.mkdirSync(nested, { recursive: true });
      fs.writeFileSync(path.join(nested, 'oh-package.json5'), '{ "version": "1.0.0" }', 'utf-8');
      fs.writeFileSync(path.join(nested, 'BuildProfile.ets'), HOST_TEMPLATE, 'utf-8');
      const r = classifyGeneratedSourceChange(
        dir,
        { path: '04-BusinessBase/AccountManager/src/fake/BuildProfile.ets', how: 'added' },
        FROZEN_DEBUG,
      );
      if (r.kind !== 'not_generated') throw new Error('嵌套目录不得进例外');
    });
  });

  t('TARGET_NAME：applyToProducts 唯一命中推导目标名', () => {
    withTmpDir(dir => {
      const targets = ', "targets": [{ "name": "prodTarget", "applyToProducts": ["prodA"] }, { "name": "default" }]';
      writeHost(dir, {
        targets,
        content: HOST_TEMPLATE.replace("export const TARGET_NAME = 'default';", "export const TARGET_NAME = 'prodTarget';"),
      });
      const frozen: FrozenDeviceTestConfig = { product: 'prodA', buildMode: 'debug' };
      const r = classifyGeneratedSourceChange(dir, { path: MOD_REL, how: 'modified' }, frozen);
      if (r.kind !== 'generated_legit') throw new Error(`唯一命中应 legit：${JSON.stringify(r)}`);
      const rWrong = classifyGeneratedSourceChange(dir, { path: MOD_REL, how: 'modified' }, FROZEN_DEBUG);
      // frozen product=default 未命中 applyToProducts → 回落 default 目标；文件写 prodTarget → 不符
      if (rWrong.kind !== 'not_generated') throw new Error('目标名与推导不符应判违规');
    });
  });

  t('TARGET_NAME：多义（两目标同 applyToProducts）→ fail-closed', () => {
    withTmpDir(dir => {
      const targets =
        ', "targets": [{ "name": "t1", "applyToProducts": ["p"] }, { "name": "t2", "applyToProducts": ["p"] }]';
      writeHost(dir, { targets });
      const expect = deriveExpectedTargetName(dir, '04-BusinessBase/AccountManager', 'p');
      if (expect !== null) throw new Error(`多义应返回 null，得到 ${expect}`);
      const r = classifyGeneratedSourceChange(
        dir, { path: MOD_REL, how: 'modified' }, { product: 'p', buildMode: 'debug' },
      );
      if (r.kind !== 'not_generated') throw new Error('多义推导应 fail-closed');
    });
  });

  t('注释措辞漂移容忍（不做字节等值）', () => {
    withTmpDir(dir => {
      const drifted = HOST_TEMPLATE
        .replace('Use these variables when you tailor your ArkTS code. They must be of the const type.', 'Generated by hvigor. Do not edit.')
        .replace('BuildProfile Class is used only for compatibility purposes.', 'compat shim');
      writeHost(dir, { content: drifted });
      const r = classifyGeneratedSourceChange(dir, { path: MOD_REL, how: 'modified' }, FROZEN_DEBUG);
      if (r.kind !== 'generated_legit') throw new Error(`注释漂移应容忍：${JSON.stringify(r)}`);
    });
  });

  t('退役回归：init addendum 不得再承载宿主 .gitignore 指引（plan 33714d0c）', () => {
    // 原用例强制该 addendum 保留一段宿主 `.gitignore` 追加/建议指引。宿主 SCM 配置
    // 不属于 Maison 契约，该段已整体删除；这里翻成反向断言，防止换名重生。
    // 生成物误伤的真实防线是本套件其余用例背书的分类器本身，与忽略规则无关。
    const addendum = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'skills', 'framework-init', 'profile-addendum.md'),
      'utf-8',
    );
    if (/gitignore/i.test(addendum)) {
      throw new Error('init addendum 不得再出现宿主 gitignore 指引（含改名后的"可选建议"形态）');
    }
  });

  t('parseBuildProfileTemplate：双类块 / 类体成员错位 → null', () => {
    const twoClasses = `${HOST_TEMPLATE}\nexport default class BuildProfile { }`;
    if (parseBuildProfileTemplate(twoClasses) !== null) throw new Error('双类块应判 null');
    const crossed = HOST_TEMPLATE.replace(
      'static readonly HAR_VERSION = HAR_VERSION;',
      'static readonly HAR_VERSION = DEBUG;',
    );
    if (parseBuildProfileTemplate(crossed) !== null) throw new Error('成员映射错位应判 null');
  });

  t('兼容类成员必须四个齐全：空类 / 缺一个成员 → not_generated（review P1）', () => {
    withTmpDir(dir => {
      // 空兼容类：顶层四常量正确也不得降级（删兼容 API 可能改变编译/消费行为）
      const emptyClass = HOST_TEMPLATE.replace(
        /export default class BuildProfile \{[\s\S]*\}/,
        'export default class BuildProfile {\n}',
      );
      writeHost(dir, { content: emptyClass });
      const r1 = classifyGeneratedSourceChange(dir, { path: MOD_REL, how: 'modified' }, FROZEN_DEBUG);
      if (r1.kind !== 'not_generated') throw new Error('空兼容类应判违规');
      // 缺一个成员
      const missingOne = HOST_TEMPLATE.replace('\tstatic readonly TARGET_NAME = TARGET_NAME;\n', '');
      writeHost(dir, { content: missingOne });
      const r2 = classifyGeneratedSourceChange(dir, { path: MOD_REL, how: 'modified' }, FROZEN_DEBUG);
      if (r2.kind !== 'not_generated') throw new Error('缺成员应判违规');
    });
  });

  return cases;
}
