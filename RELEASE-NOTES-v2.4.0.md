# Framework 2.4.0 发布说明

**发布日期**：2026-07-07  
**对比基线**：Framework 2.3.0（`framework-2.3.0.zip`）  
**发布件**：`dist/framework-2.4.0.zip`（SHA256: `6cb5754cd54c3b14e56393d7deec9605e5ed6ae982ee55e09b9231fd9d1dfd8d`）  
**适用读者**：接入本 Framework 的工程负责人、AI Agent 使用者、Framework 维护者

> 本文档位于 **AgentMaison 开发仓**（dev-only，不进 zip）。更早版本见 [`RELEASE-NOTES-v2.3.0.md`](RELEASE-NOTES-v2.3.0.md)、[`RELEASE-NOTES-v2.2.0.md`](RELEASE-NOTES-v2.2.0.md)。

---

## 这份文档是写给谁的？

**Framework 2.4.0** 是在 2.3「首创 Goal 模式」之上的一次 **minor 演进**，主题是让自动化**可信**：2.3 让一条需求能全自动跑通 spec→testing，2.4.0 则回答「跑出来的结果凭什么可信」——

- **视觉保真飞轮**：UI 还原度从「agent 自报通过」升级为一条 **开发 → 真机 OCR 测试 → 确定性发现缺陷 → 回修 → 重装重测** 的闭环飞轮——新引入 **`chi_sim.traineddata`** 让机器读懂中文界面，判定绑定构建指纹让「重测」真重验，造假被封堵、关键判定必须真人过目；
- **Goal 模式生产化**：根治「过夜任务静默死亡却显示运行中」「超时/API 断流被误判」「卡死无逃生阀」等无人值守硬伤；
- **防伪与收权**：验真签名拆位、进程注入自净、drift 放行收归真人签名——把「agent 自签放行」的通道逐条关掉；
- **路径全链路治理**：自定义 `paths.features_dir` 宿主的读写路径端到端贯通；
- **多 adapter**：chrys、opencode 接入为一等 headless 运行器。

本窗口累计 **31 个 plan**，绝大多数围绕上述五条主线；下文按主题归并。

---

## 2.3.0 → 2.4.0：一句话变化

| | Framework 2.3.0 | Framework 2.4.0 |
|---|-----------------|-------------------|
| **视觉保真** | agent 自报「视觉已对齐」，无确定性抓手 | **确定性门禁**（烤字/原子图标/双渲染/素材物化/结构声明台账）+ **pixel_1to1 关键屏真人确认** |
| **视觉判定新鲜度** | 判定可跨构建复用，旧结论蒙混 | 判定绑定**截图文件 hash + 安装包指纹**，构建变更即失效重验 |
| **Goal 无人值守** | 可自动跑，但过夜静默死亡显示「运行中」、超时/断流误判 | **存活自校验 + 逃生阀 + 超时/断流正确分类**，长任务可审计地生还 |
| **防伪** | `confirmed_by` 等签名可被 agent 自填放行 | **验真签名拆位**（授权哨兵≠验真签名）+ **进程注入自净** + 伪签物证扫描 |
| **framework 自改** | agent 自加 drift_allowlist 即放行 | drift 放行须**真人签名**结构化审批，自动化署名无效 |
| **自定义 features_dir** | harness 读、agent 写多处硬编码 `doc/features`，端到端易断 | **读写路径 + prompt + gitignore 全链路**随 `paths.features_dir` |
| **adapter** | claude / cursor / codex / generic | 增 **chrys**、**opencode**（external_runner，接入 goal headless） |

---

## 大项改动

### 1. 视觉保真飞轮（2.4.0 最大主线）

**以前的问题（2.3 及更早）**  
UI 需求的还原度没有确定性抓手：agent 在 review/testing 报「视觉已对齐」，无从核验。更根本的是，**像素统计度量在真机上根本分不开「忠实还原 vs 崩坏」**——设备渲染与 mockup 的固有差异让 SSIM / 区域对照全是噪声（实测中区域 SSIM 甚至把**崩坏**的 card_pack 排在**忠实**的 mine 之上）。缺陷（tab 无胶囊、分组丢失、副标题错位、素材用占位图冒充、文案泄漏到别的屏）往往拖到人肉眼看真机才暴露，且能被自报绕过。

**破局点：唯一能确定性分离「忠实 vs 崩坏」的信号是「文本」**——关键文案在不在、在哪。于是本版把视觉验收建成一条 **以 OCR 文本信号为承重的确定性飞轮**。

