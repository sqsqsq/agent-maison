# Phase 6 关键词验收 — 兼容保留项（Allowlist）

> 目的：`rg` 扫描业务专名词表时出现命中时，区分**有意保留**与**应继续清理**的漏网之鱼。  
> 词表字面见本文 **§4**（与本轮 Phase 6 脚本一致）。  
> 「固定五层」词表：`01-Product|02-Feature|03-CommonBusiness|04-BusinessBase|05-SystemBase|五层|01→02→03→04→05|CommUI|CommFunc`。

## 1. 机器可读兼容键名（**不删**，正文已指向中性路径）

| 路径 | 命中原因 |
|------|-----------|
| [`framework/profiles/generic/skills/skill-assets.yaml`](../../profiles/generic/skills/skill-assets.yaml) | `examples_wallet_domain`、`card_opening_*` 为历史外链/旧 SKILL 兼容别名，映射到 `examples-domain-mapping`、`sample-flow`。 |
| [`framework/profiles/hmos-app/skills/skill-assets.yaml`](../../profiles/hmos-app/skills/skill-assets.yaml) | 同上。 |
| [`framework/profiles/hmos-app/skills/0-catalog-bootstrap/profile-addendum.md`](../../profiles/hmos-app/skills/0-catalog-bootstrap/profile-addendum.md) | 表格说明别名键 `examples_wallet_domain`。 |
| [`framework/profiles/hmos-app/skills/5-business-ut/profile-addendum.md`](../../profiles/hmos-app/skills/5-business-ut/profile-addendum.md) | 表格说明 `card_opening_*` 别名。 |

**验收**：除上述 YAML/表格键名外的**教程、模板、prompt、示例正文**不应再出现「计划词表」中的行业专有叙事；正文以中性占位模块（如 `TaskDemo`、`FeatureAlpha`）为准。

## 2. LEGACY DSL / 五层字面（**允许**，与 DSL preset 对齐）

以下内容命中「固定五层」词表属于**契约说明**，与行业专名叙事无关：

- `framework/harness/config.ts` 中 `LEGACY_DEFAULT_DSL` 五外层 id、`CommUI`/`CommFunc` 子层占位。
- `framework/skills/00-framework-init/**` 与 `architecture-presets`、`scan-project` 等：**引导**用户使用或识别 `01-Product`～`05-SystemBase` 式目录。
- `framework/harness/prompts/verify-design.md`、`verify-review.md` 等对「五层合规」检查的层级说明。
- **`harness/tests/fixtures/**`**：`contracts.yaml`、`build-profile`、`02-Feature/Demo/**` 等**历史 fixture 快照**不改语义，保留层 id 字面。

## 3. 工作区瞬时状态（**勿当 SSOT**，可选纳入扫描排除）

以下文件若存在命中，多半来自 adapter/verifier 会话残留或本仓目录名，**不作为 profile 正文质量评判依据**：

- `framework/harness/state/last-verifier-report.{json,md}`（若在仓库中出现）。
- 应用工程根路径名中含产品代号（不与 framework Profile 耦合）时，可排除在 Profile 正文扫描之外。

建议在跑「正文词表扫描」时对 `framework/harness/state/` 使用 `--glob '!**/state/**'` 或等价排除。

## 4. 复验命令示例（仓库根）

词表单行文件：[`phase6-keyword-pattern.regex`](phase6-keyword-pattern.regex)（仅含字面，供 `rg -f`；**不要手工改**除非你同步更新本文 §1 判定口径）。

```bash
rg -n -f framework/docs/skills/phase6-keyword-pattern.regex framework \
  --glob '!framework/docs/skills/phase6-keyword-pattern.regex'
```

判定：§1–§3 中已登记命中 → **允许的兼容项**；其它路径 → **继续清理**候选。

---

## 维护同步（2026-05-22）

- 对照 [`DOC_INVENTORY.yaml`](../DOC_INVENTORY.yaml)：`check-testing.ts` 与 `testing-rules.yaml` 仍为 Phase 6 关键词分流 SSOT；本文 §1–§4 判定口径不变。
- **Skill 6 / Hylyre**：testing phase 正文已中性化；legacy 键名 allowlist 仍适用于 profile YAML 别名，不适用于 Hylyre plan/steps 契约。
- **`doc_freshness`**：当任一登记 `sources[]` 的 git 提交时间晚于本文时，需复核本节并与 [`phase6-keyword-pattern.regex`](phase6-keyword-pattern.regex) 对齐后再提交本文。
