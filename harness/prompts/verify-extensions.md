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

> 本文件是**模板**。实际投递给你的 `ai-prompt.md` 尾部带一个
> `<!-- maison-verifier-subject:v1 -->` 机器块，里面写死了本轮的 `verifier_subject_id`
> 与终态块的完整格式——**以那份为准**。此处不再复述协议正文：同一协议出现两份副本，
> 迟早会漂移，而机器块才是 hook 真正解析的那一份。
>
> 若你收到的 prompt 里**没有**那个机器块，说明调用方没有原样投递 `ai-prompt.md`：
> 照常输出审查结论，并在正文显著位置说明「缺 verifier 证据身份块，本次报告不可入闭环，
> 请调用方原样投递 ai-prompt.md 后重跑」。**不要自行编造 subject。**
