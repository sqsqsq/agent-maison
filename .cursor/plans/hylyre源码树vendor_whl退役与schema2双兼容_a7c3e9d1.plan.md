---
name: hylyre 源码树 vendor — whl 退役与 schema 2 双兼容
version: 3.0.0
todos:
  - id: t1-vendor-sync-schema2
    content: "P0 · vendor-sync 纯函数层扩 schema 2（hylyre-vendor-sync.ts）。**①类型**：`HylyreVendorManifestShape` 扩为 schema 1|2 联合——schema 2 形态 `{schema: 2, hylyre_version, source: {root, file_count, total_bytes, tree_sha256, files: [{path, sha256, size_bytes}]}}`，`wheel` 字段可选（schema 1 不变）。**顺手（评审 4 P2）**：manifest 读取处剥 BOM（`^\\uFEFF`）——Hylyre 侧已改 utf-8-sig 写读，maison 现为裸 `JSON.parse(readFileSync utf-8)`，BOM 直接抛异常（schema 1 既有暴露一并治）。**②tree hash（评审 3 P0：清单枚举法，禁目录 walk）**：新增 `sha256TreeFromManifest(rootAbs, files)`——按 **manifest.source.files 声明清单**逐个读文件计算（算法与 Hylyre 需求 R3 逐字对齐：POSIX 相对路径字节序升序、逐文件落盘字节 sha256 hex 小写、拼接 `\"<path>\\n<sha256>\\n\"` 后对 UTF-8 字节整体 sha256；声明文件缺失=对齐判定按内容不符处理）。**不做目录 walk**：walk 会把 `__pycache__`/编辑器临时文件等 vendor 杂物计入实测 hash → 假触发 manifestArtifactMismatch『发布件损坏』硬错误（device-test-run.ts:971-975 路径），且迫使 maison 永久维护一份与 Hylyre 打包排除规则逐字同步的隐性契约；声明清单法抓『声明文件被改/缺失』（对齐判定所需的全部），『src 内未声明文件』的检测职责归 Hylyre `--verify`（R5b + t5① 同步流程第③步），边界写死。**③选型（评审 3 P1：回落须可验真）**：新增 `pickVendorInstallable(vendorDirAbs, manifest)` 返回 `{kind: 'source'|'wheel', path}`——manifest.schema===2 且 `<vendor>/src/` 存在 → source（path=src 目录绝对路径）；schema 2 但 src/ 缺失 → **仅当 manifest.wheel 字段在场**（有 sha 可校验）才回落 wheel，否则返回 null 走 t2④『vendor 发布件缺失』硬错误——**禁止**静默回落到无 manifest 背书的旧 whl（版本可能恰好相同、零告警装错件）；schema 1 与 manifest 缺失时维持现 `pickVendorWheelPath` 行为逐字不变。双存（过渡期本地 whl+src 并存）时 source 优先。**④指纹泛化**：`HylyreInstallFingerprint` 加可选 `artifact_kind: 'wheel'|'source'` 与 `artifact_sha256`；读侧兼容旧指纹（无 artifact_kind → 视为 legacy wheel 指纹，读 `wheel_sha256`）；`evaluateVendorSyncNeed` 的 `wheelSha256` 入参泛化为 `artifactSha256`（source 模式传 manifest.source.tree_sha256 与实测 tree hash 比对；`manifestWheelMismatch` 泛化为 `manifestArtifactMismatch`——源码模式=实测 tree_sha256 ≠ manifest 声明，即发布件损坏/被篡改）；legacy 指纹遇 source 模式 → needsSync（一次性重装，无需手删 venv）。**⑤单测**：hylyre-ensure-upgrade.unit.test.ts 扩矩阵——schema 2 fixture 按需求 R1-R3 **合成生成**（tmp 目录造 src/pyproject.toml+src/hylyre/ 假包+manifest，不依赖 Hylyre 交付）：source 优先于 wheel、schema 1-only 回归逐字不变、tree hash 确定性（顺序无关/内容敏感）、legacy 指纹触发重装、声明文件被改/缺失判 manifestArtifactMismatch、**src 内混入未声明杂物（`__pycache__/*.pyc`、编辑器临时文件）不改变 tree hash 不触发 mismatch**（评审 3 P0 反例格）、**schema 2 + src 缺失 + manifest.wheel 在场 → 回落 wheel 且 sha 可验**、**schema 2 + src 缺失 + 无 wheel 字段 → 选型返回 null（缺失硬错误格）**（评审 3 P1 两格）。"
    status: completed
  - id: t2-ensure-source-install
    content: "P0 · ensureHylyreReady 双模安装（providers/device-test-run.ts）。**①选型替换**：`findVendorWheel` → `findVendorInstallable`（消费 t1③），首装、contracts 强制重装、vendor 对齐三处调用点全部切换。**②临时目录防污染（关键）**：source 模式安装前**先清空整个 `.hylyre/build-src/`**（评审 3 P2：删除失败留到下次开头自愈，不缓慢堆积），再把 `src/` 整树拷贝到 `.hylyre/build-src/<version>-<treeHash前8>/`（拷贝按 manifest.source.files 声明清单逐文件进行，杂物天然不入副本），`runHylyrePipInstall` 的安装目标指向该拷贝（argv 形态 `pip install <tmp副本> \"hylyre[device,mcp]\" [--extra-index-url …]`，upgrade/force-reinstall 两模式同路）；装完 best-effort 删除（失败不报错——`.hylyre/` 已在 gitignore/release excludes 双层覆盖）。动机：pip ≥21.3 对目录是 in-tree build，直接装会在 vendor 目录产 `build/`、`hylyre.egg-info/` 污染仓库（Hylyre 仓根有活证据）。wheel 模式不拷贝、现路径逐字不变。**③指纹写入**：source 模式 `fingerprintFromManifest` 写 `artifact_kind:'source'` + `artifact_sha256`=tree_sha256；wheel 模式沿用现字段并补 `artifact_kind:'wheel'`。**④错误文案泛化**：『vendor wheel 缺失：…未找到 hylyre-*.whl』→『vendor 发布件缺失：…未找到 src/ 源码树或可验真 wheel』（含 t1③ 的 schema 2 + src 缺失 + 无 manifest.wheel 字段格——此时即便目录里躺着旧 whl 也判缺失，文案指引重新同步发布件）；『重新从 dist/release 覆盖拷贝 wheel』类指引补 src 流程措辞；contracts 修复失败提示（:914 附近）同步。**⑤meta 透传**：ensure meta JSON 增可选 `vendor_artifact_kind`，其余字段（manifestVersion 等）语义不变。**⑥单测**：合成 fixture 驱动——source 模式 pip argv golden（安装目标=临时副本路径而非 vendor 内 src；『无 build//egg-info 污染』在单测语境即此 argv/路径断言，单测不跑真 pip——评审 4 措辞校准）、**build-src 预清空断言（上次残留目录在新一轮安装后消失）**、双存时 source 优先、schema 1-only 全链路回归、schema 2 无 src 无 wheel 字段 → 缺失硬错误、错误文案含双出路。"
    status: completed
  - id: t3-release-pack-chain
    content: "P0 · maison 自身发布打包连环（三处联动 + note 分支）。**①excludes 收窄**：release-excludes.json:23 `profiles/*/vendor/**/*.md` 收窄为 `profiles/*/vendor/*/*.md`（只管 vendor 包根一层）——否则 `src/hylyre/contracts/README.md`（Hylyre package-data）被静默丢出发布包 → 下游 tree_sha256 对不上、Hylyre --verify 报文件缺失，最隐蔽的炸法。includeOverrides 根 README 放行不变。**②泄漏检查豁免**：verify-release-pack.mjs:112-118 vendor 非根 README 的 .md `fail('vendor handover md leaked')` 加 `!f.startsWith('profiles/hmos-app/vendor/hylyre/src/')` 豁免——语义统一为『vendor 根一层管控，src/** 整树放行』。mustExist（:132-143）已含 release.manifest.json 不动；staged manifest 为 schema 2 时追加检查 `src/pyproject.toml` 在包内。**③内嵌自检补用例**：release-pack-rules.mjs:357-365 增——`profiles/hmos-app/vendor/hylyre/src/hylyre/contracts/README.md` 必须 include；根层 `downstream-harness-requests.md` 仍 exclude；根 README 仍 include。**④sanitizeVendorManifest 按 schema 分支**：release-pack-rules.mjs:166-176 现 note 重写硬编码 wheel 话术（含 'pip install <wheel-path>'）——schema 2 时改写为源码话术（'Plain-source release. Install with: pip install <src-dir> …'）；`delete integration_docs` 两 schema 通用不变。**优先级升格为必做（评审 4·真件实证）**：Hylyre 0.3.2 真件的 schema 2 note **实测含 'downstream-harness-requests.md'**（对方合法发挥，与需求 R2 示例文案不同）——现重写条件必然命中，不做 schema 分支则打包时 schema 2 note 被改写成 wheel 硬编码话术。**⑤护栏备注（不改代码）**：`INTEGRITY_BINARY_EXTENSIONS`（framework-integrity.ts:189）与 `RELEASE_BINARY_EXTENSIONS`（release-pack-rules.mjs:9）的 `.whl` 条目**保留为无害死条目**，等价断言单测（framework-integrity.unit.test.ts:471-473）不碰；将来若有人删该条目，会红的是 release-pack-rules.mjs:350-351 的内嵌自检（'.whl must be binary'），两侧集合同步删时等价断言不红——坐标以此为准。**⑥回归**：pack 自检（scripts 内嵌 self-test）+ verify-release-pack 对合成 schema 2 vendor 布局跑通：src 全树入包、根移交 md 仍被排、manifest 已 sanitize（无 integration_docs、note 为源码话术）。"
    status: completed
  - id: t4-ssot-consumers
    content: "P1 · whl 抠文件消费点切到源码树（双模，过渡期不断档）。**①keyset 一致性单测**：hylyre-keyset-consistency.unit.test.ts `extractWheelKeys`（:95-103 从 whl zip 解 `hylyre/api/planned_step_keys.py`）改为双模 `extractVendorKeys`——`vendor/hylyre/src/hylyre/api/planned_step_keys.py` 存在则直读文件，否则 legacy zip 解包；**文档断言（:205-206）同步**：`fields.md` 必须包含的锚从 `hylyre-<version>-py3-none-any.whl` 文件名改为源码路径 `src/hylyre/api/planned_step_keys.py` + manifest 版本标签（src 在场时；legacy 布局维持旧断言）；顺手改两处注释措辞（评审 3 P2）：hylyre-planned-step-keys.ts:2-3『Synced from Hylyre wheel…』与 hylyre-standard-derive-knowledge.ts:13『与 vendor wheel 的一致性』→ 改为 vendor 发布件/源码树措辞。**②runtime-step-evidence 单测**：runtime-step-evidence.unit.test.ts:45-49 `sys.path.insert(0, <whl路径>)` 改为双模——src 在场时 insert src 目录（源码树天然可 import），否则沿用 whl zipimport。**Python 调用必须加 `-B`（或 env `PYTHONDONTWRITEBYTECODE=1`）**（评审 3 P0）：whl zipimport 不写 bytecode 缓存，源码目录 import 默认会往 `vendor/…/src/hylyre/__pycache__/` 写 `.pyc`——弄脏 git 工作树，且若无 t1② 的清单枚举法还会假触发『发布件损坏』毒化后续真机链路；单测补断言：跑完后 vendor src 内无 `__pycache__`。**③文档链接**：hylyre-planned-step-fields.md:3 头部指向 whl 的 markdown 链接改指 `../../../vendor/hylyre/src/hylyre/api/planned_step_keys.py`（随 vendor 落 src 的提交一起改，避免链接先死）。**④负向断言**：公司仓形态（无 whl、有 src）下两个单测均可过——即双模不依赖 whl 存在。"
    status: completed
  - id: t5-docs-and-attrs
    content: "P2 · 文档与外围。**①vendor README 重写**（profiles/hmos-app/vendor/hylyre/README.md）：目录定位从『内置纯 Python wheel』改为『内置明文源码树（公司仓合规）+ 过渡期 wheel 兜底』；三步同步流程改为 Hylyre `build_wheel.py --source` → 复制 `src/`+`release.manifest.json` → `build_wheel.py --verify <vendor目录>`（宽松模式，Hylyre R5b/c）；故障排查表新增 tree_sha256 不符/src 内多余文件两行；『不要做』补『不要手改 src/ 内任何文件（只允许从 dist/release-src 覆盖同步）』。**②措辞同步四处**：profile-addendum.md:70-73（vendor 描述与自动对齐段——wheel sha256 → 发布件指纹/tree_sha256）、skills/feature/device-testing/reference/hylyre-host-preflight.md:31/:51、docs/overview.md:185、docs/profiles/hmos-app-harness-toolchain.md:20。**③注释**：harness/config.ts:256 vendor 注释改『vendor 源码树（或过渡期 wheel）+ release.manifest.json』。**④.gitattributes 可选加固**：追加 `profiles/hmos-app/vendor/hylyre/src/** text eol=lf`——全局 `* text=auto eol=lf` 已保 LF checkout，此条只防 text=auto 启发式误判个别文件，定位为顺手加固非必要前提。**⑤MAINTAINER-CHANGELOG** 记录本变更与双兼容过渡策略（本地仓可留 whl，公司仓只提交 src；harness 自动识别）。"
    status: completed
  - id: t6-regression-e2e
    content: "回归与收口。**①合成 fixture 全链路**：schema 1-only（现状回归逐字不变）/ schema 2-only（公司仓形态）/ 双存（过渡期，source 优先）三布局 × ensure 首装/升级/force-reinstall/contracts 修复矩阵。**②全量**：cd harness && npm test；release pack 自检 + verify-release-pack 对 schema 2 布局（t3⑥）。**③真件同步与端到端（评审 4：前提已成熟）**：Hylyre 0.3.2 真件已产出并经评审独立复算（tree_sha256 自实现比对一致、79 文件全 LF、八格篡改矩阵 8/8、maison 现 schema 1 目录回归 verify=0；verify 退出码口径：声明文件缺失→3、篡改→2）——按用户 2026-08-27 指示随本 plan 实施**直接同步进 vendor**（按新 README 流程：src/ + release.manifest.json，本地过渡期保留旧 whl 双存）并跑 Hylyre `--verify` 复核；fixture 口径按真件校准（版本 0.3.2、file_count 79=77 包文件+src/pyproject.toml+**src/README.md**、note 含移交文档引用）。**宿主 device-testing 真机端到端仍按既有纪律由用户触发，不擅自执行**；实施完成后不擅自 commit，提交分段见『实施与提交边界』。**④公司仓落地口径**：公司仓提交 `src/` + `release.manifest.json` + `README.md`（无 whl）；本地仓过渡期可双存；两形态均被 t1-t4 双模覆盖，无需同步切换。"
    status: completed
