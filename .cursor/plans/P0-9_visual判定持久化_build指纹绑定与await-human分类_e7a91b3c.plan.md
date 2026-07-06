---
name: P0-9 — visual 判定持久化（build 指纹绑定）+ goal await_human_visual_confirm 分类
version: 2.4.0
# 版本说明（用户拍板 2026-07-06）：版本号保持 2.4.0，版本与发版节奏由用户控制；
# 本批 todo 将在下次打包前全部 completed，不触发 release:check-plans 顺延问题。
overview: >
  背景：子批A 发布件下的回修轮（2026-07-05 21:01–22:14，run 20260703T181220Z 第 6/7 次尝试）
  agent 行为完全合规（修 PromoSwiper 实机验证、拒绝伪签、明确建议 HALT 求人——红线与门禁生效），
  但暴露并经代码坐实一个**设计级缺陷**：mergeCapturedScreenEntry（visual-diff-capture.ts）
  只在重采截图与 evaluated_screenshot_hash 逐字节一致时才保留 pass/warn/fail 判定——真机截图
  状态栏时钟/电量/首页轮播帧必然变化 → 重采必然 hash 漂移 → agent 的 warn+must_fix 被重置
  pending（本轮实锤：第 7 次已写 5 屏 warn+must_fix+defects，22:11 goal-runner 终跑 harness
  重采后全灭）→ 5 屏恒 pending → no_progress HALT 死循环。**真人 confirmed_by 的 pass 同样
  活不过下一次 capture**——T2 人工确认流程在真机上机械不可达（Exit-2 单测静态文件 hash 恒等
  故未暴露）。这是像素类判据第三次被真机证伪：像素恒等作"证据新鲜度键"与像素度量同样脆。
  修复主张：**新鲜度键从"像素恒等"换成"被评文件 + build 指纹"**——判定绑定它实际评的那份
  截图文件（文件 hash，盘上不可变）＋截图采集时的应用构建指纹（机器写入）；build 没变判定
  就有效，capture 跳过已定屏不重采；代码一改（重装包）全部已定判定自动失效重来（语义恰好
  正确：改码必须重判）。反作弊不回退：文件仍被 hash 钉死、build 指纹机器写入且换包即失效、
  伪签/注入/物证四层门禁原样在场。
  伴随修复：goal-runner halt 分类——visual_diff 仅剩"待真人确认"时应报 await_human_visual_confirm
  （给出逐屏确认操作指引），不得混入 no_progress_visual_gap（本轮用户看到的又是一次"无进展"，
  实际是设计内的求人时刻）。
  约束：framework-only；坏态/正样本夹具齐；全量绿后等 review 提交；发布后宿主续跑同一 run。
