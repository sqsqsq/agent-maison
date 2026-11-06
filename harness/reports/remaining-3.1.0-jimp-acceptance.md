# 7b9c43d2 Jimp 升级验收（2026-11-06）

`harness/package.json` 固定 `jimp: 1.6.1`，本地忽略的 lockfile 由 npm 同步。适配 canary、图像 worker、OCR worker 三处生产使用，以及六组测试造图代码；采样算法、阈值、布局和缺包分支未改。plan 名称按用户裁决改为“安全告警”。

| 验证 | 结果 |
|---|---|
| Node / typecheck | 开发与干净临时消费者均 Node `v24.15.0`；typecheck 通过。未操作宿主 Node；若宿主低于 20，升级运行环境后再验，不加兼容补丁。 |
| 固定同图对照 | 旧 0.22.12 基线与 1.6.1 的 crop、top、canary、contact 解码像素及尺寸一致；sample、stats、hist、tile、edge、contact 数值完全一致；新版本重复写图确定。此次四类 PNG 的字节哈希恰好也相同，但不将跨版本字节一致作为契约。 |
| 无锁消费者 | 系统临时目录下只在 `framework/harness` 执行 npm install，依赖链 `jimp@1.6.1 → @jimp/core@1.6.1 → file-type@21.3.4`，未安装旧 `@jimp/custom`。canary 实际写出 2944 字节 PNG，包内 worker 读同图采得 `#FF0000`，900 点，非 SKIP。 |
| 安全审计 | ASF 的 file-type 告警链消失。`npm audit` 仍为非零：29 个 high 均由 Zod 的同一公告传递影响，不能宣称安全告警清零。 |
| 发布件 | 用户本轮明确禁止打包，未执行会生成 zip 的 release:verify、consumer lifecycle smoke；本次是源码复制的消费者安装抽验，不能当成同一发布 zip 验收。留候选包环节补齐，consumer todo 保持 pending。 |

剩余 Zod 告警为 [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)，上游标记 `<4.6.6`；Jimp 1.6.1 使用 3.x。当前 crop/resize/print 调用传入的是框架构造的小参数对象；未证明超大外部集合可以到达该校验点。本批不强升 Zod 4、不降回含 ASF 的 Jimp 0.x、不添加 override。

证据：[旧基线](remaining-3.1.0-jimp-parity.json)、[升级对照](remaining-3.1.0-jimp-result.json)、[消费者读写](remaining-3.1.0-jimp-consumer-result.json)、[审计](remaining-3.1.0-jimp-consumer-audit.json)。CLI 只读复核为 `claude.cmd -p --model opus --effort high --permission-mode plan --tools Read,Grep,Glob --allowedTools Read,Grep,Glob --settings <disableAllHooks> --strict-mcp-config --mcp-config <empty> --output-format json --no-session-persistence`；实际模型 `claude-opus-5-5`，通过，无阻断。见[复核原件](remaining-3.1.0-jimp-review.json)。

`test:changed` 实跑 925 组，5373 passed / 0 failed，424 正式组未执行；额外 c3f8a2d7 t5 恢复链 1/1。13 个目标套件均实际通过，见[目标与执行摘要](remaining-3.1.0-jimp-tests.json)。runner 退出 1，原因是运行期间追加本 plan 实施记录、把 e2 验收报告加入跟踪造成输入漂移；Jimp 的生产与测试输入字节未变。按 AGENTS 的证据异常诊断原则保留原始非绿结论，不修改 runner/state 伪造通过，最终冻结全量继续负责收口。全量前不关闭本项收口状态，不单跑 test:daily。
