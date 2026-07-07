# `hmos-app` · Skill `framework-init` profile addendum

本 profile 初始化时预期落地 **宿主 ArkTS/HarmonyOS 风格**的工程元数据：`architecture` 五外层 + 模块内四层、`paths` 指向 `doc/` 下 SSOT、harness toolchain 段落常含 **DevEco / hvigor** 占位。

## 权威资产清单

| 用途 | 路径 |
|------|------|
| Profile 能力与 phase overlay 注册 | `framework/profiles/hmos-app/profile.yaml` |
| 各 Skill 模板/参考（含 3/5 等） | `framework/profiles/hmos-app/skills/` |
| Skill 资产机器清单（`profile-skill-asset:` 解析） | `framework/profiles/hmos-app/skills/skill-assets.yaml` |
| AGENTS 入口 SSOT/guardrail 片段 | `framework/profiles/hmos-app/templates/agents-md/*.partial.md` |
| init 缺省 doc 骨架（architecture / module-catalog） | `framework/profiles/hmos-app/doc-skeletons/` |

### skill-assets.yaml 键

本 skill 的 asset 键与相对路径**唯一声明**在机器清单 `framework/profiles/hmos-app/skills/skill-assets.yaml`（`assets.framework-init` 段）。根 `SKILL.md` 用 `` `profile-skill-asset:framework-init/<键>` `` 引用，解析规则见 `framework/skills/README.md` 的 “Profile skill asset protocol”。**本 addendum 不再罗列键与路径**，以清单为单一真相（SSOT），避免散文与清单漂移。

### 示例（仅在 hmos-app 下）

根 `framework/skills/project/framework-init/SKILL.md` 为保持 profile-neutral 已不在正文展开的 **宿主 IDE / hvigor 路径、`preset-5-layer` 宿主 shaped 示例** 等，均以本 addendum **「Personal setup · DevEco 路径（hmos-app）」** 与上表 **权威资产清单** 为准；**工具链路径改由阶段 `--ensure` 内联 personal setup 写入 `framework.local.json`**（registry `setup.deveco_path`）。

`/framework-init`：**S3 写入 `framework.config.json` 须早于 adapter 拷贝与 `render-agents-md`** —— config 落盘后 `render-agents-md.mjs` 才能读取磁盘 JSON 与 partial 对齐。模板侧仍须走 `render-agents-md.mjs`，使 partial 与生成的入口 Markdown 对齐。

---

## Personal setup · DevEco 路径（hmos-app）

> **背景**：自 framework v2.3 起，编码阶段真实编译门禁（canonical：`coding_compile`，历史别名 `coding_hvigor_build`）与业务级 UT 阶段（`ut_compile` / `ut_run` 及历史别名 `ut_hvigor_build` / `ut_hvigor_test`）引入 BLOCKER 规则，**强依赖** DevEco Studio 自带的 hvigor / sdk / jbr 工具链。**现代 DevEco Studio (≥ 5.0) 不再在工程根生成 `hvigorw.bat` 包装脚本**，统一从安装目录调用，因此 framework 必须知道 DevEco 装在哪里。
>
> 本段目标：在 **`framework.local.json`** 写入合法的 `toolchain.devEcoStudio.installPath`，使上述 harness 规则不会因"找不到 hvigor"而 BLOCKER FAIL。

### 幂等检测

**按 personal setup / planner `detect-deveco` 任务结果执行**（项目 init 不再写 installPath）：

- `POPULATED`（local 已有 installPath 且文件系统存在）→ **跳过本节**，直接进入后续 phase。
- `MISSING` / `EMPTY` → 继续自动探测。

### 自动探测候选路径

执行：

```bash
cd <repo-root> && npx ts-node framework/harness/scripts/detect-deveco.ts --json
```

（若 shell cwd 仍在 `framework/harness/`（例如刚跑完 init），可改用：`npx ts-node scripts/detect-deveco.ts --json`。详见 [harness-cli-cwd.md](../../../../skills/reference/harness-cli-cwd.md)。）

`detect-deveco.ts` 会按平台扫描常见安装位置（Windows：`D:/Program Files/Huawei/DevEco Studio` 等 7 个；macOS：`/Applications/DevEco-Studio.app/Contents` 等；Linux：`/opt/deveco-studio` 等），对每个候选验证 `tools/hvigor/bin/hvigorw[.bat]` / `sdk/` / `jbr/bin/java[.exe]` 三个关键子目录是否齐全。

输出 JSON 形态：

```json
{
  "recommended": {
    "status": "ok",
    "source": "scan",
    "installPath": "D:/Program Files/Huawei/DevEco Studio",
    "hvigorBin": "...hvigorw.bat",
    "sdkHome": "...sdk",
    "jbrHome": "...jbr",
    "missing": []
  },
  "candidates": [ "..." ]
}
```

### 用户确认（**BLOCKER** · 个人 setup · registry `setup.deveco_path` · [user-confirmation-ux.md](../../../../skills/reference/user-confirmation-ux.md)）

