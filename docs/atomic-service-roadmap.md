# 元服务（AtomicService）扩展路线图

> 本文档为 framework 的**占位路线图**——阶段 7 仅预留扩展位（`project_type: atomic_service`、
> catalog `format: AtomicService`），**不落地任何差异化规则**。本页面列出未来独立议题
> 要做的检查 / 约束，当对应议题启动时，再分别加入 `framework/specs/phase-rules/*.yaml`
> 与 `framework/harness/scripts/check-*.ts`。

---

## 一、当前状态（阶段 7 已落地）

| 扩展位 | 位置 | 现状 |
|--------|------|------|
| 项目类型 | `framework.config.json → project_type` | 合法值 `app` / `atomic_service`，仅记录，不驱动行为 |
| 模块形态 | `doc/module-catalog.yaml → modules[].format` | 合法值 `HAP` / `HAR` / `HSP` / `AtomicService`；HSP 与 HAR 同为 library format；AtomicService 通过 `format_value_valid` 检查，但不触发差异化校验 |
| agent 入口 | `framework/templates/AGENTS.md.template` | 标题支持 `{{PROJECT_TYPE_LABEL}}` 占位符，由初始化 Skill 按 `project_type` 选择「应用工程 / 元服务工程」 |
| 架构 DSL | `framework.config.json → architecture` | 与 `project_type` 解耦——元服务 / 应用共用同一套外层 / 内层模型 |

**阶段 7 明确不做的事：**

- 不新增差异化的 phase-rules（首包大小、分包、免安装入口等规则暂缓）
- 不改 `check-*.ts` 的行为分支（`project_type === 'atomic_service'` 不触发任何额外路径）
- 不修改 catalog-bootstrap~6 的流程（元服务与应用走同一套 catalog / glossary / PRD / design / coding / review / UT / testing）

---

## 二、未来差异化议题清单（待启动）

以下议题按**独立议题**推进，每一条落地时需要新增 rules + check 脚本 + SKILL.md 配套段落。
触发时机由业务需求决定，不设强制顺序。

### 2.1 首包大小校验（Install-Free Size）

- **约束来源**：元服务免安装入口的首包 HAP 必须 ≤ 10 MB（HarmonyOS 官方要求，具体阈值以版本为准）。
- **落地位置**：
  - `framework/specs/phase-rules/coding-rules.yaml` 新增 `atomic_service_first_hap_size` 规则（仅当 `project_type === 'atomic_service'` 时生效）
  - `framework/harness/scripts/check-coding.ts` 读打包产物（`build/default/outputs/default/*.hap`）的字节数，超阈值报 BLOCKER
- **待定**：阈值由配置项覆盖（例如 `framework.config.json → atomic_service.max_first_hap_bytes`）

### 2.2 分包策略（Dynamic Feature Split）

- **约束来源**：元服务超过首包阈值时必须拆为入口 HAP + 功能 HSP/HAR；入口 HAP 不得 import 非首包的业务代码。
- **落地位置**：
  - `coding-rules.yaml` + `check-coding.ts`：扫描入口 HAP 的 `import` 图，检测是否跨越首包边界
  - `framework.config.json → atomic_service.entry_modules[]` 声明哪些模块属于首包
- **依赖**：2.1 落地后更有意义（先知道阈值超了才需要强拆）

### 2.3 免安装入口限制

- **约束来源**：元服务必须声明至少一个免安装能力（UIAbility / ExtensionAbility），且 `module.json5` 的 `deliveryWithInstall: true` / `installationFree: true` 组合合法。
- **落地位置**：
  - `coding-rules.yaml` 新增 `atomic_service_entry_ability_declared`
  - `check-coding.ts` 解析 `module.json5`，断言入口能力声明正确

### 2.4 API 能力裁剪

- **约束来源**：元服务免安装运行时能调用的系统 API 是 App 的子集（部分权限 / 后台能力受限）。
- **落地位置**：
  - `framework/profiles/<宿主 project_profile>/skills/coding/reference/` 新增 `atomic-service-api-allowlist.md`（白名单文档；无专用 profile 时放 `generic` 或新建子 profile）
  - `check-coding.ts` 扫描 `import` + API 调用，命中黑名单报 BLOCKER

### 2.5 资源本地化与体积压缩

- **约束来源**：元服务对 `resources/` 下的图片 / 字符串 / 多语言资源体积敏感；
  建议统一使用 WebP / SVG、压缩大图、按需拆多语言包。
- **落地位置**：
  - `coding-rules.yaml` 增加资源体积扫描（MAJOR / WARN 级别）
  - `check-coding.ts` 按扩展名汇总总大小与单文件最大值

### 2.6 权限清单收敛

- **约束来源**：元服务可申请的权限子集更窄；`module.json5 → requestPermissions` 若出现
  App 独占权限（如常驻后台 / 高敏感硬件）应当报错。
- **落地位置**：`check-coding.ts` 比对 `requestPermissions` 与 `atomic-service-permission-allowlist.yaml`。

### 2.7 冷启动性能门禁

- **约束来源**：免安装入口对冷启动时延敏感（需控制首屏可交互时间）。
- **落地位置**：
  - device-testing（真机测试）新增可选脚本，读系统日志 / trace，输出冷启动指标
  - `testing-rules.yaml` 增加 `cold_start_budget_ms`（可配置阈值）

---

## 三、实施建议

1. **先改 catalog 再改 coding**：任何差异化议题启动时，先在 `doc/module-catalog.yaml`
   的相关模块上把 `format` 改成 `AtomicService`；`check-catalog.ts` 会自动识别。
2. **`project_type === 'atomic_service'` 是门禁开关**：所有差异化规则都应在
   `check-*.ts` 开头先判断本工程 `project_type`，非元服务工程直接跳过对应 check，
   避免把 App 工程误拦。
3. **阈值可配**：凡是涉及数字阈值（首包大小、资源体积、启动时长等），都通过
   `framework.config.json → atomic_service.*` 暴露，默认值写 framework 内 fallback。
4. **示例工程**：当至少两条议题落地后，建议在 framework 仓库里追加一个
   **最小元服务示例**（`examples/atomic-service-demo/`），作为回归基线。

---

## 四、与其它模块的关系

| framework 侧资产 | 与元服务议题的关系 |
|------------------|------------------|
| `framework/harness/config.ts` → `FrameworkConfig.project_type` | 所有差异化 check 都先读这里判断是否启用 |
| `framework/templates/framework.config.template.json` | 新增差异化阈值时同步更新示例 |
| `framework/templates/AGENTS.md.template` | `{{PROJECT_TYPE_LABEL}}` 已预留，新增议题需求更细文案时在此扩展 |
| `framework/skills/project/framework-init/SKILL.md` | 初始化时问 `project_type`，可提示用户「元服务会有额外阈值」 |
| `framework/skills/feature/coding/` | 议题 2.1～2.6 主要在编码阶段守门 |
| `framework/skills/feature/device-testing/` | 议题 2.7 依赖真机测试数据 |

---

## 五、变更记录

- **阶段 7（首次预留）**：新增 `project_type: atomic_service` 与 `format: AtomicService` 扩展位；
  不实现任何差异化规则。本文件为占位，后续议题按需追加章节。
