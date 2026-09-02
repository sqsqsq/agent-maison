## 1. 契约先行

- [x] 1.1 本 change 的 proposal/design/spec/tasks 通过 `npm run openspec:validate`（strict + enforcement 路径）并过独立 review；通过前不动生产代码。（2026-09-02 strict 46/46；codex review PASS；六轮 P1 已吸收：尺寸门前移到 capture score_floor/edge、provider target 装配与 check 侧 edge/越界 OCR/锚点 OCR/文本块 OCR/弃判全部入口，长页出路改为"拆多屏 + 落点可重复前提 + 无段级档位"；七轮 P1：长图屏旧裁决本轮失效——capture 不跳采并经 invalidateScreenIds 整条剔除、零采集早退同剪，provider 空目标早退前复位旧 provider 状态并落盘）

## 2. 尺寸兼容性前置门（plan b3d7e5a1 T5）

- [x] 2.1 共享判据：把 `profiles/hmos-app/harness/visual-diff-ocr-gates.ts` 的 ×1.15 整页阈值迁为共享常量，并提供一个纯函数 `referenceViewportIncompatible(refDims, viewportDims)`；ocr-gates 既有分支改读该常量，行为不变。
- [x] 2.2 spec：`profiles/hmos-app/harness/fidelity-snapshot-check.ts` 旁新增 `visual_reference_viewport` 检查——viewport 取 fidelity-lock `viewport`；逐屏 `resolveRefSourceImage` + `readImageDimensions`；不兼容且 `pixel_1to1` → FAIL，低档 → `fidelityRatchetFailOrWarn`；lock 无 viewport → WARN 明示推迟到 testing；全部兼容时返回空结果，不新增 PASS 条目。
- [x] 2.3 testing：`profiles/hmos-app/harness/visual-diff-check.ts` `checkVisualDiffCore` 在任何内容比对之前算出不兼容屏集合——viewport 取该屏实测截图尺寸；`pixel_1to1` → `visual_reference_viewport` FAIL 点名屏与尺寸，并把该屏从 pixel/OCR 内容比对输入集合剔除（codex P1：前置门在 P0 覆盖之前算出，edge sentinel / 全局元素越界 OCR / 锚点缺失 OCR / 文本块 OCR / 弃判判定全部只消费 comparableScreens；capture 侧 score_floor/edge 与 delegated provider 的 target 装配用同一判据）；低档按 ratchet；details 点名被剔除屏；全部兼容时返回空结果，不新增 PASS 条目（保证 check 集合逐字不变）。不新增 ui-spec 字段、resolver、crop 产物或 hash 语义；不删 ocr-gates 旧 uncertain 分支。
- [x] 2.4 指引：spec 检查与 testing FAIL 的 suggestion 指向作者建模出路——长页按锚点拆成多个 viewport 尺寸的 screen（各自 ref_id 裁图 + nav 末步 scroll_to 锚点；像素路径前提=每段 nav 从已知状态出发且落点已证明可重复，不属像素范围的段落排除在 pixel_1to1 屏外、由功能/结构 AC 覆盖，无屏级/段级档位）；同步 `profiles/hmos-app/skills/device-testing/profile-addendum.md` 与 spec 侧 visual handoff 指引各一句（2026-09-02 三轮修订：由"换一张图"改为拆多屏，机制不动）。

## 3. 回归与收口

- [x] 3.1 单测（jimp 合成 PNG，不可用时 SKIP）：1320×4350 与 1320×8312 对 1320×2120 在 `pixel_1to1` 明确 FAIL 且该屏零内容 hit；1320×2120 对 1320×2120 行为逐字不变（check 集合与 details 无新增条目）；替换 viewport-sized ref 并更新 `ref_id` 后正常进入原 visual diff；低档位 WARN/SKIP 不升级为像素 PASS；lock 无 viewport 时 spec WARN、testing 实测再判；ocr-gates 阈值迁移后既有用例不变。
- [x] 3.2 一次最终 `npm --prefix harness test`、`npm run openspec:validate`、`npm run release:verify`、`node scripts/check-plan-version.mjs`、`git diff --check` 与改动文件 LF 扫描；`MIGRATION.md` 无需变更（非 BREAKING）。（2026-09-02 留证：typecheck PASS；`npm --prefix harness test` unit 3784/3784 + fixtures 46/46；`openspec:validate` strict 46/46 + enforcement PASS；`check-plan-version` PASS；`git diff --check` 干净；改动文件 LF/无 BOM；`release:verify` 规则单测/陈旧扫描 PASS，其发布模式 plan-version 门因 3.0.0 窗口内 7 份在研 plan（6 份与本 change 无关 + b3d7e5a1 自身 T7 待收口）未完成而 FAIL——发布时收口，非本 change 缺陷；MIGRATION.md 无需变更）
- [x] 3.3 宿主条件验证（用户触发，不由实施代理发起）：宿主 expanded/all_banks 在 `pixel_1to1` 下被点名 FAIL；按锚点拆成多个 viewport 尺寸 screen 后进入原比对，且至少两个冷启动轮次的中/尾 checkpoint 落点一致——否则如实记为当前限制。没有环境时如实记录"条件未验"，不阻塞 Maison 本地验收。（2026-09-02 如实记录：条件未验——宿主回灌由用户触发且与 Maison 本地收口无关，本轮未提供宿主环境；不阻塞 Maison 收口，待宿主跑时按本条核对）
- [x] 3.4 更新 plan b3d7e5a1 T5 状态，独立 review 收口。（2026-09-02 codex 七轮 review 收口：无 P0/P1 残留；plan 状态已更新）
