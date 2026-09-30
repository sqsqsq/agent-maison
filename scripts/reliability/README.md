# 可靠性度量：指标脚本、观察记录与宿主执行程序

开发仓文档，不进发布件（根 `scripts/` 整体排除，见 `scripts/release-excludes.json`）。
对应 plan：`.cursor/plans/可靠性基线与任务集_指标口径与十三场景及基线记录_1dbe4fa4.plan.md`（下称 P1）。

目录：

| 路径 | 内容 |
|---|---|
| `scripts/reliability-metrics.mjs` | 指标脚本入口 |
| `scripts/reliability/observations/TEMPLATE.json` | 观察记录模板 |
| `scripts/reliability/observations/<标签>.json` | 各次观察记录 |
| `scripts/reliability/baselines/<标签>.md` | 用观察记录出的表 |

## 1. 指标脚本

脚本只读，不向被分析的工程写任何文件。在仓库根执行，需要先在 `harness/` 下装过依赖（它用 harness 的 ts-node）。

```bash
# 分析一个工程里某个 feature 的全部 run
node scripts/reliability-metrics.mjs --project <工程根> --feature <feature id> \
  --framework-root <工程根>/framework --observations <观察记录.json> --format md

# 只有若干 run 目录（每个目录含 events.jsonl 与 manifest.json）
node scripts/reliability-metrics.mjs --runs-dir <目录> [--runs <id,id>] [--observations <json>]

# 场景套件的实测结果
node scripts/reliability-metrics.mjs --scenario-results <json> --format md
```

| 参数 | 说明 |
|---|---|
| `--project` / `--feature` | 工程根与 feature id，必须同时给。给了才评估"记录与当前义务" |
| `--framework-root` | 工程里安装的框架目录。评估宿主的完成记录时必须传宿主那一份，否则门禁指纹对不上 |
| `--runs-dir` | 直接给 run 目录的父目录。只有 events 与 manifest，记录与当前义务标"无法评估" |
| `--runs` | 逗号分隔的 run id。给了就把这些 run 合成一个任务；不给则按交付周期内的 supersede 血缘自动分组 |
| `--observations` | 一份观察记录（JSON）。不给时所有任务的操作者动作都是"未知" |
| `--scenario-results` | 一份场景套件结果文件（见第 3 节） |
| `--format` | `json`（默认）或 `md` |

读表时注意：

- 三类事实分开列：框架是否宣称完成、记录与当前义务、独立验收。结论只在无歧义时给出。
- "操作者动作候选"是事件里的信号，不等于人工救场。只有被观察记录关联上的才算"已确认"。
- "已确认（动作 N）"里的 N 是观察记录 `interventions[]` 的下标，从 0 起。
- 恢复成本按故障逐条列；任务没完成时，任务级一律"未恢复"，计到任务末。
- 重复运行稳定性只把"同一场景、同一分支、不同次运行"当作重复运行；某个场景（加分支）只跑过一次时显示"未测"。

## 2. 观察记录

框架产物里没有的事实（谁做了什么、独立验收结果、环境），由人写进观察记录。一个任务一条 `tasks[]`。
从 `observations/TEMPLATE.json` 复制一份改名，所有尖括号占位都换成实际值；不知道的写"未核"，不要猜。

