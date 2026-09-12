# 无 Feature 专项 harness

本入口对应 P6 §3.1–3.2，只完成本次 review/UT/testing 请求，不启动 Feature/Goal 链。路径均由调用方明确指定；不能借用活跃 Feature 或 `_adhoc` 等占位身份。

## Agent / adapter 执行顺序

1. 根据用户已授权目标，写入请求 JSON，选择项目内、framework/.git/features_dir 外的独立报告目录。不要将操作命令字符串写入请求。
2. Agent 自行执行准备命令，读取输出的 request_sha256、已解析基线、目标哈希、facts 路径与 gaps；不要把命令清单转交用户代跑。
3. 执行 Research，阅读实际目标和明确输入。有 base 时使用输出的具体 commit 审查差异；非 WORKTREE 的 review 输入来自该 commit。生成 P1 `schema_version: "1.1"` facts，subject 只含 request_sha256，established_by 为本次 phase，不写 feature/run_id。
4. review 写出真实 review-report；UT/testing 完成其已授权输入准备。新增测试只写 allowed_test_writes，必须有实际行为来源。必要输入变化后重新准备并更新 facts 绑定，不能沿用旧哈希。
5. Agent 运行不带 prepare-request 的同一命令，读取实际 summary/checks。只有请求结果通过才结束；有失败/缺口不声称通过，也不自动追加下一阶段。

```powershell
cd framework/harness
npm run check -- --project-root <host> --phase review --request-file doc/requests/review.json --report-dir doc/reports/review-01 --prepare-request
npm run check -- --project-root <host> --phase review --request-file doc/requests/review.json --report-dir doc/reports/review-01
```

请求示例：

```json
{
  "schema_version": "1.0",
  "phase": "review",
  "requested_result": "审查 Repository 查询代码的正确性",
  "targets": {"files": ["src/rdb/Repository.ts"], "tests": []},
  "baseline": {"base": "HEAD", "head": "WORKTREE"},
  "inputs": {"review_report": "doc/reports/review-01/review-report.md"},
  "allowed_test_writes": []
}
```

无 Git 项目省略 base。Git refs 在每次准备时解析为 commit；WORKTREE 绑定实际文件字节。UT/testing 执行时工作树须与所选 head 对应。显式授权的测试文件属于输出，其编写不会改变请求边界，但本轮实际读取/执行内容仍有独立绑定，运行中变动不被重绑为 PASS。

inputs 使用当前 phase catalog 中可从文件读取的输入 ID；code/test_targets 等派生目标通过 targets 指定。testing 的 cases 文件使用既有 adhoc cases 输入格式。review_report 缺省为本目录 review-report.md，缺失不会被 checker 自动补成通过报告。

显式输入可引用已有设计工件；工件自带的真实来源身份只用于 P1 只读验源，不成为本次请求的 Feature 身份，也不执行其阶段或修改其凭证。

## 结果和隔离

准备命令不运行 checker、不创建目录或控制文件。正常执行复用 active workflow 指定的 checker、规则和 profile，忽略环境中的 Feature/Goal 身份；显式混用 Feature/Goal CLI 参数会失败。request 暂不支持 `--report-reconcile-only`，该组合在 provider 调用前拒绝。

本目录保存 context/facts.md、专业报告、script-report.json、summary.json；summary 明确 subject=request、completion_target=request，并记录请求、基线、目标、输入绑定与真实 evidence 引用。它不是 Feature receipt、attestation 或 completion，不能据此推进 CU/Feature。

report-dir 已有其他请求/基线的机器输出时拒绝复用。目标或来源变化后，Agent 选择另一个明确目录重新准备；不静默覆盖旧结果。路径检查解析真实路径，禁止通过链接写入 Feature 或 framework。Feature 配置解析出的 receipt/report/run 目录即使尚未生成报告也受保护，共享报告根下的独立兄弟目录仍可使用。

## P4/P5 接线合同

公共 checker 边界接受 `CheckContext<'feature' | 'request'>`；request 分支没有 feature/FeatureSpec，旧 Feature helper 保持 Feature 默认类型。

review 复用现有章节、问题、计数、引用、负面结论等检查。UT/testing 通过原 profile 的 ut.run / device_test.run capability 查找 `runRequestTests(ctx)`，不新增 provider registry。该导出须列入原 provider metadata.exports，接收明确目标、基线、P1 输入与 reportDir，返回实际 `{executed, total, failed, checks, evidence_paths}`；原生日志/coverage/trace 放本目录或宿主内独立 provider 目录，不能借 Feature 报告。

本段交付入口与传参/报告闭环；P4/P5 继续迁移专业职责及 HarmonyOS 原生 provider 的 request 支持。**未实现该导出的现有 provider 会明确 BLOCKED/FAIL，不能回落到假 Feature 或用未执行结果签发成功。**本批真实 CLI 测试使用按上述既有 metadata 安装的 Node 测试 provider 验证实际执行；不代表 HarmonyOS/真机专项已通过，真实宿主验收仍由 P7 汇总。
