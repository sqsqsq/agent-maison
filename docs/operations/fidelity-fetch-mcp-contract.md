# 宿主 MCP 契约：fetch_fidelity

> SSOT：`specs/fidelity-lock.schema.yaml`  
> maison **不**实现内网鉴权；宿主 MCP server 持令牌并导出 PNG + lock。

## 工具签名

```
fetch_fidelity(source_link, feature, out_dir, screens[])
```

| 参数 | 说明 |
|------|------|
| `source_link` | 在线高保真 URL（http/https） |
| `feature` | 需求 id（`doc/features/<feature>/`） |
| `out_dir` | 快照目录，默认 `doc/features/<feature>/ux-reference/_fidelity-cache/` |
| `screens[]` | 每屏导出规格 |

### `screens[i]`

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | 是 | maison 逻辑 id（= ui-spec `ref_id` / `source_ref`） |
| `node_ref` | 否 | 宿主上游帧选择器（Figma node id / 门户屏 key） |
| `state` | 否 | UI 状态；默认态省略 |

## 产出

- `out_dir/<id>.png` 或 `out_dir/<id>.<state>.png` — 宿主渲染好的参考 PNG
- `out_dir/fidelity.lock.yaml` — 溯源 lock（**不嵌令牌**）
- （可选）`out_dir/structured-elements.yaml` — 第二刀结构化分母；在 lock 中写 `structured_bundle: structured-elements.yaml`

## lock 示例

```yaml
schema_version: "1.0"
source_link: https://internal.example/figma/file/abc
fetched_at: "2026-06-25T10:00:00Z"
version_id: "1287"
viewport:
  w: 393
  h: 852
  dpr: 3
structured_bundle: structured-elements.yaml
screens:
  - id: home
    png: home.png
    node_ref: "12:345"
  - id: page2
    png: page2.png
```

## spec.md 声明（方案 a）

```yaml
ui_change: new_or_changed
visual_handoff:
  kind: fidelity_snapshot
  source_link: https://internal.example/figma/file/abc
  delivery_code: ${env:UX_FIDELITY_CODE}   # 敏感传送码用 env，勿写明文
  snapshot: doc/features/my-feature/ux-reference/_fidelity-cache/
  fidelity_target: pixel_1to1
```

- **不**在 spec.md 写回 N 条 `authoritative_refs[].path`（id→png SSOT 在 lock）。
- harness `fidelity_snapshot_promise` 纯离线校验 lock + PNG 齐。

## refresh

- **有 version API**：先比 `version_id`（一次 metadata），不同才全量重导。
- **hash-only 源**：须全量重取才能算 `content_hash`。

## 本地假宿主 stub

见 [`profiles/hmos-app/harness/demo/fidelity-fetch-stub.mjs`](../../profiles/hmos-app/harness/demo/fidelity-fetch-stub.mjs)（fixture / 演示用，不含真实鉴权）。

## 安全

- 快照目录默认 `docs_committed=false` + `.gitignore`，不入主仓。
- `delivery_code` 若为访问凭证，须 `${env:...}` 或仅本机，勿 commit 明文。