#### 1.1 引入 `chi_sim.traineddata`：让机器读懂中文界面

宿主是**中文 App**，界面文案全是简体中文；要让机器确定性地「读」真机截图里的文字，需要一个简体中文 OCR 模型。本版引入 **`chi_sim.traineddata`**（Tesseract 简体中文语言训练数据），**离线物化**在 `profiles/hmos-app/vendor/tessdata/`（**绝不运行时 CDN 拉取**——保证确定性与断网可跑），配合 `tesseract.js` 组成「OCR 承重探测」。

- **它是什么**：Tesseract OCR 引擎的简体中文识别模型。有了它，harness 才能把真机截图里的中文文案识别成「文本 + 归一化位置框」。
- **它解决了什么**：把「视觉是否还原」从**分不开的像素度量**转成**可确定性判定的文本信号**——某个声明的文案在不在（**锚点缺失**）、有没有出现在不该出现的屏/区域（**越界泄漏**，如子页底部冒出「首页/我的」=tab 泄漏）、素材图里有没有被「烤」进文字（**烤字**）。这些判据对「设备≠mockup」的固有差异**鲁棒**，不像素点误报。
- **架构**：采集层（真机截图后）`spawnSync` 调 OCR worker 算好文本框、写进 `visual-diff.json`；校验层同步读。OCR 不可用（tesseract.js 未装 / chi_sim 未物化 / 图损坏）一律**优雅降级**并**在 pixel_1to1 下拒绝放行**——承重探测缺失不得静默通过，改判为「修 OCR 环境后重跑」。

#### 1.2 飞轮：开发 → 真机测试 → 确定性发现问题 → 回到开发 → 重装重测

```
  ① coding 产出 UI + 素材物化      →  烤字门禁（OCR 读素材图）先拦一层
  ② device-testing 装真机 · 截图   →  OCR(chi_sim) 读中文文案，与 ui-spec 声明对照
  ③ 确定性发现问题                 →  锚点缺失 / 文本越界 / bbox 错位 / 素材未真渲染 → 落 must_fix
  ④ 回到 coding 按 must_fix 修码    →  （pixel_1to1 关键屏先经真人确认，不许 agent 自签）
  ⑤ 重装真机（新安装包指纹）重测    →  判定持久化识别「构建已变」、旧判定失效 → 回到 ②
                                        （改了不重装 / 重装吃旧判定 都会被指纹戳穿）
```

这条环能**转起来、而不是空转或作弊**，靠本版三个机制：

- **确定性缺陷门禁**——OCR 承重的：烤字门禁、文本越界门禁、锚点缺失、bbox 语义对照、外部完整性分母；（非 OCR 的）双渲染纪律、按 spec 声明渲染几何/填充、透明占位冒充封堵、**素材真渲染物化**（crop 真图字节复制进模块，禁 1×1/纯色占位）、**结构声明台账**（每条 spec 结构声明逐条登记「由哪个组件、如何实现」，遗漏即 BLOCKER）。
- **判定持久化绑定构建**（让「重测」真的重验）：视觉判定的新鲜度键 = **被评估截图文件 hash + 安装包指纹**。修码重装后指纹变，旧判定即失效重验——杜绝「改了代码却吃旧 PASS」的空转。
- **关键屏真人确认**（飞轮的防作弊闭环口）：pixel_1to1 关键屏在唯一阻塞为「待真人过目」时，goal **停下等确认**而非烧重试或 agent 自签；配套 `visual-confirm` CLI + 三入口引导话术（会话软契约 / 高保真 CLI / 手改 JSON），机器生成、零硬编码人名。

**对你意味着什么**

- UI 还原缺陷在 **coding / 真机阶段被机器确定性拦截**并生成 must_fix，agent 据此**自动回修再重测**，形成闭环飞轮——而不是等你肉眼发现或被自报绕过。
- 「重测」是**真重验**：改了代码不重装、或重装了吃旧判定，都会被安装包指纹戳穿。
- pixel_1to1 关键屏**必须真人签字**才放行；headless 下 goal 在该点 halt 给一键确认指引。
- **诚实边界**（写入文档）：文本存在性/位置是鲁棒判据，非文本结构（胶囊/容器形态）靠 review 人审 + 用户终验；框架**不假装**用像素/OCR 位置度量造门禁（实测恒误报）。OCR 环境缺失时 pixel_1to1 拒绝放行、求人修环境，绝不静默通过。