| 字段 | 写什么 |
|---|---|
| `label`、`recorded_at` | 标签与记录时间 |
| `framework_source_commit` | 被测框架的 source_commit（宿主 `framework/RELEASE-MANIFEST.json` 里的 `source_commit`） |
| `initial_state` | 宿主提交号、工作区状态、初始现场存档路径与校验和 |
| `environment` | adapter 与版本、实际生效的模型与推理强度、设备、视觉 provider、adapter 用户配置中的默认模型；`changes` 写运行前后对环境做的设置与还原 |
| `tasks[].scenarios` | 覆盖的场景编号 |
| `tasks[].feature` | feature id（与 `--feature` 相同） |
| `tasks[].runs` | 本任务的全部 run，按时间顺序。启动即失败、没落 supersede 事件的 run 也要写，脚本据此补入任务 |
| `tasks[].recoverable_fault` | 前提里是否有可恢复故障（自动恢复指标的分母） |
| `tasks[].unaffected` | 可选。不受扰动影响的阶段与扰动点，给了才有无影响阶段重跑的精确值 |
| `tasks[].interventions[]` | 每个人工动作一条，见下。**必须显式写**：没有人工动作写 `[]`，表示明确零次；缺这个字段表示没有提供动作信息，脚本按“操作者动作未知”处理，该任务不计入正确自主完成与自动恢复的分子 |
| `tasks[].independent_acceptance` | `result` 取 `pass` / `fail` / `not_accepted`，写验收人与依据 |
| `tasks[].source` | 这条观察是谁、依据什么写的 |

`interventions[]` 每条：`kind`（`rescue_command` 救场命令、`manual_file_edit` 手工改文件、`config_change` 改配置或同步框架包、
`reauthorization` 重新授权、`product_decision` 产品决策，最后一种单列不算救场）、`at`、`content`、`actor`、`necessary`、`related_events`。

**怎么关联候选信号**

1. 先不带 `--observations` 跑一次脚本，看"操作者动作候选"一节。每条候选有 run id、事件序号与时间。
2. 对每个人工动作，把它引起的候选写进 `related_events`：`{ "run_id": "...", "event_index": N }`，或用 `ts` 代替 `event_index`。
3. 一个动作引起多个信号（例如起跑时既钉模型又写 supersede），全部写进同一条的 `related_events`，只算一次动作。
4. 动作没有对应的候选（例如手工 `npm install`、手工打补丁），`related_events` 留空，在 `content` 里写清楚。它照样计为一次动作。
5. 查不清是谁发起的候选（例如宿主桥自己恢复还是人发了命令），不要关联，让它保持"未确认"，在 `content` 或 `source` 里说明。
6. 带上 `--observations` 再跑一次，确认已确认/总数与你的判断一致。

实例：`observations/host-history-20260928.json`（宿主历史参考值，出表见 `baselines/host-history-20260928.md`）。
这份数据跨多个框架版本、初始现场不同，只作参考，不与受控基线混算。

## 3. 确定性层：场景套件

十三个场景的确定性重放在 `harness/tests/unit/reliability-scenarios.unit.test.ts`，场景登记表在
`harness/tests/fixtures/reliability-scenarios/registry.json`。套件是 release-only：日常 `npm test` 只检查文件存在；
`release:all` 会执行它。整套约 10 分钟，本机需要 PATH 里有 `claude` CLI（S2 用）。

单跑并出表（Git Bash）：

```bash
cd harness
RELIABILITY_RESULTS_OUT=../dist/reliability-scenarios.json npm run test:unit -- --filter reliability-scenarios
cd ..
node scripts/reliability-metrics.mjs --scenario-results dist/reliability-scenarios.json --format md
```

PowerShell 下先 `$env:RELIABILITY_RESULTS_OUT = "..\dist\reliability-scenarios.json"` 再跑同一条 npm 命令。
不设 `RELIABILITY_RESULTS_OUT` 时套件不写任何文件。结果文件每个分支一条任务，带 `scenario_meta.branch`。

## 4. 真实 agent 层：宿主执行程序

### 4.1 责任与时机

- 责任方是**宿主操作者**。结果是 P1 的交付项（t5），取得之前 P1 与上位总纲的 P1 都不关闭。
- 必须在宿主同步下一个候选包**之前**做完。宿主当前框架 source_commit 是 `074a4c3c`（`framework/RELEASE-MANIFEST.json`），跑之前先核对。
- 宿主：`D:\1.code\SimulatedWalletForHmos`；feature：`cu-YmMtb3BlbkNhcmQtMgBvcGVuLWNhcmQtZmxvdy12Mg`
  （目录 `doc/features/bc-openCard-2/open-card-flow-v2`）。

