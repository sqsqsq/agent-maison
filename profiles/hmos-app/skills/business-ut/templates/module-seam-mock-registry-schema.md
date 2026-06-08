# 模块级 seam / mock registry Schema

> 路径（默认，可经 `framework.config.json` 扩展）：
> - `doc/modules/<module>/ut-registry/seams.yaml` — seam 台账
> - `doc/modules/<module>/ut-registry/mocks/` — 可复用 mock/fixture

## 目的

模块级沉淀 **seam 切点** 与 **可复用 mock/fixture**；feature 级 `testability-audit.md` / `mock-plan.yaml` **从 registry 派生或引用**，不在每个需求重造。

## seams.yaml

```yaml
schema_version: "1.0"
module: wallet-main
seams:
  - id: seam-api-gateway
    kind: port_boundary
    target: ApiGateway.fetchBalance
    file: 02-Feature/WalletMain/domain/ApiGateway.ets
    mock_refs:
      - mocks/balance_ok.json
    notes: 余额查询外端口
```

## mock/fixture 文件

- JSON/YAML 片段或宿主 profile 约定的 typed mock 描述。
- feature 级 `mock-plan.yaml` 通过 `registry_ref: seam-api-gateway` 引用。

## business-ut 衔接

- Step 1.5/1.6 仍产出 feature 级 audit/mock-plan，但须 **优先引用** 本模块 registry 已有 seam。
- `ut-file-scope.ts` 的 scoped/all 语义不变。