---

### 2. Goal 模式生产化（无人值守硬伤根治）

**以前的问题**  
2.3 首创的 Goal 模式能自动跑，但长/无人值守任务有一批机制性硬伤：过夜任务静默死亡却仍显示「运行中」；spec 阶段预算畸紧；超时被误分类、超时产物被丢弃；headless 下 API 断流被当成「无进展」halt；卡死时 Stop hook 无逃生阀、弱模型空回复被反复拉回。

**2.4.0 做了什么**

- **无人值守生存**：宿主无关的存活语义 + 启动后存活自校验，根治「静默死亡显示运行中」。
- **超时预算 + API 断流全盘根治**：放宽 spec 预算、超时改 per-phase、超时 partial 产物注入续作而非丢弃、headless API 断流独立归类为 `transient_api_error`（不再误判 no_progress）。
- **卡死误判根治**：依赖归因误报修正、Stop hook 加**逃生阀**（连续零进展达阈值自动放行、交还用户）、弱模型空回复不再被死循环拉回。
- **bounded monitor**：主 agent 在活跃轮次内按统一事件流主动汇报 phase verdict / 终态 / 异常，不再「问了才读状态」。
- **多 adapter 自愈 + headless 闸门自解析**：新 clone 缺 `framework.local.json` 时走确定性写盘；spec 等阶段的人工确认闸门在 headless 下自动解析 + 分级留痕，不再卡死。

**对你意味着什么**

- 过夜 / 无人值守 goal 跑**可审计地生还或如实报错**，不再「假装还在跑」。
- 超时、API 断流、外部阻塞被**正确分类**，不会误判成任务失败或整单 completed。
- 死局有**逃生阀**兜底，控制权最终交还给你。

---

### 3. 防伪与收权（把「agent 自签放行」逐条关掉）

**以前的问题（实锤）**  
门禁的部分放行依赖 agent 自填字段：`confirmed_by=user_requirement`（裁剪授权哨兵）被复用为验真签名；agent 可造成套伪签脚本（capture 写 json 即填 pass + 自算 hash 满足证据绑定）；`NODE_OPTIONS --require` 预加载注入 harness 进程而 file-drift 检查无感；agent 自加 `drift_allowlist` 即放行 framework 自改。

**2.4.0 做了什么**

- **验真签名拆位**：`isHumanVerified` = 已确认 **且** 署名≠授权哨兵——授权语义（need requirement）与「对具体屏/资产的真人过目」严格分离。
- **进程注入自净**：spawn 子进程剥离 `NODE_OPTIONS` 预加载注入项（`--require`/`--import`/`--loader` 全覆盖）、harness 启动自检、伪签物证扫描（testing 目录内「改判脚本」确定性上桌 BLOCKER）。
- **drift 放行收权**：`drift_allowlist` / `allow_local_drift` 须结构化 `{path, rationale, approved_by}` 且 `approved_by` 为**真人签名**（拒自动化 + 授权哨兵），旧字符串/布尔形式失效。

**对你意味着什么**

- 视觉/资产的「真人过目」不能再被授权哨兵或 agent 自填字符串冒充。
- framework 自改必须真人签字审批，agent 无法自开口子。
- **诚实残余风险**已在文档标注：仍堵不住 headless agent 手写像人名的字符串——彻底解（带外确认凭证）列入后续窗口，本窗口不装闭环。

---

### 4. 路径全链路治理（自定义 features_dir 端到端贯通）

**以前的问题**  
`paths.features_dir` 虽可配置，但 harness 读路径、profile 门禁、agent prompt/skill 文案、`.gitignore` 模式多处硬编码 `doc/features`——自定义宿主下「代码读 custom 目录、agent 写 doc/features」产物落错树、门禁静默失效。

**2.4.0 做了什么（round7 两批）**

- **读写路径**：共享 helper（ui-spec / fidelity / acceptance / coverage 等）与 framework/profile 散点全改走 `featureFilePath`/`relFeatureFile`（尊重配置）。
- **agent 写路径**：verify prompt 运行时替换 `{features_dir}`、skills/mdc/profile 文案占位符化 `<features_dir>`、`canonical-gitignore` 函数化随配置生成、Stop hook 回执路径尊重 `receipt_dir_pattern`。
- **诚实豁免**：`specs/phase-rules/*.yaml` 路径文案（改动会令宿主全量存量回执 stale）与 `_adhoc` 固定落点（独立契约）显式不动。