overview: >
  公司仓库禁止提交 .whl，maison 现行 vendor（whl + manifest schema 1 + venv 自动对齐）无法随
  宿主仓上传，两边割裂。已与 Hylyre 侧定稿需求契约（R1-R6：明文源码树发布 dist/release-src、
  manifest schema 2 + tree_sha256、LF 落盘、--verify 严格检测限定 src/ 子树、integration_docs
  存在才校验）。本 plan 落 maison 侧：vendor-sync 与 ensureHylyreReady 双兼容 schema 1（wheel）/
  schema 2（源码树），源码优先、wheel 兜底（回落仅限 manifest.wheel 可验真），过渡期两形态并存
  不断档；对齐判定按 manifest 声明清单复算 tree hash（vendor 杂物不假触发『发布件损坏』）；
  pip 安装前将 src/ 按清单拷至 .hylyre/build-src 临时目录规避 pip in-tree build 污染 vendor；maison 自身发布打包的 md 排除/
  泄漏检查收窄到 vendor 根一层（src/** 放行，防 contracts/README.md 被静默丢包）；whl 抠文件的
  两个消费点（keyset 一致性、runtime-step-evidence）切为直读源码（双模）。t1-t5 全部以按需求
  spec 合成的 fixture 落地，不依赖 Hylyre 先交付；真件端到端与宿主验证收口在 t6，由用户触发。
isProject: false
---

# hylyre 源码树 vendor：whl 退役与 schema 2 双兼容（a7c3e9d1）

状态：**v3 已实施并闭环（2026-08-27；t1-t6 全部完成；宿主真机端到端经用户裁决由用户自测，不作为本 plan 交付项——见文末实施记录）**

## 1. 因果链与目标形态

```text
公司仓禁 .whl → maison vendor（whl 单形态）无法进宿主仓 → maison 与 hylyre 集成割裂
  → 方案裁决（三轮 review 收敛）：明文源码树 vendor（77 个纯文本文件，557KB/实测 404KB）
     · 否决 sdist（.tar.gz 同为二进制归档，.gitattributes 同标 binary，政策大概率一并禁）
     · 否决 whl 改名/base64 绕过（政策规避，审计不友好）
  → 目标形态（双兼容，源码优先）：
     vendor/hylyre/src/ 在场（manifest schema 2） → 源码安装（拷临时目录再 pip install）
     仅 whl 在场（manifest schema 1）             → 现状 wheel 链逐字不变
     双存（过渡期本地仓）                          → 源码优先
  → Hylyre 侧契约已定稿移交（需求文档 R1-R6，本仓不实现）：
     dist/release-src = src/{pyproject.toml, hylyre/**} + release.manifest.json(schema 2)
     tree_sha256 确定性算法 / LF 落盘 / --verify 严格检测限定 src/ 子树、
     integration_docs 存在才校验（maison 刻意不提交移交 md 是既有策略）
```

## 2. 已核实事实

| # | 事实 | 证据 |
|---|---|---|
| 1 | vendor 现状=whl+manifest(schema 1)+README；README 明示『本目录仅保留发布件』『不要把 integration_docs / 移交 md 提交进本目录』——integration_docs 缺席是刻意策略非缺口 | profiles/hmos-app/vendor/hylyre/README.md:9、:88-89；release.manifest.json |
| 2 | 安装链：ensureHylyreReady 建 `.hylyre/venv` → `pip install <wheel> "hylyre[device,mcp]" [--extra-index-url]`；upgrade/force-reinstall 同函数；contracts 缺失强制重装；HYLYRE_PYTHON 指定环境版本不符=BLOCKER | providers/device-test-run.ts:439-472、:727-、:791-、:866-、:1007- |
| 3 | 对齐判定纯函数层：manifest shape/wheel 选型/sha256/指纹读写/evaluateVendorSyncNeed 全在 hylyre-vendor-sync.ts，device-test-run 与单测共用 | profiles/hmos-app/harness/hylyre-vendor-sync.ts:8-165 |
| 4 | hylyre 包 77 文件全文本（74 .py + contracts 的 json/yaml/md），含 package-data `hylyre/contracts/README.md`；contracts 走 `[tool.setuptools.package-data]` | D:\1.code\Hylyre\hylyre；pyproject.toml:42-43 |
| 5 | 两处从 whl 抠文件的消费：keyset 一致性单测 zip 解包 planned_step_keys.py + 文档断言钉 whl 文件名；runtime-step-evidence 单测把 whl 塞 sys.path | harness/tests/unit/hylyre-keyset-consistency.unit.test.ts:95-103、:205-206；harness/tests/unit/runtime-step-evidence.unit.test.ts:45-55 |
| 6 | 打包 md 排除连环：excludes glob `profiles/*/vendor/**/*.md`（override 只放行根 README）→ src 内 contracts/README.md 会被静默丢包；verify 侧 vendor 非根 README 的 .md 直接 fail；staged manifest 禁含 integration_docs；manifest 在 mustExist | scripts/release-excludes.json:23、:26；scripts/verify-release-pack.mjs:112-118、:127-129、:132-143 |
| 7 | 内嵌自检钉死 handover md 排除/README 放行/`.whl` 判 binary 三行为——改 glob 或删 .whl 条目会红的坐标在此，非等价断言单测 | scripts/release-pack-rules.mjs:350-365 |
| 8 | sanitizeVendorManifest：剥 integration_docs（两 schema 通用应保留）+ note 含 downstream-harness-requests.md 时重写为 **wheel 硬编码话术**——schema 2 note 会被改写错 | scripts/release-pack-rules.mjs:166-176 |
| 9 | 二进制扩展集合两侧同步：INTEGRITY_BINARY_EXTENSIONS ↔ RELEASE_BINARY_EXTENSIONS 等价断言单测动态 import 钉死；`.whl` 条目保留为死条目则单测零改动 | harness/scripts/utils/framework-integrity.ts:188-192；harness/tests/unit/framework-integrity.unit.test.ts:471-473 |
| 10 | .gitattributes 全局 `* text=auto eol=lf`——文本文件 checkout 恒 LF；maison 发布件既有『LF 归一 + LF 哈希』口径（07-09 事故治理），与 Hylyre R4 需求同源 | .gitattributes:2；framework-integrity.ts:178-186 |
| 11 | pip ≥21.3 对目录是 in-tree build：源目录内产 `build/`、`*.egg-info/`（Hylyre 仓根即活证据）——直接对 vendor/src 安装会污染 maison 工作树，须拷临时目录 | D:\1.code\Hylyre\build、hylyre.egg-info |
| 12 | Hylyre 侧现有 build_wheel.py（--clean 构建 + --verify 校验，退出码 0/2/3）与 framework-vendor-bundle.md 流程——源码模式为其增量，本仓不实现 | D:\1.code\Hylyre\scripts\build_wheel.py；docs/framework-vendor-bundle.md |
| 13 | 给 Hylyre 的需求契约 R1-R6 + 验收 6 条已定稿并移交（R5：严格检测限定 src/ 子树、零豁免名单；integration_docs 存在才校验含字段整体缺失放行） | 本 plan 立项对话（2026-08-27） |
| 14 | manifestWheelMismatch（『发布件与 manifest 声明不符』）走 errors.push 硬错误路径（kind 'vendor'）——tree hash 若按目录 walk 实现，`__pycache__` 等杂物会假触发该错误并毒化后续所有 ensure；whl zipimport 不写 bytecode 缓存、源码目录 import 默认写 `__pycache__`（新增行为，须 `-B` 抑制） | providers/device-test-run.ts:971-975；CPython 默认 bytecode 缓存行为 |
| 15 | Hylyre 0.3.2 真件（评审 4 独立复算）：schema 2、file_count 79（含 src/README.md）、全 LF、note 含 'downstream-harness-requests.md'、tree_sha256 复算一致、篡改矩阵 8/8（缺失→3/篡改→2）、对 maison 现 schema 1 目录回归 verify=0；maison manifest 读取无 BOM 容错 | D:\\1.code\\Hylyre\\dist\\release-src；providers/device-test-run.ts:268 附近 readJsonSafe |

## 3. 明确裁剪

- **不做 sdist、不做 whl 改名/编码绕过**：前者同为二进制归档大概率同禁，后者是政策规避。
- **schema 1 wheel 链路整机保留**：双兼容非迁移式删除；本地仓过渡期 whl+src 双存合法，公司仓只提交 src。
- **不删 `.whl` 扩展名条目**：INTEGRITY/RELEASE_BINARY_EXTENSIONS 两集合与等价断言单测零改动（死条目无害）；护栏坐标=release-pack-rules.mjs:350-351 内嵌自检。
- **Hylyre 侧实现不在本 plan**：需求文档已移交对方 AI；t6③ 仅在真件到位后做契约无出入确认。
- **不碰**：hdc/hypium 传递依赖策略（仍走镜像）、OCR/视觉链、hylyre-root-pollution 守卫、`.hylyre/venv` 布局、HYLYRE_PYTHON 语义。
- **hylyre-planned-step-keys.ts 手抄键表机制不变**：仍是 TS 侧 SSOT 快照，一致性单测（t4①）负责与源码树对账——不改为运行时动态读 py。

## 4. 实施与提交边界

- 实施顺序 t1 → t2 → t3 → t4 → t5 → t6；t1-t5 全部以合成 fixture 落地，**不等 Hylyre 交付**。
- 提交分段建议（按仓库纪律：实施完**不擅自 commit**，plan 的分段只描述边界非提交授权）：
  ① t1+t2（vendor-sync + ensure 双模，含单测）；② t3（打包连环）；③ t4+t5（消费点+文档）。
- t6③ 真件端到端与宿主 device-testing 验证**由用户触发**；本分支（Br_release_3.0.0）完成全部调整与测试后统一 cp 主干，不分批。
- 风险回滚：双兼容意味着任何时点删掉 src/ 恢复 whl-only 即回到现状；无破坏性迁移步骤。

## 5. 评审吸收纪要

| 轮次 | 意见 | 吸收 |
|---|---|---|
| R1 | framework-integrity 与 release-pack-rules 二进制集合联动 + 一致性单测钉死 | `.whl` 条目保留为死条目、单测零改动；护栏坐标修正为 release-pack-rules.mjs:350-351（内嵌自检，非等价断言）→ t3⑤ |
| R1 | fields.md whl 链接 + keyset 单测:205-206 文档断言遗漏 | t4①③ 补全（改指源码路径 + 版本标签，双模） |
| R1 | .gitattributes 新规则非必要前提（全局 text=auto eol=lf 已在） | 降级为可选加固 → t5④；Hylyre R4 需求维持并注明与既有 LF 哈希口径同源 |
| R1 | integration_docs 缺席定性 | 修正为 maison 刻意策略（README:88-89 + sanitize/verify 双证据）；转化为 Hylyre R5c『存在才校验、字段缺失放行』 |
| R2 | `hylyre/contracts/README.md` 撞 md 排除连环三处（excludes glob / verify 泄漏 fail / 内嵌自检），不点名则静默丢包到下游才炸 | t3①②③ 点名落实，语义统一『vendor 根一层管控，src/** 放行』 |
| R2 | sanitizeVendorManifest note 重写 wheel 硬编码 | t3④ 按 schema 分支 |
| R2 | R5 豁免名单会漂移 | Hylyre R5b 改『严格检测限定 source.root 子树、零名单』；vendor 根归下游所有 |
| R3 | **P0**：t4② 源码 import 写 `__pycache__` 弄脏工作树 × t1② 目录 walk 计入杂物 → 假触发『发布件损坏』硬错误，跑一次单测毒化后续真机链路 | 两件套落实：t4② Python 调用加 `-B` + 无 pycache 断言；t1② 改为按 manifest.source.files **声明清单枚举**计算 tree hash（未声明文件检测职责归 Hylyre --verify，边界写死）；事实表 #14 |
| R3 | **P1**：pickVendorInstallable 回落太松——schema 2 + src 半残 + 旧 whl 在场会静默装无 manifest 背书的旧件 | t1③ 收紧：仅 manifest.wheel 字段在场才回落（sha 可验），否则缺失硬错误；t1⑤/t2⑥ 单测各补格 |
| R3 | P2：build-src 堆积 / 两处注释措辞 / t3④ note 触发条件对 schema 2 天然不触发 | t2② 改安装前预清空；t4① 顺手改 hylyre-planned-step-keys.ts:2-3 与 hylyre-standard-derive-knowledge.ts:13；t3④ 补『防御性分支、不得硬造触发』提醒 |
| R4 | **真件（Hylyre 0.3.2）实证**：note 实测含移交文档引用 → t3④ 升格必做；file_count 79（含需求 R1 外多出的 src/README.md，已完整声明且与打包连环天然相容）；verify 缺失→3/篡改→2；真件端到端前提成熟 | t3④ 优先级改写；t1⑤/t6 fixture 口径按 0.3.2 校准；t6③ 改为随实施直接同步真件（用户已指示开工做完；真机验证仍用户触发）；事实表 #15 |
| R4 | P2：manifest 读取 BOM 容错（Hylyre 侧已 utf-8-sig，maison 裸 JSON.parse 遇 BOM 抛异常，schema 1 既有暴露） | t1① 读取处剥 `^﻿` |
| R5 | **P0**：完整性校验晚于第三方源码执行——首装/修复路径先 pip（PEP 517 任意代码执行）后比对 mismatch | ensureHylyreReady 启动早段新增**供给链完整性 fail-fast 门禁**：任何 pip/venv 创建/import 之前按 artifactKind 比对实测指纹与 manifest 声明，mismatch 即 BLOCKER 返回；三条流程改为复用门禁结果；新增生产接线单测（篡改源码 fixture → fail-fast、venv 未创建、build-src 未暂存、日志零 pip/venv 行） |
| R5 | **P1**：schema 2 wheel 回落取 tree_sha256 比 wheel 文件 → 必然假损坏、回落实际不可用 | `manifestDeclaredArtifactSha(manifest, artifactKind)` 按形态取声明值（wheel→wheel.sha256）；evaluateVendorSyncNeed 同步；单测补 wheel 回落 aligned 正例 |
| R5 | **P1**：manifest `source.root`/`files[].path` 可路径穿越（评审实测 staging 写出目标目录外） | `isSafeVendorRelPath` + `isValidVendorSourceDecl`：拒绝绝对路径/盘符/反斜杠/`.`/`..`/空段/重复条目/非 hex sha；readVendorManifest 深校验（畸形=corrupt→null，不落 wheel 扫描）、sha256TreeFromManifest 判 null、staging 先验后写（抛出前零写入）；穿越负例单测 |
| R5 | **P1**：发版门禁未锁死『只发源码 + 源码完整』（工作树遗留 whl 会入包；verify 只查存在性） | excludes 增 `profiles/*/vendor/**/*.whl` + 自检两例；verify-release-pack schema 2 深校验：逐文件 sha/size、file_count、tree hash 复算、src 下未声明文件、vendor 下任何 whl 均 fail；运行时 wheel 兼容代码不动 |
| R5 | P2：『默认 vendor wheel』等文案残留 + 『逐字节一致』过度陈述（旧 wheel 为 CRLF，LF 归一化后才一致） | 五处提示语改『发布件』口径；telemetry 注释/vendor README 改『LF 归一化后内容一致』；config.ts 注释改『maison 只携带源码；代码兼容 legacy wheel 布局』 |
| R5 | 提醒：index 混合状态（whl 删除已 staged、其余未 staged）易形成中间提交 | whl 删除已 unstage，全部变更统一为未暂存，由用户一次 review 提交 |
| R6 | **P1**：staging 子目录名拼入 manifest 自由文本 `hylyre_version`，`../../` 可逃逸 build-src（评审复现） | dest 命名改 `artifact-<treeSha256 前 12>`（仅消费已校验 hex；version 不入路径），且非 hex treeSha 直接抛出；单测补恶意 version 不逃逸 + 非 hex 抛出两格 |
| R6 | P2：两处措辞仍似 maison 会携带 wheel（device-test-run.ts:5 头注、host-preflight.md:51） | 统一为『Maison vendor 只携带源码树；运行时代码兼容 schema 1 legacy wheel』 |

## 6. 实施记录（2026-08-27）

### 交付清单

- **t1**：`hylyre-vendor-sync.ts` 重塑——manifest schema 1|2 联合类型、`stripBom`（评审 4 P2）、`sha256TreeFromManifest`（声明清单枚举，评审 3 P0）、`pickVendorInstallable`（源码优先；schema 2 缺 src 仅 manifest.wheel 在场才回落，评审 3 P1）、`stageVendorSourceForInstall`（预清空 build-src + 按清单拷贝）、指纹 `artifact_kind`/`artifact_sha256`（legacy 兼容读）、`evaluateVendorSyncNeed` 泛化（reason 集合：`artifact_sha256_changed`/`artifact_kind_changed` 新增）。
- **t2**：`device-test-run.ts`——`readJsonSafe` 剥 BOM；`HylyreReleaseManifest` 复用共享 shape；首装/contracts 修复/vendor 对齐三调用点切 `findVendorInstallable` + 临时副本安装；`runHylyrePipInstall` 参数泛化 `target`；错误文案含双出路；meta 增 `vendor_artifact_kind`；`probeRuntimeStepTelemetry` supported 集合扩 `{0.3.1, 0.3.2}`（实证：0.3.1→0.3.2 仅 `__version__` 字符串修正，scenario/harness 模块逐字节一致）。
- **t3**：excludes glob 收窄 `profiles/*/vendor/*/*.md`；verify 泄漏检查 `src/` 豁免 + schema 2 时 mustExist 校验 src/pyproject.toml 与全部声明文件入包；内嵌自检补 src md include 两例 + schema 1/2 note 双话术断言；`sanitizeVendorManifest` 按 schema 分支（0.3.2 真件 note 实测含移交引用，分支必然生效）。
- **t4**：keyset 一致性单测双模（src 直读优先 / legacy zip 回落）+ 文档断言改钉 src 路径；runtime-step-evidence 单测双模 + `-B` + 无 pycache 断言 + 0.3.2 supported 断言；`hylyre-planned-step-keys.ts` 头注 → vendor 0.3.2 源码措辞；`hylyre-standard-derive-knowledge.ts:13` 措辞。
- **t5**：vendor README 全量重写（源码树定位/同步流程/故障排查/不要做）；profile-addendum、host-preflight、overview、toolchain 四处措辞；config.ts 注释；.gitattributes 加 `src/** text eol=lf` 显式加固；.gitignore 加 `**/__pycache__/` 兜底（首次全量单测在 t4② 生效前曾产一枚 wrapper pycache，已删）。MAINTAINER-CHANGELOG 为自动生成物未手改（下次 `release:changelog` 自动带本 plan）。
- **t6/真件**：Hylyre 0.3.2 `dist/release-src` 已同步进 vendor（`src/` 79 文件 + schema 2 manifest；移交 md 未提交）。旧 0.3.1 whl 同步时曾短暂双存，后经用户即时退役裁决删除（见收口边界），vendor 终态无 whl。

### 验证证据

- `cd harness && npm test`：typecheck PASS + 单测 **3574/3574** + fixtures **44/44**（ensure-upgrade 矩阵 19 例含评审 3 P0/P1 反例格；keyset/runtime-step-evidence 双模走 src 真件）。
- Hylyre `build_wheel.py --verify <maison vendor>`：**exit 0**（下游布局：src + manifest + README + 遗留 whl、无移交 md）。
- maison `sha256TreeFromManifest` 对真件复算 = manifest 声明 `c2bd0f36…`（**R3 算法两仓一致性实证**）。
- `npm run release:pack` + verify：synthetic rule tests PASS；zip 内 vendor src **79/79 声明文件全入包**（含 `contracts/README.md`、`src/README.md`），staged manifest schema 2、无 integration_docs、note 保持源码话术。verify 唯一 FAIL 为 plan-version 发布门禁（本分支另有 3 个 version=3.0.0 未完成 plan，属分支常态，非本变更引入）。
- vendor src 安装后无 `build//egg-info/__pycache__` 污染（临时副本安装 + `-B` + 单测断言）。

