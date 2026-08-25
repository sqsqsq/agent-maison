## 1. 立项（实施顺序 1）

- [x] 1.1 OpenSpec change 立项（proposal/design/六域 specs；plan a9d4c7e2 四轮 review 定稿为源）
- [x] 1.2 四轮 review 8 条实施备注落 design.md §1（两切片过渡/report_validity 落盘/P0-B 债务门控终态/accepted≠closed/P1-E 措辞/crop provenance 枚举/锚点字符集/≥4/5 首跑预期）

## 2. P0-A 切片一：负面裁决传播（实施顺序 2）

- [x] 2.1 check-review `negative_verdict_closure`：结论=不通过 → BLOCKER FAIL（洞⑥同纹理；事故 fixture：不通过+3 BLOCKER）
- [x] 2.2 check-testing 「不达标」同语义 gate（checkNegativeTestingVerdictClosure）
- [x] 2.3 `upstream-verdict-gate.ts`：下游 phase 启动消费上游 summary（切片一读顶层 verdict+blockers）+ 新鲜度复用 recomputePhaseEvidenceStaleness 单阶段重算（manifest 缺失=legacy 现场不因新鲜度阻断）；coding/review/ut/testing 四接线
- [x] 2.4 verifier PASS=「报告可信」——check 签名不消费 verifier 输入（单测锁定）
- [x] 2.5 单测 16 例：事故回放（不通过闭环被拦）、洞⑥回归不破坏、跨阶段阻断（纯判定+I/O 集成）、verifier 无法洗白；phase-rules 四 yaml 登记（gate_fingerprint 变更=预期 breaking）。验收：typecheck 0 · unit 2084/2084 · fixtures 44/44

## 3. P0-A 切片二：summary 1.1 多轴（实施顺序 3）

- [x] 3.1 summary.schema.json 1.1：`report_validity` 顶层（design §1.2 定案：独立字段非轴）+ `quality_axes`（含 resolution 入轴）+ release_readiness/completion_status；lite 校验器无 anyOf → resolution 用 type:["null","object"] 表达
- [x] 3.2 `quality-axes.ts`：四轴派生（外部阻塞分类复用 resolveVerdictFromChecks 为唯一 oracle，不重复实现 device-external 判定）+ 双投影 + 写盘对账（projected≠legacy → readiness signal 显式不静默）+ 不适用轴 FAIL 重映射 functional 安全网 + evidence 零执行降解 NOT_APPLICABLE
- [x] 3.3 legacy 1.0 政策接线 verify-feature-completion（①b：schema≠1.1 → needs_fix summary_schema_current）
- [x] 3.4 resolution↔needs_fix/needs_human 映射复用 CleanPassIssueKind；visual/asset UNVERIFIED(needs_human) → completion quality_axis_verified needs_human 封顶；completion_status 仅投影标签
- [x] 3.5 必需轴矩阵落 ts 单点（ADVANCE_UNVERIFIED_BLOCKING，quality-axes.ts）——**偏差声明**：未落 phase-rules yaml（避免二次 fingerprint churn；openspec spec 文字为规格 SSOT）
- [x] 3.6 upstream-verdict-gate 消费 1.1：quality_axes 作信息面（轴摘要入 details），裁决单点仍是 verdict 投影产物（不分叉）
- [x] 3.7 单测 12 例：不变量、双投影、等价性（PASS/FAIL/外部 INCOMPLETE/混合）、盲档 VISUAL_PENDING、非 UI NOT_APPLICABLE、legacy 拒绝、needs_human 封顶。验收：typecheck 0 · unit 2096/2096 · fixtures 44/44

## 4. P0-B 素材完整性（实施顺序 4）