### 4.2 两个任务覆盖四个场景

| 任务 | 场景 | 起跑条件 | 请求（对宿主 agent 说的唯一一句） |
|---|---|---|---|
| 甲 | S1 | adapter 默认模型设为当前账号不支持的型号（4.4） | 完成开卡需求 bc-openCard-2 的交付 |
| 乙 | S5、S6、S11 | 可运行配置：默认模型是账号支持的型号 | 完成开卡需求 bc-openCard-2 的交付 |

- 每个任务都从初始现场存档恢复后开始（4.3）。
- 不给逐步救场话术。宿主 agent 停下来问什么，都如实回答需求层面的问题，但不指点命令、旗标、supersede 目标或模型。
  过程中发生的任何人工动作都写进观察记录。
- 任务甲在启动处被阻断时，后面的场景没有执行到，不算覆盖。
- 宿主 run `20260928T043051Z-be091c` 是同一框架版本（074a4c3c）、同一现场下已经发生过的一次任务甲，可直接作为任务甲的基线，
  观察记录据实补写。再跑一次任务甲只用于重复稳定性，不是必须。
- 首轮每个任务跑一次，重复运行稳定性记"未测"。

### 4.3 初始现场：存档、恢复、可恢复性核对

存档位置：maison 仓 `dist/reliability-baseline/host-initial-state-20260928/`（2026-09-28 取得；`dist/` 不进版本库，不要删）。

| 文件 | 内容 |
|---|---|
| `host-head.txt` | 宿主提交号 `025d1b6b013667ef63d190fb13054a52c0a55f44`（其中 `framework/` 是 074a4c3c 候选包） |
| `host-status.txt` | 存档时的 `git status --short`（13 个已改、11 个未跟踪，共 24 行） |
| `tracked-changes.patch` | 已跟踪文件的改动补丁（13 个文件，无二进制） |
| `untracked-files.tgz`、`untracked-files.txt` | 未跟踪文件包与清单（11 个，含一张 png） |
| `feature-dir.tgz` | `doc/features/bc-openCard-2/open-card-flow-v2/`（1466 个文件，含 goal-runs）与 `doc/features/原始需求/`（31 个文件），共 1497 个。`tar -tzf` 列表里中文路径显示为八进制转义。它的 bc-openCard-2 部分已被下一行的 full 包取代，恢复时只取其中的 `原始需求` |
| `feature-dir-bc-openCard-2-full.tgz` | 整个 `doc/features/bc-openCard-2/`：`blueprint/`（2）、`open-card-flow/`（32）、`open-card-flow-v2/`（1466），共 1500 个文件，与磁盘逐一对上。补档时宿主未变化（HEAD 025d1b6b、状态 24 行、最新 run 仍是 be091c）。宿主 `doc/features/` 被 `.gitignore` 忽略，所以单独打包 |
| `framework.config.json`、`framework.local.json` | 两份框架配置（后者被宿主 `.gitignore` 忽略） |
| `SHA256SUMS` | 补丁、未跟踪文件包与两个 feature 包，共 4 个文件的校验和 |
| `ARCHIVE-NOTES.txt` | 存档说明（取档时间、各包内容、未存档项） |

两份配置不在 `SHA256SUMS` 里，校验值：

| 文件 | sha256 |
|---|---|
| `framework.config.json` | `0af1767358ce189d1e8410638423fb32d3ae4e51d8aba9f89c539db8fcb5022d` |
| `framework.local.json` | `95e2ea3f5253a30618a92934841449a93a32a78f9719e24747d8fab054044f1c` |

**仍未存档**（恢复时不会被还原）：

- 场外的恢复检查点（`~/.maison/goal-checkpoints`）。恢复现场后起的是新 run，前提是不依赖旧 run 的场外状态。
- `doc/features/` 下其它 feature（bc-openCard-2 与 `原始需求` 之外）。
- 构建缓存。