todos:
  - id: p0-9a-build-fingerprint-binding
    content: >
      P0-9a 判定持久化改键——①指纹取源**写死**（cursor/codex 同点）：device-test-build/install
      步骤机器计算**hap 内容 sha256** 写入 meta（现有 meta 仅 hapPath/mtimeMs/sizeBytes，
      mtime/size 不得作键——codex 核实）；capture 对每屏写 `evaluated_build_fingerprint`；
      **check/capture 端"当前构建指纹"必须现算自实际安装的 hap 文件 sha256**，绝不只信 meta
      可 hand-edit 字段（cursor：脚本类伪造 P0-7 兜，hand-edit 靠现算兜；即便伪造指纹，pass
      仍过不了 T2 真人签，纵深在场）；②mergeCapturedScreenEntry 保留判据改为：已定判定在
      「evaluated_screenshot_hash 与其绑定的截图**文件**一致（盘上未被替换）且
      evaluated_build_fingerprint 与**现算当前指纹**一致」时保留——不再要求与新采像素一致；
      ③capture 跳过已定屏重采的**硬前提**（codex 意见原话钉死）：当前指纹现算成功、已知、
      且与存储一致、且文件 hash 校验通过——**指纹缺失/来源不可读/hap hash 计算失败，一律
      不得 skip capture**，照常重采并重置；④isStaleVisualDiffVerdict 同步改键（文件级校验
      保留，像素恒等删除）；⑤缺 evaluated_build_fingerprint 的已定判定=legacy stale →
      pending 重采；⑥schema/类型同步（codex）：VisualDiffScreenEntry 增字段 + validator +
      md 投影文案 + fixtures；⑦顺手项**全范围**（codex 二轮 P2，行号已核实）：visual-diff
      capture/check/nav 相关 feature artifact 路径统一走 featureArtifactPath/relFeatureArtifact/
      featuresDirPath——含 capture 的 deviceScreenshotsDir(:93)/shotRelPath(:97)/visual-diff.md、
      visual-diff-nav.ts 的 nav 配置路径(:31)、check 的 spec fallback；补自定义
      paths.features_dir 单测（脚本只在自定义目录下也须正常采集/判定/扫描）。
      单测：**agent 写 warn+must_fix → 下一轮 capture 不清空（本轮实锤病灶动态复刻，必须有）**；
      时钟漂移（同 build、文件在、新采不同 bytes）判定保留；换 build 失效；盘上文件被替换
      失效；指纹计算失败不得 skip；真人 confirmed_by pass 经 capture+check 全链路存活。
    status: completed
  - id: p0-9c-freshness-gates-realign
    content: >
      P0-9c E1/stalePreserved 新鲜度门禁对齐（cursor 意见②，已核实 check-testing.ts:2163
      `stalePreserved = screensWritten===0 && screensPreserved>0` 与 capture E1 口径）——
      不改则 P0-9 合法跳采（screensWritten=0 + preserved=5）落地即被判"陈旧证据 FAIL"。
      重定义"新鲜"：**build 指纹有效的 preserved = 合法新鲜**（capture 报告须区分
      preserved_build_valid 与 preserved_legacy/回退）；仅"采集失败回退旧 json / legacy 无
      指纹 preserved"仍 FAIL（反陈旧证据语义不丢）。capture meta 字段与 check-testing 消费
      两侧同步 + 两侧单测（合法跳采不误伤 / 采集失败回退照拦）。
    status: completed
  - id: p0-9b-await-human-halt-class
    content: >
      P0-9b goal halt 分类——条件按 codex 意见**收窄**：await_human_visual_confirm 仅当
      全部 P0 屏 verdict=pass、**无任何 must_fix、无 blocker/major defects、无 stale/缺
      evaluated hash/缺 build 指纹**、且唯一 BLOCKER=visual_diff_human_confirm_required；
      **warn+must_fix 混杂（本轮宿主 5 屏正是此态）≠待签，仍归 visual_gap**——不得教用户
      填 confirmed_by 通关未裁决内容。checkVisualDiff 输出可机读信号
      （failure_kind=await_human_confirm），goal-runner 消费：halt reason 记
      await_human_visual_confirm，goal-report/console 给逐屏确认操作指引（审图→
      screens[].confirmed_by 填真人名→resume）；不计入 no_progress 弃判口径。
      单测：纯 pass 候选缺签→await_human；混 warn+must_fix→仍 visual_gap；
      混 stale/缺指纹→仍 visual_gap。
    status: completed
  - id: wrap-up
    content: 收口——全量 typecheck/单测/fixture 绿；坏态夹具验收；plan 勾选；等用户 review 提交；发布后宿主续跑 run 20260703T181220Z（agent 重判或复用→修余项→pass 候选 halt→用户逐屏 confirmed_by→COMPLETED→16 项终局对账）
    status: completed
---

# P0-9 — visual 判定持久化 + await-human halt 分类

## 实现记录（2026-07-06，含偏差披露）

**落地清单**：
- `build-fingerprint.ts`（新）：computeHapBuildFingerprint（hap 内容 sha256 前 12 hex 现算）+
  resolveCurrentBuildFingerprint（install meta 只用于定位 hapPath，指纹仍现算文件内容）。
