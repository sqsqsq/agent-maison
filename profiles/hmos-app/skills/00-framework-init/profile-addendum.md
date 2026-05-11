# `hmos-app` · Skill `00-framework-init` profile addendum

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

| 键 | 相对 `skills/00-framework-init/` |
|----|-------------------------------------|
| `preset_5_layer_sample` | `templates/preset-5-layer.sample.json` |

### 示例（仅在 hmos-app 下）

根 `framework/skills/00-framework-init/SKILL.md` 为保持 profile-neutral 已不在正文展开的 **DevEco / hvigor 路径、`framework.config.json` 工具链字段、`preset-5-layer` 宿主 shaped 示例** 等，均以本 addendum **「工具链路径配置（Step 5.6，hmos-app）」** 与上表 **权威资产清单** 为准；执行 `/framework-init` 时结合 Step 0.3 体检结果与用户对 `installPath` 的显式确认。

`/framework-init` 写入 **`framework.config.json` 前应已声明或默认 `project_profile.name: hmos-app`**（或由用户显式选其它 profile）；渲染 `AGENTS.md.template` **必须**走 `render-agents-md.mjs`，使上述 partial 与生成的入口 Markdown 对齐。

---

## 工具链路径配置（Step 5.6，hmos-app）

> **背景**：自 framework v2.3 起，编码阶段真实编译门禁（canonical：`coding_compile`，历史别名 `coding_hvigor_build`）与业务级 UT 阶段（`ut_compile` / `ut_run` 及历史别名 `ut_hvigor_build` / `ut_hvigor_test`）引入 BLOCKER 规则，**强依赖** DevEco Studio 自带的 hvigor / sdk / jbr 工具链。**现代 DevEco Studio (≥ 5.0) 不再在工程根生成 `hvigorw.bat` 包装脚本**，统一从安装目录调用，因此 framework 必须知道 DevEco 装在哪里。
>
> 本步骤的目标：在 `framework.config.json` 写入合法的 `toolchain.devEcoStudio.installPath`，使上述 harness 规则不会因"找不到 hvigor"而 BLOCKER FAIL。

### 5.6.1 幂等检测

**按 Step 0.3 第 10 项体检结果执行**：

- `POPULATED`（已有 installPath 且文件系统存在）→ **跳过本节**，直接进入 Step 6。
- `MISSING` / `EMPTY` → 继续 5.6.2。

### 5.6.2 自动探测候选路径

执行：

```bash
npx ts-node framework/harness/scripts/detect-deveco.ts --json
```

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

### 5.6.3 用户确认（**BLOCKER**）

按探测结果分三种情况，**严禁未经用户显式回复就落盘 `installPath`**（与根 SKILL Step 0.2.5 / Step 3.x 同等纪律）：

1. **recommended.status === 'ok'**：
   把 `recommended.installPath` 作为**推荐值**展示给用户，并提示一句：
   > 已探测到 DevEco Studio 在 `<path>`，hvigor / sdk / jbr 子目录齐全。是否使用此路径？(y / 自定义路径 / 跳过)
   - 用户回 `y` → 写入 `framework.config.json > toolchain.devEcoStudio.installPath = <path>`。
   - 用户回**自定义路径字符串** → 用 `npx ts-node framework/harness/scripts/detect-deveco.ts --path "<user-path>" --json` 验证，命中 `status === 'ok'` 才写入；`incomplete` / `not_found` 把 `missing[]` 列给用户重选。
   - 用户回 `跳过` → 不写入；进入 5.6.4 警示。

2. **recommended 不存在 / status !== 'ok'**：
   把所有 `candidates` 的 `[status] installPath` 列给用户参考，提示：
   > 未在常见路径找到完整的 DevEco Studio 安装。请提供 installPath（DevEco Studio 安装根目录，下面应当能看到 `tools/hvigor` / `sdk` / `jbr` 三个子目录），或回复 `跳过`。
   收到自定义路径后走第 1 种的"自定义路径"分支验证。

3. **不允许 AI 替用户臆测**：即便 IDE 环境变量里有 `DEVECO_STUDIO_HOME` 之类痕迹也只能作为**推荐值**亮给用户，不得直接当作用户决定。

### 5.6.4 用户选择"跳过"时的警示

若用户明确不想配置（多见于：仅做 PRD/design/glossary 阶段，不准备跑需 hvigor 的阶段），**允许跳过**，但必须打印以下警示到 Step 7 收尾的"被跳过项汇报"中：

```text
toolchain.devEcoStudio.installPath（用户跳过，未配置）
  影响：以下三条 v2.3 BLOCKER 规则将无法通过：
    - coding_hvigor_build（编码阶段必跑 hvigor assembleApp）
    - ut_hvigor_build    （UT 阶段必跑 hvigor genOnDeviceTestHap）
    - ut_hvigor_test     （UT 阶段必跑 hdc install + aa test，需要 DevEco SDK 提供 hdc）
  跑这些阶段前请手工编辑 framework.config.json 补齐 toolchain.devEcoStudio.installPath。
```

### 5.6.5 写入 `framework.config.json` 的 `toolchain` 段

最终落盘形态（与 [`framework/harness/config.ts`](../../../../harness/config.ts) `ToolchainConfig` 对齐）：

```json
{
  "toolchain": {
    "devEcoStudio": {
      "installPath": "D:/Program Files/Huawei/DevEco Studio",
      "hvigorBin": ""
    }
  }
}
```

字段说明：

- `installPath`（必填）：DevEco Studio 安装根目录。`hvigor-runner.ts` 会从这里派生 hvigor 路径、`DEVECO_SDK_HOME`、`JAVA_HOME`、JBR `bin` 加 PATH。
- `hvigorBin`（可选）：显式指定 hvigor 可执行文件路径。仅当 DevEco 内部目录结构异于约定（`<installPath>/tools/hvigor/bin/hvigorw[.bat]`）时使用；空串视为不指定。

> 路径分隔符：写入时**统一用 POSIX 正斜杠 `/`**。`hvigor-runner.ts` 内部已处理 Windows 反斜杠/带空格路径的 quoting。

### 宿主包管理备注（ohpm）

实例工程侧 `ohpm install`（`oh_modules/`）是 ArkTS 源码依赖，由 DevEco / Skill 3 编码阶段负责触发，**不在 framework-init 代管**。