**可恢复性核对**（不碰宿主工作区；Git Bash，在系统临时目录做，做完删掉）：

```bash
A=/d/1.code/agent-maison/dist/reliability-baseline/host-initial-state-20260928
H=/d/1.code/SimulatedWalletForHmos
T=$(mktemp -d)
(cd "$A" && sha256sum -c SHA256SUMS)                                   # 1. 四个文件校验和 OK
sha256sum "$A"/framework.config.json "$A"/framework.local.json          # 2. 与上表一致
git -C "$H" cat-file -e "$(cat "$A/host-head.txt")^{commit}" && echo ok # 3. 宿主提交存在
git -C "$H" archive "$(cat "$A/host-head.txt")" $(sed -n 's/^ M //p' "$A/host-status.txt") | tar -x -C "$T"
(cd "$T" && git apply --check "$A/tracked-changes.patch" && git apply "$A/tracked-changes.patch")  # 4. 补丁能打上
tar -xzf "$A/untracked-files.tgz" -C "$T"
diff <(tar -tzf "$A/untracked-files.tgz" | sort) <(sort "$A/untracked-files.txt")                 # 5. 清单一致
tar -xzf "$A/feature-dir-bc-openCard-2-full.tgz" -C "$T"
find "$T/doc/features/bc-openCard-2" -type f | wc -l                                              # 6. 1500
tar -xzf "$A/feature-dir.tgz" -C "$T" --exclude='doc/features/bc-openCard-2'                     # 只取原始需求
find "$T/doc/features" -type f -not -path "*/bc-openCard-2/*" | wc -l                             # 7. 31
while read -r p; do [ -e "$T/$p" ] || echo "missing $p"; done < <(cut -c4- "$A/host-status.txt") # 8. 无输出
rm -rf "$T"
```

宿主工作区还没动过时，可以再加一步：把 `$T` 里 `host-status.txt` 列出的 24 个文件与宿主现有文件逐个比对（忽略 CR，
宿主 `core.autocrlf=true`），应当全部相同；`$T/doc/features/bc-openCard-2` 与 `$T/doc/features/原始需求` 分别与宿主同名目录 `diff -rq` 应无差异。

**恢复步骤**（在宿主根执行；会丢弃宿主当前工作区，先确认没有要保留的东西）：

1. 结束所有还在跑的 goal 进程。
2. `git reset --hard <host-head.txt 里的提交号>`，再 `git clean -fd`（不带 `-x`，被忽略的 `doc/features/`、`framework.local.json` 不受影响）。
3. `git apply <存档>/tracked-changes.patch`。
4. `tar -xzf <存档>/untracked-files.tgz -C .`。
5. 删掉整个 `doc/features/bc-openCard-2`，再 `tar -xzf <存档>/feature-dir-bc-openCard-2-full.tgz -C .`（含 blueprint、旧 CU、open-card-flow-v2）。
6. 删掉 `doc/features/原始需求`，再 `tar -xzf <存档>/feature-dir.tgz -C . --exclude='doc/features/bc-openCard-2'`
   （只取原始需求，不让旧包覆盖上一步恢复的 bc-openCard-2 子树）。
7. 把存档里的 `framework.config.json`、`framework.local.json` 复制到宿主根，覆盖现有文件。
8. 核对：`git rev-parse HEAD` 等于 `host-head.txt`；`git status --short` 与 `host-status.txt` 一致（24 行）；
   `framework/RELEASE-MANIFEST.json` 的 `source_commit` 是 074a4c3c；`doc/features/bc-openCard-2` 共 1500 个文件、`doc/features/原始需求` 共 31 个。

### 4.4 S1 故障条件的设置与还原

S1 的故障来自 adapter 用户配置里的默认模型，两份框架配置重建不了它。宿主 adapter 是 codex，配置文件是 `~/.codex/config.toml` 的 `model`。