- capture：`canSkipRecaptureForScreen`（skip 硬前提四条全钉）+ 主/overlay 双循环跳采 +
  机器盖 `evaluated_build_fingerprint` 戳 + 全跳采合法路径（ok=true + preservedBuildValid，
  md 投影标注）+ 结果新字段 `screensPreservedBuildValid`。
- check：`isStaleVisualDiffVerdict` 改键（文件级保留 + 指纹可算时缺失/不一致=stale；不可算
  退回文件级——不误伤交互态/单测环境）+ validator 字段校验 + stale 文案更新。
- install meta：机器写 `hapSha256`（仅人读/对账，消费侧仍现算——防 hand-edit）。
- check-testing：现算指纹（hapHolder.hapPath）注入 capture；E1 stalePreserved 公式不变，
  由 capture 结果形状保证隔离——合法跳采 preserved=0 不触发、采集失败 no_captures 照拦；
  PASS details 增 preserved_build_valid。
- goal：FailureKind 增 `await_human_confirm`（classification 优先于 visual_gap id 桶）；
  goal-runner halt 分支（首触即 halt、不吃重试）+ `AWAIT_HUMAN_VISUAL_CONFIRM_GUIDANCE`
  四步指引常量 + goal-report `halt_guidance` 字段。
- checkVisualDiff：await 收窄判定（全 FAIL hit=T2 + P0 全覆盖 + 全屏 pass 零 must_fix +
  零 stale/缺 hash）→ failure_kind=await_human_confirm + details 操作指引。
- 顺手项全范围：deviceScreenshotsDir/shotRelPath/mdPath（capture）、nav config path、
  check reportDir/mdPath/loadSpecMarkdown 全部改走 featureDir（尊重 paths.features_dir）。

**偏差/取舍披露**：
1. plan ② 的"merge 保留判据改键"实际以 **skip-before-recapture** 实现（满足条件的屏根本
   不进 merge，绑定文件永不被覆盖）；merge 内像素恒等路径保留为静态环境退化路径（既有
   单测夹具依赖）。语义与 plan 等价且更强（截图文件也不被动碰）。
2. E1/9c 的 check-testing 侧未拆纯函数直测——由 capture 结果形状（preserved=0/buildValid
   分账 + no_captures 照旧）在 capture 层双向单测锚定；E1 公式本身未变。
3. await 收窄条件允许 WARN 级 advisory hits 存在（存在性 OCR 漏识类）——它们本就设计为
   "人核素材"，真人确认时随 details 可见；只要求 FAIL hit 全部为 T2（否则 OCR 噪声会把
   求人时刻永久卡成 visual_gap）。codex 收窄的字面口径（pass 全屏/零 must_fix/零 stale）
   全部保留。