> **职责变更（编排化重构）**：宿主 IDE 安装路径**不再**写入 `framework.config.json`；改由 **阶段 `--ensure` 内联（framework-initb 过程）** 写入 gitignored 的 `framework.local.json` → `toolchain.devEcoStudio.installPath`。

按 `detect-deveco.ts` 探测结果，在 **personal setup 内联 S2** 使用 registry **`setup.deveco_path`**（**仅**「采用探测路径 / 跳过」枚举；**禁止**对话收自由路径字符串）：

1. **recommended.status === 'ok'** → 展示推荐路径 + `setup.deveco_path` widget（采用探测 / 跳过）。
2. **无 ok 候选** → 列出 `candidates` 状态供参考；提示用户修正本机安装或手工编辑 `framework.local.json` 后重跑 setup（**不在对话收路径字符串**）。
3. **跳过** → 不写入 local；编码/UT phase 可能因缺 toolchain 而 FAIL，摘要须提示补跑 setup。

项目级 **`/framework-init` 不再执行本节**；hmos-app 工程在首次跑 feature phase 前须完成个人 setup。

**不允许 AI 替用户臆测**：即便 IDE 环境变量里有 `DEVECO_STUDIO_HOME` 之类痕迹也只能作为**推荐值**亮给用户，不得直接当作用户决定。

### 用户选择"跳过"时的警示

若用户明确不想配置（多见于：仅做 spec/plan/glossary 阶段，不准备跑需 hvigor 的阶段），**允许跳过**，但必须打印以下警示到 S4 摘要的"被跳过项汇报"中：

```text
toolchain.devEcoStudio.installPath（用户跳过，未配置）
  影响：以下 v2.3 BLOCKER 规则将无法通过：
    - coding_compile（编码阶段必跑 hvigor assembleApp）
    - ut_compile    （UT 阶段必跑 hvigor genOnDeviceTestHap）
    - ut_run        （UT 阶段必跑 hdc install + aa test，需要 DevEco SDK 提供 hdc）
  跑这些阶段前请补跑 personal setup 或手工编辑 framework.local.json 补齐 toolchain.devEcoStudio.installPath。
```

### 写入 `framework.local.json` 的 `toolchain` 段

最终落盘形态（与 [`framework/harness/config.ts`](../../../../harness/config.ts) `ToolchainConfig` 对齐）：

```json
{
  "toolchain": {
    "devEcoStudio": {
      "installPath": "D:/Program Files/Huawei/DevEco Studio",
      "hvigorBin": ""
    },
    "hvigor": {
      "daemon": true,
      "parallel": true,
      "incremental": true,
      "analyze": "advanced"
    }
  }
}
```

字段说明：

- `installPath`（必填）：DevEco Studio 安装根目录。`hvigor-runner.ts` 会从这里派生 hvigor 路径、`DEVECO_SDK_HOME`、`JAVA_HOME`、JBR `bin` 加 PATH。
- `hvigorBin`（可选）：显式指定 hvigor 可执行文件路径。仅当 DevEco 内部目录结构异于约定（`<installPath>/tools/hvigor/bin/hvigorw[.bat]`）时使用；空串视为不指定。
- `hvigor`（可选对象）：hvigor 命令行调优开关。各子字段说明见 [`framework/templates/framework.config.template.json`](../../../../templates/framework.config.template.json) 的 `$schema_docs.field_notes.toolchain.hvigor.*`。不写时 [`hvigor-runner.ts`](../../harness/hvigor-runner.ts) 内部 `DEFAULT_HVIGOR_OPTIONS` 兜底（与此处默认值一致），但**显式写入有利于工程方一眼看到旋钮**。

> 路径分隔符：写入时**统一用 POSIX 正斜杠 `/`**。`hvigor-runner.ts` 内部已处理 Windows 反斜杠/带空格路径的 quoting。

### 宿主包管理备注（ohpm）

实例工程侧 `oh_modules/` 由 coding harness 在编译失败且判定为「声明齐全、仅未安装」时，经 profile `coding.deps_install`（ohpm provider）**自动**执行 `ohpm install` 并重编译；**不在 framework-init 代管**，也**不应**交给用户手工安装（除非 ohpm 安装本身因 registry/鉴权/网络失败）。

---

## 实例 `.gitignore` 可选追加（非 framework canonical）

全局 canonical 由 `check-init` → `ensureCanonicalGitignore` 自动维护（S3 `ensure-gitignore` 任务）。**hmos-app** 工程在真机自动化 / 本机差异较大时，可在用户确认后**额外**追加（脚本不会自动写入、也不会删除）：

| pattern | 说明 |
| --- | --- |
| `/reports/` | Hylyre/Hypium 曾以**工程根**为 cwd 时落盘的 task 日志；现代 harness 已将 hypium cwd 定向到 `<features_dir>/<feature>/testing/reports/.hypium-workdir/`（已落在 `<features_dir>/*/*/reports/*` 内），根目录 `/reports/` 多为历史遗留 |
| `/build-profile.json5` | 本机 product/SDK 与 CI 不一致时的个人 build-profile；需单独提交时再移出 ignore |

**勿**用 `/harness/reports/*` 代替 `framework/harness/reports/*`（路径错误，无法忽略 harness 全局报告）。
