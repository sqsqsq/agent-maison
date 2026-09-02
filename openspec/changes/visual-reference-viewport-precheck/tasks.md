## 1. 契约先行

- [x] 1.1 本 change 的 proposal/design/spec/tasks 通过 `npm run openspec:validate`（strict + enforcement 路径）并过独立 review；通过前不动生产代码。（2026-09-02 strict 46/46；codex review PASS，P1 成对/唯一负例已补）

## 2. 尺寸兼容性前置门（plan b3d7e5a1 T5）

- [ ] 2.1 共享判据：把 `profiles/hmos-app/harness/visual-diff-ocr-gates.ts` 的 ×1.15 整页阈值迁为共享常量，并提供一个纯函数 `referenceViewportIncompatible(refDims, viewportDims)`；ocr-gates 既有分支改读该常量，行为不变。
- [ ] 2.2 spec：`profiles/hmos-app/harness/fidelity-snapshot-check.ts` 旁新增 `visual_reference_viewport` 检查——viewport 取 fidelity-lock `viewport`；逐屏 `resolveRefSourceImage` + `readImageDimensions`；不兼容且 `pixel_1to1` → FAIL，低档 → `fidelityRatchetFailOrWarn`；lock 无 viewport → WARN 明示推迟到 testing；全部兼容时返回空结果，不新增 PASS 条目。
- [ ] 2.3 testing：`profiles/hmos-app/harness/visual-diff-check.ts` `checkVisualDiffCore` 在任何内容比对之前算出不兼容屏集合——viewport 取该屏实测截图尺寸；`pixel_1to1` → `visual_reference_viewport` FAIL 点名屏与尺寸，并把该屏从 pixel/OCR 内容比对输入集合剔除；低档按 ratchet；details 点名被剔除屏；全部兼容时返回空结果，不新增 PASS 条目（保证 check 集合逐字不变）。不新增 ui-spec 字段、resolver、crop 产物或 hash 语义；不删 ocr-gates 旧 uncertain 分支。
- [ ] 2.4 指引：spec 检查与 testing FAIL 的 suggestion 指向"用既有裁图能力生成 viewport-sized 参考图并更新该 screen 的 `ref_id`"；同步 `profiles/hmos-app/skills/device-testing/profile-addendum.md` 与 spec 侧 visual handoff 指引各一句。

## 3. 回归与收口

- [ ] 3.1 单测（jimp 合成 PNG，不可用时 SKIP）：1320×4350 与 1320×8312 对 1320×2120 在 `pixel_1to1` 明确 FAIL 且该屏零内容 hit；1320×2120 对 1320×2120 行为逐字不变（check 集合与 details 无新增条目）；替换 viewport-sized ref 并更新 `ref_id` 后正常进入原 visual diff；低档位 WARN/SKIP 不升级为像素 PASS；lock 无 viewport 时 spec WARN、testing 实测再判；ocr-gates 阈值迁移后既有用例不变。
- [ ] 3.2 一次最终 `npm --prefix harness test`、`npm run openspec:validate`、`npm run release:verify`、`node scripts/check-plan-version.mjs`、`git diff --check` 与改动文件 LF 扫描；`MIGRATION.md` 无需变更（非 BREAKING）。
- [ ] 3.3 宿主条件验证（用户触发，不由实施代理发起）：宿主 expanded/all_banks 在 `pixel_1to1` 下被点名 FAIL；换 viewport-sized 参考图后进入原比对。没有环境时如实记录"条件未验"，不阻塞 Maison 本地验收。
- [ ] 3.4 更新 plan b3d7e5a1 T5 状态，独立 review 收口。