4. shotRelPath 签名加 projectRoot 参数（repo 内无外部调用者，grep 核实）。
5. 新增单测 14 个：p0-9 套件 9（病灶动态复刻/真人签存活/换 build 失效/**换 build 字节相同仍
   失效**/skip 硬前提/纯谓词/stale 规则/指纹源规则/E1 形状双向）+ visual-fidelity p0_9b 三场景
   （纯 pass 待签/warn 混杂拒标/**指纹不可算拒标**）+ goal-headless-guard 分类器/指引 2 条。

**代码 review 二轮采纳（codex，2026-07-06）**：
- **P1（修复）**：mergeCapturedScreenEntry 保留条件补指纹一致——换 build 后即便新截图字节
  恰好相同也重置 pending（改码必重判；currentFp 经 mergeVisualDiffReports 贯通，null 时
  退回纯 hash 判据兼容静态夹具）；补"换 build 字节相同仍失效"用例。
- **P2（修复）**：awaitHumanOnly 增判「currentBuildFp 非空 + 全 pass 屏
  evaluated_build_fingerprint===currentBuildFp」——install meta 缺失/指纹不可算时不得诱导
  签名（下轮无法跳采、真人签会被清）；补"指纹不可算拒标 await"用例。
- cursor 微清理点核实不成立：preservedBuildValid 在 PASS 分支 details 已使用（:2209）。

## 缺陷机理（代码坐实）

- visual-diff-capture.ts `mergeCapturedScreenEntry`：`capturedHash !== evaluated_screenshot_hash`
  → 重置 pending。真机重采永不逐字节相等（状态栏时钟/电量、首页自动轮播帧）。
- 后果链：agent/VL 判定 → 下次 harness capture 全灭 → check 见全 pending → visual_diff FAIL
  → 重试耗尽 no_progress HALT。**真人确认同样被灭**——T2 流程真机不可达。
- 为何现在才暴露：此前各轮先死在采集失败/作弊/弃判上；子批A 把作弊路全封死、agent 老实
  跑通全链后，第一个撞上的就是它。上轮 agent 的 reset 脚本某种意义上是对同一缺陷的
  （违规）自救。

## 设计取舍

- 不采用"截图裁掉状态栏再 hash"：轮播帧漂移仍在，像素恒等这个键本身就是错的
  （与已证伪的像素度量同源）。
- 新键 = 文件绑定（防换图）+ build 指纹（防"判旧码放新码"）——语义上恰好等价于
  "判定对这次构建有效"，改码自动全失效。
- capture 跳过已定屏：附带把回修轮的采集时间从 5 屏降到仅 pending 屏。

## 外部评审采纳记录（2026-07-05/06，动手前，经 ground-truth 核实）

- **cursor①/codex①（采纳，写死）**：当前构建指纹必须**现算自实际安装 hap 的 sha256**，
  不信任何可 hand-edit 的 meta 字段；build/install 步骤机器写入 hap_sha256（现有 meta 无
  sha256，仅 mtime/size——不得作键）。
- **cursor②（采纳，已核实 check-testing.ts:2163）**：新增 P0-9c——stalePreserved/E1 新鲜度
  口径与合法跳采对齐，"build 指纹有效的 preserved"=新鲜，采集失败回退照拦。
- **codex②（采纳）**：skip capture 硬前提写死——指纹缺失/不可读/计算失败一律重采。
- **codex③（采纳）**：await_human 条件收窄——纯 pass 候选且零 must_fix/defects/stale 才算；
  warn+must_fix（本轮宿主实态）仍归 visual_gap。
- **codex④⑤⑥（采纳）**：schema/validator/md 投影/fixtures 同步；"warn+must_fix 跨 capture
  存活"动态单测必须有；顺手修 capture 内 visual-diff.md 的 doc/features 硬编码。
- **codex 二轮 P2（采纳，行号全核实）**：顺手项扩为 capture/check/nav 全范围路径统一
  （deviceScreenshotsDir/shotRelPath/nav config/spec fallback）+ 自定义 features_dir 单测——
  只修 md 的话 custom layout 下 json/png/nav 仍落默认目录。
- **cursor③（版本决策，用户已拍板 2026-07-06）**：版本号保持 **2.4.0**、由用户控制
  （不走 2.4.1/2.5.0）；P0-9 完成后随用户打的下一个发布件出去，节奏用户定。

## 验收出口

1. 时钟/轮播漂移场景判定保留；换 build/换文件失效；legacy 无指纹判定视 stale；
   指纹计算失败不得 skip capture。
2. 真人 confirmed_by pass 全链路存活（capture→check→T2 放行）；
   **agent warn+must_fix 跨 capture 存活（本轮病灶复刻用例）**。
3. P0-9c：合法跳采（build 有效 preserved）不触发 stalePreserved；采集失败回退旧 json 照 FAIL。
4. goal halt：纯 pass 候选缺签 → await_human_visual_confirm + 操作指引；混 warn/must_fix/
   stale → 仍 visual_gap。
5. 全量 typecheck/单测/fixture 绿；等 review 后提交。
