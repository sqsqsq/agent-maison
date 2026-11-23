# Extensions 阶段语义验证（脚本 Harness 已通过）

## 阶段

extensions

## 功能模块

{feature_name}

## Spec 规约内容

```yaml
{spec_content}
```

## 脚本 Harness 报告

```json
{script_report}
```

## 上下文文件

{context_files}

---

## 终态块（唯一版本化结论出口 · 必填）

> 运行时可在原 request JSON 前附已签复核范围。按 JSON（`kind: "maison_verifier_request"`）
> 内的 `prompt_path` 读取本轮磁盘材料 `ai-prompt.md`。
>
> 结束时，回答的**最后**必须且只能出现一个终态块，`verifier_subject_id` **逐字回显**
> request 里的 `subject_id`（不得改写、不得截断、不得自行编造）：
>
> ```
> <!-- maison-verifier-result:v1 -->
> verifier_subject_id: <request.subject_id，64 位小写 hex>
> verdict: PASS | FAIL
> blocker_count: <BLOCKER 级 FAIL 数量，整数>
> <!-- /maison-verifier-result:v1 -->
> ```
>
> `verdict=PASS` 当且仅当 `blocker_count=0`；两者不一致的报告一律判为无效证据。
>
> request 字段须保持原样。缺合法 JSON（例如仅有 feature/phase 或字段被改）时仍输出审查结论，
> 明示报告不可采信，请运行时重新投递 `summary.verifier_request` 原件。**不要自行编造 subject。**
