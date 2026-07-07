# Delta: Agent Adapters — usage_capture 能力声明

## ADDED Requirements

### Requirement: usage_capture capability field

adapter goal capability MUST 支持 `usage_capture: none|stdout_json|stderr_regex|sidecar|api`（缺省 none）；usage 采集实现 MUST 按声明分派（api/sidecar 优先），MUST NOT 对未声明能力的 adapter 猜测采集方式。

#### Scenario: 未声明即按 none
- **WHEN** adapter manifest 无 usage_capture 字段
- **THEN** 采集按 none 处理，该 adapter 的跑动只产出代理指标

> **Enforced by:** `agents/adapter-schema.yaml`, `harness/scripts/utils/agent-invoke.ts`