- [x] 4.1 check-spec `blind_crop_prohibition`（收窄禁令：禁执行/自证不禁消费；provenance 三来源=verified_artifact/human_receipt(绑产物字节哈希)/external_tool 结构记录；user_requirement 哨兵不作数）；ReceiptAction 增 crop_provenance/human_visual_acceptance；spec-rules.yaml 登记
- [x] 4.2 role/criticality 机器派生（asset-integrity.ts：key 语义+icon.kind 证据交叉；criticality 由 P0 屏派生；agent 声明失配→conformance 违例不作数）
- [x] 4.3 物化 sanity role 分档（assessMaterializedFile + coding `asset_materialization_sanity`）：brand-critical 空白/纯色/损坏 → BLOCKER 档位无关；单色 icon/mask 反误伤边界；阈值独立冻结版本 r1
- [x] 4.4 分角色占位生成器（generateRolePlaceholder，确定性 SVG——CJK 首字文字头像走系统字体渲染无字体依赖；illustration→中性插画框；system_symbol→SymbolGlyph 指引不落文件；svgLooksVisible 禁空白占位）
- [x] 4.5 render-visibility.ts 债务门控观察节点：uitree Image bbox×截图区域三信号合议（结构 lumaStddev+背景 ΔE2000）；阈值版本 r1-debt-gated；MAJOR/WARN findings 入 visual-debt，open debt 阻断 release；bbox 归一化换算（round6 转置教训防复发）；接线 visual-diff-check 入口 wrapper
- [x] 4.6 独立 enforce 取消（3.0.0 收尾决定）：同一事实已由 visual-debt→visual UNVERIFIED→release BLOCKED 承载；不叠加 phase BLOCKER。P1-G 回灌仅校准阈值/夹具，不触发自动升级。
- [x] 4.7 单测 21 例（core 6 + profile 15）：禁令条件矩阵/role 失配/brand-critical 阻断/占位确定性/可见性夹具双向（round6 真废图+真 mockup）。验收：typecheck 0 · unit 2117/2117 · fixtures 44/44

## 5. ~~P0-C 盲档 UI kit~~ —— **整段撤回（2026-08-25，plan e6b3f8d2 t3）**

原 5.1–5.8 已实施并已**整体删除**：block 模板与清单、scaffolder（含目标目录四级解析）、
实例锚点模块、ui-spec `block` 字段、三段闭环 check、gallery 结构 fixture、盲档 spec 工作法里
的套模板指引、以及对应单测。

- [x] 5.R 撤回执行：删除上述全部实现与 `blind-ui-kit` capability spec；selector 回归裸
      ui-spec node id/text；页面身份判据迁移到既有 visual-diff-nav screen identity
      （只取 `proposed=false` 的已确认 identity 中 `all_of`/`any_of` 正向 id、精确 id 判在场，
      `proposed=true` 与 `none_of` 均不作所有权证明）；
      锚点漂移缺陷分类整链删除；`ui-kit:placeholders` 改名 `asset:placeholders`
      （素材占位能力保留、与 kit 解耦）。
- [x] 5.R2 盲档结构地板改由既有产品组件所有权链承接，并在 `visual_parity_coverage` 内
      收紧三项为**不受 `visual_parity_enforcement` 降级**的硬地板：P0 节点须有
      `contract_component`、该 P0 mapping 引用的组件须真实存在于 `contracts.components`
      （空数组也判失败）、其 `file` 须在 `contracts.files`。非 P0 mapping 与视觉质量项照旧
      遵守档位，不提升为所有权硬地板。
- [x] 5.R3 MIGRATION.md 记 breaking（`block` 字段/kit 目标目录配置删除、`maison:` selector
      作废须重新生成、npm script 改名、所有权三项档位无关）。

> **撤回理由（宿主实锤）**：run 20260825T011950Z-eddfb2 中，该机制把具体组件实现升级成强制
> 产品契约并要求宿主指定 vendoring 落点；对守规 agent 结构性不可满足（不 scaffold→未物化 /
> scaffold→越界双输），3 次重试烧尽 halt，且其官方 scaffold 入口在宿主 Node 环境自身崩溃。
> **诚实边界**：所有权链证明「UI 归谁实现、代码在哪」，不等于原 d3 设想的「平台标准组件质感」
> ——存在精度差异，本 change 如实记录，不以其他机制补偿。

