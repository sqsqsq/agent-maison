---
name: Harness Jimp 升级与消费者安全告警清理
version: 3.1.0
overview: 在测试提速与本轮宿主验证收口后，将 harness 的 Jimp 迁至 1.6.1，消除 file-type 的 ASF 告警，并以同图对照和发布件无锁安装验证兼容性。
todos:
  - id: baseline
    content: 两项前置工作结束后，在现有 Node 环境确认依赖兼容性，并用固定输入取得 0.22.12 的视觉与资产结果。
    status: completed
  - id: migrate
    content: 更新 harness 依赖及本地锁文件，适配三个生产直接调用点和既有测试造图代码，完成同图对照与目标测试。
    status: in_progress
  - id: consumer
    content: 完成现有开发和收口测试，对同一临时发布件执行 release:verify、consumer smoke、干净安装审计和真实读写图验收。
    status: pending
---

# Harness Jimp 升级与消费者安全告警清理

**实施时机**　等待测试提速 plan `6a2f8c91` 收口，且宿主本轮验证结束。两项均满足后再实施。当前宿主处理自有截图、需求参考图及裁图，已知输入路径没有畸形 ASF；本告警不阻断本轮验证。

## 1. 依赖与选型

`harness/package.json` 自 `a9712403`（2026-06-23）起声明 `jimp: ^0.22.12`。本地 `harness/package-lock.json` 解析为 `jimp@0.22.12 → @jimp/custom@0.22.12 → @jimp/core@0.22.12 → file-type@16.5.4`。宿主的四项 moderate 源自同一公告。ASF 零长度子头可令类型探测无法前进，修复版本为 21.3.1。[上游安全公告](https://github.com/sindresorhus/file-type/security/advisories/GHSA-5v7r-6r5c-r473)

| 做法 | 在现有调用链上的结果 |
|---|---|
| 保留 Jimp 0.x，用 npm `overrides` 提升 `file-type` | 旧 core 的 CJS 代码加载 `require("file-type")` 并调用 `.fromBuffer(buffer)`。21.3.1 只发布 ESM，导出名为 `fileTypeFromBuffer`。即使 Node 能通过 `module-sync` 加载 ESM，也没有旧方法可调用。单改版本会破坏正常读图，还会保留 0.x。[旧 core 读图代码](https://unpkg.com/@jimp/core@0.22.12/dist/utils/image-bitmap.js) · [新版包导出](https://registry.npmjs.org/file-type/21.3.1) |
| **采用 Jimp 1.6.1** | 在 harness 直接依赖中固定 `1.6.1`。该版 Jimp 同时提供 CJS 和 ESM 入口，配套 core 依赖 `file-type: ^21.3.3`，其 CJS 入口已用动态 import 调用新 API，无需 override 或兼容层。Jimp 声明 Node ≥18，但该传递依赖要求 Node ≥20；实施前核对本轮宿主实际 Node 与干净安装的依赖要求，不能用开发机通过代替宿主兼容结论。[Jimp 包声明](https://registry.npmjs.org/jimp/1.6.1) · [core 包声明](https://registry.npmjs.org/@jimp%2fcore/1.6.1) · [core 读图代码](https://unpkg.com/@jimp/core@1.6.1/dist/commonjs/index.js) · [file-type 包声明](https://registry.npmjs.org/file-type/21.3.3) |

## 2. 修改边界

更新 `harness/package.json`，用 npm 同步本地 `harness/package-lock.json`。该锁文件被 `.gitignore` 忽略，且发布规则排除所有 lockfile，沿用现状。其余编辑限于以下直接调用点及测试中相同的旧 API。[Jimp v1 官方迁移指南](https://jimp-dev.github.io/jimp/guides/migrate-to-v1/)

| 位置 | 必要适配 |
|---|---|
| `harness/scripts/utils/vision-canary.ts` | default import 改为命名导出 `Jimp`、`loadFont`、`HorizontalAlign`、`VerticalAlign`。画布和色块改为 `new Jimp({ width, height, color })`。从公开子路径 `jimp/fonts` 取 `SANS_32_BLACK` 交给 `loadFont`。保持现有 CommonJS/ts-node 配置，若类型解析不识别字体子路径，在调用点用 CJS 加载该公开导出。`print({ font, x, y, text: { text: token, alignmentX: HorizontalAlign.CENTER, alignmentY: VerticalAlign.MIDDLE }, maxWidth, maxHeight })` 沿用原位置与文本框尺寸。用 `await image.write(...)` 替代 `writeAsync`。 |
| `profiles/hmos-app/harness/image-jimp-worker.cjs` | 从现有按 `harnessRoot` 解析的模块解构 `Jimp`。`crop(x,y,w,h)` 改为 `crop({ x,y,w,h })`，`resize(w,h)` 改为 `resize({ w,h })`，画布构造和异步写出同上。保留 `Jimp.read`、`clone`、`greyscale`、`bitmap.data`、`composite(src,x,y)` 及 worker 参数和 JSON 返回值。 |
| `profiles/hmos-app/harness/ocr-worker.cjs` | 此 worker 也按 `harnessRoot` 直接加载 Jimp，须同步解构 `Jimp`，否则 `Jimp.read` 无法读取 OCR 输入尺寸。仅改导入。 |
| 既有测试造图代码 | 将直接使用旧 API 的六组 harness 测试（见下节）同步迁移，包含 `visual-fidelity` 的内嵌子进程脚本和 `visual-defect-enum` 的 resize。后者的定位参数式 `scan` 保留。 |

两个生产图像入口均无 `getBufferAsync` 调用（v1 对应 `await getBuffer(mime)`）。图像 worker 直接读取像素，自算直方图和边缘差异，未调用 Jimp 的 `hash`、`diff` 或 `scan`。沿现有 `image-toolkit.ts` 验证 `asset-acquisition.ts`、`asset-crop-validation.ts`、`asset-integrity.ts`、`render-visibility.ts`、`quiescence-sampling.ts`、`visual-diff-capture.ts`。保留缺包 SKIP、采样算法、阈值、bbox 归一化与拼图布局。本批不引入检查、状态、门禁或图像逻辑重构。

## 3. 验收

1. **同图对照。** 升级前固定既有截图、参考图、bbox、拼图输入及 canary 答案，保留旧版输出；升级后在同一 Node 环境重放。比对采样色、裁图尺寸与像素、统计量、直方图相似度、分块最低分、边缘差异及阈值判定。对 canary 和拼图比对解码像素，覆盖字形、对齐及布局。对截图和 app 裁图区按现有调用点比较实际文件 hash，尤其是 `hashAppCrop` 对**编码后的 PNG 字节**取 SHA-256 前 16 个十六进制字符；仅像素相同不能证明 hash 一致。若编码默认值造成差异，在写出调用点对齐旧参数，再重放；不得放宽阈值或刷新期望值来通过。
2. **既有测试。** 运行 `npm run test:changed`，确认覆盖 typecheck 和以下套件，补跑未选中的目标。harness 六组为 `visual-fidelity`、`visual-defect-enum`、`visual-provider`、`visual-minor-deterministic`、`test-report-writer`、`goal-runner-testing-integrity`，另覆盖 `vision-canary`、`vision-canary-interactive`。HMOS 覆盖 `round6-bbox-crop-validation`、`asset-integrity`、`asset-materialization`、`quiescence-sampling`、`ocr-toolkit`。在依赖就绪时确认实际读图分支执行成功，同时保留原有缺包降级用例。plan 收口执行一次 `npm test` 全量，可复用本批有效全量结果。
3. **同一发布件。** 用既有打包命令生成临时 zip 和 sidecar；执行 `npm run release:verify -- --zip <zip> --manifest <manifest>`、`npm run release:smoke-consumer -- --zip <zip>`。核对根与 harness 的 sanitize 结果：运行依赖仍由包内 `framework/harness/package.json` 声明为 `jimp: 1.6.1`。改动文本和发布件文本均为 LF。
4. **消费者无锁安装。** 将该 zip 解到干净临时目录，仅在 `framework/harness` 执行 `npm install`、`npm ls jimp @jimp/custom @jimp/core file-type`、`npm audit --json`，确认安装成功、该 Jimp 路径解析到已修复版本、审计不再报告这条 ASF 链。用解包后的 canary 实际写 PNG，再用包内图像 worker 读同一 PNG 并采到预期色值。核对成功返回值，防止缺包 SKIP 或仅 `require.resolve` 成功掩盖读图失败。复用现有脚本，此次对照和抽验不登记为长期门禁。

## 实施记录（2026-11-06）

已固定 Jimp 1.6.1，适配三处生产使用与六组测试造图代码；旧基线与新版解码像素、采样/统计/相似度/边缘判定一致，同版本编码确定，typecheck 通过。按本轮裁决，以像素一致加同版本确定性验收，不把跨版本 PNG 字节一致作为要求；宿主 Node 低于 20 时仅报告升级运行环境的处置，不加兼容补丁。名称“安装告警”改为“安全告警”为本轮明确授权的名称修正。

干净临时消费者无锁安装、真实 canary 写图及 worker 读图成功，file-type 21.3.4 的 ASF 告警链已消除；剩余 29 条 high 来自同一 Zod 上游公告，未宣称审计清零。用户禁止本轮打包，未执行同 zip release:verify / consumer smoke；consumer 保持 pending，留候选包时补齐。CLI 只读复核通过。收口全量统一复用 P4，不单跑 test:daily；详见[验收记录](../../harness/reports/remaining-3.1.0-jimp-acceptance.md)。