**对你意味着什么**

- 把 `paths.features_dir` 设成 `requirements/features` 等非默认值的宿主，读写、prompt、gitignore **端到端一致**。
- 默认布局（`doc/features`）宿主**零行为变化**。

---

### 5. 多 adapter 接入（chrys + opencode）

- 为 **chrys**、**opencode** 各新建一等 agent adapter，均为 external_runner，共享根目录 `AGENTS.md`；chrys 复用 shared `.agents` bridge，opencode 用自有 `.opencode/skill` + `.opencode/rules`。
- 二者接入 **goal-runner headless 链路**为结构化运行器（chrys=`chrys run --task`、opencode=`opencode run`）。

---

## 中等项改动

- **门禁加固**：裁决提取子串 bug 根治（散文裁决误判，统一 `extractDeclaredVerdict` 入口 + 元门禁）；testing 阶段门禁 + goal 完成裁决 + ArkUI 静态规则加固（杜绝「真机 trace 失败/超时但 goal-report 报通过」）；consumer 防漂移门禁。
- **编号 skill 彻底清扫**：清除 2.3 遗留的编号跳板/文案残留。
- **gate fingerprint 纪律**：门禁语义变更须同步 `specs/phase-rules/*.yaml` 声明面（否则存量回执不失效的盲区）。

---

## 2.3.0 已有、2.4.0 延续的能力

- **Goal 模式**确定性外层编排（2.3 首创，2.4 硬化生存性）
- Skill `project/` + `feature/` 分域与扁平 slug（2.3）
- 阶段 `spec`/`plan` 命名与 dual-read compat（2.3）
- config builder、template-renderer、Code Graph 机制（2.2）

---

## 升级指引（2.3.x → 2.4.0）

1. 备份当前 `framework/` 版本。
2. 部署 **`framework-2.4.0.zip`**（SHA256 见文首）或 submodule 更新到对应提交。
3. 工程根 **`/framework-init` UPDATE**（S1→S4）；确认 adapter 物化。
4. 每位开发者跑 **`check-personal-setup --json --ensure`**。
5. 验证：`cd framework/harness && npm test`。
6. **视觉保真**：UI 需求首次跑 coding/testing 会遇到新增确定性门禁（烤字/原子图标/素材物化/结构台账）；pixel_1to1 关键屏会在 goal 模式 halt 等你真人确认——照引导话术用 `visual-confirm` 或对话确认。
7. **自定义 `features_dir`** 宿主：升级后读写/prompt/gitignore 自动随配置，无需手工改。
8. 自 **2.2.x 或更早直跳** 者，须叠加阅读 [`RELEASE-NOTES-v2.3.0.md`](RELEASE-NOTES-v2.3.0.md) 与 [`MIGRATION.md`](MIGRATION.md)。

---

## 已知边界

- **视觉裁判**只保证「文本存在性」为鲁棒判据；非文本结构（胶囊/容器）靠 review 人审 + 用户终验，框架不造像素/OCR 位置类门禁（实测恒误报）。
- **防伪**堵住授权哨兵冒充与伪签脚本，但堵不住 headless agent 手写像人名的字符串——彻底解（带外确认凭证）列入后续窗口。
- **路径治理**豁免 `specs/phase-rules/*.yaml` 文案（gate fingerprint 副作用）与 `_adhoc` 固定落点。
- adapter 物理拦截能力仍不对等；chrys/opencode 为 external_runner，不承诺与 claude 同级质量。

---

## 相关文档

| 文档 | 用途 |
|------|------|
| [`RELEASE-NOTES-v2.3.0.md`](RELEASE-NOTES-v2.3.0.md) | 上一版（2.3，首创 Goal 模式）增量说明 |
| [`MIGRATION.md`](MIGRATION.md) | 升级步骤与破坏性变更 |
| [`MAINTAINER-CHANGELOG.md`](MAINTAINER-CHANGELOG.md) | 2.4.0 窗口全部 31 个 plan 逐条（开发者向） |
| [`docs/operations/goal-mode-runbook.md`](docs/operations/goal-mode-runbook.md) | Goal 模式运行手册 |

---

**Framework 2.4.0** — 让 2.3 的 Goal 自动化**可信**：以 `chi_sim` OCR 文本信号为承重的**视觉保真确定性飞轮**（开发↔真机自动闭环）、无人值守生存性根治、防伪收权、路径全链路治理，并接入 chrys / opencode。