## 6. P0-D 三态扩面 + 视觉债务（实施顺序 6）

- [x] 6.1 check-spec `fidelity_capability_pregate`（同源 detectFidelityIntent/dereference；**计划外硬发现**：collectRequirementIntentText 只读 goal-run manifest——逐阶段路径恒空串正是覆盖缺口实体，新增 collectIntentTextWithPhaseFallback 回退 feature 根需求文档+spec.md）；强意图+盲→BLOCKER(DEFERRED 语义)、含混+图→await_human、receipt 放行降 WARN 不洗白；fidelity-intent.json 落盘（desired 永不改写）
- [x] 6.2 vision.blind_tier 告知文案对齐（ui-spec.md I1 段：确认成本+≥4/5 首跑「显式接受债务」预期）
- [x] 6.3 `visual-debt.ts`：check 结果派生（非 agent 自报）+ md 投影 + open/closed/accepted 三态迁移 + harness-runner 管线接线（open 债务→visual 轴 UNVERIFIED needs_human→release BLOCKED；advance 等价性不破）
- [x] 6.4 结论披露门禁 `visual_debt_disclosure`（testing BLOCKER：有债务结论必须引用「视觉债务」；轴 SSOT=summary.quality_axes，禁复合措辞由此承载）
- [x] 6.5 `human_visual_acceptance` receipt 消费：payload 文件+信任链 receipt 绑 payload 字节哈希；rubric 冻结（≥4/=3 须留痕/≤2 拒/版本失配拒）；screens 逐屏配对哈希（跨屏换对即变）；needs_fix 拒清偿
- [x] 6.6 品牌色事实源纪律入 ui-spec.md（优先级链+模型猜色仅限占位中性调色）
- [x] 6.7 单测 10 例全绿。验收：typecheck 0 · unit 2138/2138 · fixtures 44/44

## 7. P1-E 确定性反馈（实施顺序 7）

- [x] 7.1 `visual-feedback.ts`：JSON SSOT（身份=version+package digest(RELEASE-MANIFEST 哈希)+gate_fingerprint+commit 可空）+ md 投影 + ref/actual 文件哈希绑定；接线 visual-diff wrapper
- [x] 7.2 两类信号分立：声明文案缺失=hard（子串容错防 OCR 拼行误报）；text_extra/region_color(OCR 锚定分区 ΔE2000)/line_rhythm=advisory 恒不产 hard；**阻断承载声明**：文本存在性 BLOCKER 归既有 OCR 门禁，本 check WARN 观察产出（防同一事实双 BLOCKER 抖动；P1-G 回灌只校准信号/夹具，不预留独立升级）——偏差已在文件头声明
- [x] 7.3 收敛五态（first_round/converged/converging/stalled/regressing）自上一轮指纹集对比；**偏差声明**：未直改 evaluateVisualRound 输入面——stalled/regressing 事实与既有 fuse 同源（visual_diff 结构化轮次承载 defect 指纹），不并行造熔断状态机（openspec visual-diff spec 语义内）
- [x] 7.4 `isDeterministicFeedbackRequired` 机器派生（盲档∧ui_change，数据驱动非配置开关）；**偏差声明**：capture-completeness pixel-only 早退未改（那些是 spec 期 OCR 完备性检查非设备采集；设备采集本就档位无关，quiescence 仍 pixel-only 属既有语义）
- [x] 7.5 nav 档位无关 BLOCKER 回归 tripwire（源码锚定：BLOCKER/FAIL + 注释锚 + 禁 fidelityRatchet 回归——深管线端到端归 P1-G）
- [x] 7.6 单测 8 例全绿（含"色差 8→9 不升轴"结构性锁定）。验收：typecheck 0 · unit 2147/2147 · fixtures 44/44

## 8. P1-F 素材问人（实施顺序 8）

