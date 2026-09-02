# Hylyre Phase 0 契约冻结包（trace `0.4-p0` / `hylyre.step-outcome/1`）

M1 的**唯一**契约与 fixture 真源。Maison 的 typed parser、schema dispatch、selector gate、
failure routing 与 report-only 全链回归都对着这份跑，**不另抄一套同义 fixture**
（plan a6c4e9f2 T7a；Hylyre 需求文 §十四.1）。

## 身份

| 项 | 值 |
|---|---|
| `source.tree_sha256` | `cc738c272324022d7ed559340e9c710f9b7f5f94aac62c5dd70042e827a21bae` |
| bundle | `hylyre-contracts-0.4-p0-cc738c272324.zip`（sha256 `d113d2ee6ac23c1cd0df1fafff4a18304db36b11a93e947b44834bf3d4f07a0c`） |
| 文件数 | 226 |
| `hylyre_version` | `0.5.0` |
| `result_protocol` | `hylyre.step-outcome/1` |
| `trace_schema_version` | `0.4-p0` |
| 来源 | `D:/1.code/Hylyre/dist/contracts-freeze/`，2026-08-31 |

`tree_sha256` 的算法由包内 `release.manifest.json` 的 `note` 自述：对 `source.root` 下所有文件按
POSIX 相对路径字节序排序，拼接 `"<path>\n<sha256>\n"` 后取 sha256。
[`hylyre-contracts-freeze.unit.test.ts`](../../unit/hylyre-contracts-freeze.unit.test.ts)
每次跑测都复算一遍——包被替换或就地改动即红。这条自证是有意的：本包在交接过程中被重切过两次
（见下），靠人记指纹不可靠。

## 这是什么 / 不是什么

- **不是** Hylyre 发布件。manifest 自带 `not_a_release: true`，包内无 `pyproject.toml`、无生产模块，
  `pip install` 按构造就不可能成功。**不要安装它**。
- 它只承载契约与样例：`output-schema.json`（Schema）、`step-outcome-v1.md`（规范）、
  `builder-decision-table.md`（规范性判定表）、`reference_reducer.py`（参考 reducer）、
  `report-sections.yaml`、`golden/**`（12 类正反例）。
- 因此它落在 `harness/tests/fixtures/**`：该路径由 `scripts/release-excludes.json` 排除，
  不会误入 consumer 发布件。
- 它**不替代** `profiles/hmos-app/vendor/hylyre/src/**`；后者当前是 Hylyre 0.5.0 运行时源码（tree `8f00a37f…d38d`），本目录仍是契约冻结与 golden 回归的独立 oracle。

## 交接期间的三次重切（保留记录，避免以后误判）

| 指纹 | 文件数 | 与前一版的差异 |
|---|---|---|
| `e0833814cb97…df31` | 223 | 最初交接值 |
| `a047d52e33be…a384` | 225 | Phase 1 实现发现 `selectorSelectedV1.id` 要求非空，使「纯文本匹配命中的 id-less 节点」不可表达；改为 `id` 可空 + `anyOf(id \| bounds)`，spec §6.1 补案例，新增 2 个 golden（2 改 2 增 0 删） |
| `623d6c5f2147…40c4` | 225 | **仅** `step-outcome-v1.md` 一个文件：新增 §6.1「native（provider 侧解析）路径的 resolution」。Schema / goldens / 判定表字节未变 |
| `cc738c272324…1bae` | 226 | Q5+Q8 冻结：`step-outcome-v1.md` 补 §8.1 路径解析基准与 §2.4 多根 MAY、`output-schema.json` 给 `artifactRef.path` 加 description（**校验语义零变化**，剥掉 description 后 definitions 逐字等价）、`builder-decision-table.md` §G 写入路径基准，新增 golden `trace/valid/prior-step-references-an-earlier-root.json`（3 改 1 增 0 删）|

前两次改动经用户确认在验收覆盖内；第四版由 Hylyre 交付并经三坐标（zip sha256 / tree_sha256 / 文件数）逐一核对后整体替换。**当前冻结版为 `cc738c272324…1bae`**。

## M2 vendor 接入（已完成）

Hylyre 0.5.0 真实 source 已于 2026-08-31 交付并 review 通过，该证明**已机器复核**：

| 项 | 值 |
|---|---|
| source 交付物 | `D:/1.code/Hylyre/dist/release-src/`（309 文件，plain-source） |
| `source.tree_sha256` | `8f00a37f2fc08237e21d5523ddd77d084eac90597cd9e9a3770dc76f9924d38d`（2026-09-01 同版本 steps-file fake 修复重发；初版为 `351f61ab…1380`） |
| `contracts_tree_sha256` | `cc738c272324022d7ed559340e9c710f9b7f5f94aac62c5dd70042e827a21bae` |
| `hylyre.__version__` | `0.5.0` |

复核方式不是采信 manifest 声明，而是从 `src/hylyre/contracts/` 逐文件重算：
**226 / 226 与本 fixture 逐字节相同，只在 source / 只在 fixture / 内容不同均为 0**，
重算的 contracts tree 等于 `cc738c272324…1bae`。即「发布件逐字携带这些契约」成立。

vendor 已切到该 source；生产 schema 从 vendored contracts 读取，本 fixture 继续承担冻结包指纹自证、
golden 正反例与 normal/report-only 回归 oracle，不因运行时接入完成而退役。