### 收口边界（2026-08-27 用户裁决闭环）

- **宿主 device-testing 真机端到端**（venv 自动重装为源码安装 → doctor/run 真机闭环）：用户裁决**自行执行、不列为本 plan 交付项**，本 plan 就此闭环。实施侧未跑该层，机器可验层（安装判定、tree hash、打包、单测）已全绿；真机层证据归属用户自测，本 plan 不得引用为已证。
- Hylyre 侧 R1-R6 实现与 `--verify` 归 Hylyre 仓（0.3.2 真件已交付并通过下游校验）；maison 不背书其内部实现。
- **whl 即时退役（2026-08-27 用户追加裁决）**：不走双存过渡——0.3.1 whl 已从 vendor 目录删除，maison 发布件此后只用源码包；wheel 处理代码（schema 1 兼容、pickVendorWheelPath 回落）**保留**。无 whl 形态复验：全量单测 3574/3574 + fixtures 44/44、release pack 内 whl=0 / src 79 文件全入包、Hylyre --verify exit 0。
- **收口 review 三小项（2026-08-27 终审）**：①README『装完即清』与实现不符 → 按 t2② 原文补 `cleanupSourceInstallTarget`（首装/contracts 修复/vendor 对齐三流程 pip 后 best-effort 删除临时副本，失败留给预清空自愈）；②本记录 t6 句『whl 留存双存』旧口径已修正；③留档观察：`pickVendorInstallable` 纯函数对『schema 2 但 source 对象整体缺失』的畸形 manifest 会落到旧 wheel 文件名扫描——实际管线不可达（`readVendorManifest` 已将该形态判 null，与 corrupt manifest 既有语义一致），仅直接调用纯函数时存在。
- **评审 5（2026-08-27 深度安全 review）**：P0 完整性门禁前置（fail-fast 于一切 pip/venv/import 之前，含生产接线单测证明 mismatch 时零 spawn）、P1 三项（wheel 回落按 kind 取声明值、manifest 路径穿越硬拒、发版门禁锁死源码-only 与逐文件完整性）、P2 文案与『LF 归一化后一致』措辞全部落实。复验：全量 3577/3577 + 44/44；synthetic rule tests 过（含 whl 排除两例）；独立深审最终 zip——79 文件逐 sha/size 全对、tree hash 复算一致、src 下零未声明文件、vendor 下零 whl。verify 的 zip 断言段仍被既有 3 个未完成 plan 的版本门禁挡（分支常态），深校验以独立审计补证。
- **评审 6（2026-08-27）**：P1 staging 目录名 version 逃逸修复（dest 只用 hex tree hash + 非 hex 抛出 + 两格单测）；P2 两处 wheel 措辞统一。复验全量 3577/3577 + 44/44。
