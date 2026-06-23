# 图像处理工具选型 Spike

> 窗口：2.4.0 · 视觉保真 M2 前置 · BLOCKER 性质  
> 日期：2026-06-23

## 候选

| 工具 | native 依赖 | host-harness-readiness | 裁图 | 采色 | CIEDE2000 | trim |
|------|-------------|------------------------|------|------|-----------|------|
| **jimp** | 无（纯 JS） | ✅ 不撞零 native 约束 | ✅ | ✅ | 自实现 TS | 可 crop 后扫描 |
| sharp | 是 | ⚠️ CI/Windows 易碎 | ✅ | ✅ | 插件 | ✅ |
| canvas | 是 | ⚠️ | ✅ | ✅ | 自实现 | ✅ |
| python 边车 | 环境 | ⚠️ 与 Hylyre 叠依赖 | ✅ | ✅ | colours | ✅ |

## 结论

**选用 `jimp`（纯 JS）** 作为 hmos-app profile 默认图像后端：

- 与 AGENTS.md「宿主 harness 零额外 native 依赖」兼容；
- bbox 两条兜底可实现：**宽松框 + crop**、**区域众数采色 + 近白/黑过滤**；
- 性能较 sharp 慢，但 spec/coding 离线门禁可接受。

## 集成点

- `profiles/hmos-app/harness/image-toolkit.ts` — CIEDE2000（纯 TS）+ jimp 可选裁图/采色
- `profiles/hmos-app/harness/asset-acquisition.ts` — crop 资产落地
- `static-fidelity-score.ts` — ΔE 对比 ui-spec 采样色 vs 资源色

## jimp 未安装时

- `asset_acquisition` / 像素采样 → **SKIP**（非 FAIL）
- 静态 ΔE 仍可在 ui-spec 已有 `value` + 代码资源色时工作

## 验证命令

```bash
cd harness && npm install jimp
cd harness && npm test
```

## bbox 兜底（review-r3#1）

1. **裁图**：`padding=0.02` 宽松框；关键资产须 `human_crop_confirmed: true`
2. **采色**：众数 + 过滤 RGB≥240 或 ≤20