- [x] 8.1 `maybeWriteAssetRequest`（check-spec side artifact：盲档缺供给 brand/ill 素材 → spec/asset-request.md 逐项放置路径+三出路诚实成本；已供给不催/非盲不生成）+ registry `vision.asset_request`（provide/accept_placeholder/defer；headless §9 保守默认）+ ui-spec.md 指引
- [x] 8.2 三态标注 `annotateAssetTriState`（source=sanity/binding=visual_parity/render=render_visibility 本轮绿灯态 rollup）接 harness-runner 债务管线；**防假清偿硬保障**=各阶段检查各自债务条目（任一未绿仍 open→BLOCKED），三态为可读 rollup；补素材重跑自动吸收走既有链（c1-c3/sanity/派生闭账）
- [x] 8.3 单测 2 例（问人清单四断言矩阵 + 三态"文件放了 UI 未绑"可见）。验收：typecheck 0 · unit 2149/2149 · fixtures 44/44 · openspec 40/40

## 9. P1-G 宿主重放物料（实施顺序 9）

- [x] 9.1 8 屏 screen_id+variant 固定矩阵 + fixture 前置条件表（docs/operations/blind-host-replay-runbook.md §1/§0）
- [x] 9.2 机器验收清单 M1-M10 + 人工 rubric receipt 模板（r1-frozen 冻结规则内联）+ 首轮"显式接受债务"预期声明（§2/§3）
- [x] 9.3 发布包 digest 记录规程 + 结果回灌表（render-visibility 误报记录→阈值/夹具校准 / gallery 实机段 / visual_feedback 既有 OCR 承载确认）（§0/§4）
- [ ] 9.4 **实机复验执行**（用户宿主：minimax 2.7 + 真机 + 新发布包）——framework 侧物料已备齐，此项属外部依赖
      （M4 已随 d3 撤回改判据：不再要求 Maison 三段闭环，改验产品组件所有权链 + runtime_mount_conformance）

## 10. 全局验证（每切片完成后滚动执行）

- [x] 10.1 `cd harness && npm run typecheck` 0 错（每切片滚动执行，终态 0）
- [x] 10.2 `cd harness && npm run test:unit` 2149/2149（基线 2068 → +81 新用例）
- [x] 10.3 `cd harness && npm run test:fixtures` 44/44
- [x] 10.4 `npm run openspec:validate` 40/40（含本 change）
- [x] 10.5 MIGRATION.md 四条 breaking + 非 breaking 能力段落
- [x] 10.6 `npm run release:verify`：**除 plan-version 门禁外全 PASS**——8 个 3.0.0 未完结 plan 命中
  （7 个存量：consumer-guard/critic-loop/轻量化/goal超时/layout-oracle/signed-hap/ut-sign-gap，
  与 goal-fakepass 4.6 同性质非本 change 引入；第 8 个=本 plan a9d4c7e2，仅因 P1-G 实机段
  悬置而诚实未完结）。发布前由各 plan 收口。
- [x] 10.7 归档期 openspec artifacts 重生成 —— **[2026-07-30 移出实现任务]** 这是**归档期动作**，不是实现项：本 change 归档那一刻执行 `node scripts/patch-openspec-artifacts.mjs`。已移入下方「Archive checklist」；实现期无从执行，故此处不再作为待办跟踪。⚠ **执行前提**（2026-07-30 误触实测）：该脚本**不幂等**——CLI_PREFIX 注入的 lookbehind 防不住已 patch 文本（`npm run openspec -- list` 里的 `openspec ` 前缀是 `npm run `，不匹配 `(?<!npm run openspec -- )`），二次运行产出 `npm run npm run openspec -- -- list` 损坏形态（本次误触损坏 8 个 skill 文件并已 git 回滚）。**幂等修复已列入 3.0 小修合集 plan f4b2c8e6**；在它落地前，归档时须先确认目标文件未被 patch 过。

## Archive checklist（归档那一刻执行，非实现任务）

- [ ] 归档期 openspec artifacts 重生成：rerun `node scripts/patch-openspec-artifacts.mjs`
      （前提：脚本幂等修复 plan f4b2c8e6 已落地，或人工确认目标文件未被 patch 过）