1. 记下当前值（2026-09-28 下午为 `gpt-6-astra`）。
2. 任务甲起跑前改成当前账号不支持的型号（已知 `gpt-6-sol` 会返回 400 model is not supported）。
3. 任务甲结束后改回第 1 步的值。
4. 设置与还原都写进观察记录 `environment.changes`，不写进 `interventions`，不算救场。

任务乙起跑前确认默认模型是账号支持的型号（例如 `gpt-5.5`，ae92d8 用它跑通过 coding）；如需修改，同样写进 `environment.changes`。

### 4.5 每次运行要记录的环境

| 项 | 从哪里看 |
|---|---|
| 模型 | run 目录 `manifest.json` 的 `adapter_model_pin`；没钉时就是 `~/.codex/config.toml` 的 `model` |
| 推理强度 | `~/.codex/config.toml` 的 `model_reasoning_effort`（没写就写"未设置"） |
| adapter 版本 | `codex --version` |
| 设备 | `hdc list targets` 的序列号（历史用的是真机 3UJ0225321000395） |
| 视觉 provider | 宿主 `framework.local.json` 的 `vision.visual_provider`（当前 claude / claude-opus-5） |
| adapter 用户配置中的默认模型 | `~/.codex/config.toml` 的 `model` |

任何一项与上一次不同都写进观察记录，不做归一。

### 4.6 独立验收

由人做，不看框架自己的结论。对照需求原文（`doc/features/原始需求/` 下对应需求与 feature 的 `acceptance.yaml`）逐条检查产品，
在真机上走一遍开卡流程并截图。至少检查：

- 结果页没有需求排除的 NFC 内容（历史缺陷：`AddCardResultPage.ets` 中 id 为 `result_nfc_card` 的 NFC 卡）；
- 卡类型半模态完整显示在安全区内，"同意并继续"按钮没有被裁切、可点，点击后流程能推进到下一步；
- 需求里其余每一条。

框架宣称完成与否都要做；未宣称完成时也记录产品当前是否达标。结论写进 `independent_acceptance`：`pass` / `fail`，
依据写清楚逐条结果与截图位置。

### 4.7 给宿主 agent 的话术

起跑任务乙（现场已恢复、配置已核对之后，只说这一句，不加任何命令提示）：

> 完成开卡需求 bc-openCard-2 的交付。

结束后要回报（任务停下、宣称完成或你决定不再推进时说）：

> 请把这次交付的情况如实告诉我：按时间顺序列出这次起过的所有 run id；每个 run 的最终状态和停止原因；
> 过程中你或我做过的每一个额外动作（命令、手工改文件、改配置、重新授权、问过我的问题和我的回答），各自在什么时间、为什么做；
> 框架有没有宣称完成。不要替我做独立验收，产品检查我自己来。

任务甲起跑用同一句请求，回报用同一段话。

### 4.8 出表

1. 按回报与自己的记录，从 `TEMPLATE.json` 写一份观察记录（例如 `observations/host-baseline-20260928.json`），任务甲、乙各一条。
2. 先不带观察记录跑一次脚本看候选，按第 2 节关联，再带上观察记录出表：

```bash
node scripts/reliability-metrics.mjs --project "D:\1.code\SimulatedWalletForHmos" \
  --feature cu-YmMtb3BlbkNhcmQtMgBvcGVuLWNhcmQtZmxvdy12Mg \
  --framework-root "D:\1.code\SimulatedWalletForHmos\framework" \
  --observations scripts/reliability/observations/host-baseline-20260928.json --format md \
  > scripts/reliability/baselines/host-baseline-20260928.md
```

3. 两个任务跑在同一 feature 上时，脚本按 supersede 血缘分组；恢复现场后新 run 的血缘可能接到存档里的旧 run 上，
   以观察记录里 `tasks[].runs` 为准核对分组是否正确，不对就用 `--runs` 按任务分别出表。
