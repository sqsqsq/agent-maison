import { ComponentClosureCoverageRow, ComponentClosureIssue, closureIssue } from './component-closure-model';
import { ResolvedComponentClosureInputs } from './component-closure-inputs';

export function validateComponentClosureCrossView(
  inputs: ResolvedComponentClosureInputs,
  rows: ComponentClosureCoverageRow[],
): ComponentClosureIssue[] {
  const issues: ComponentClosureIssue[] = [];
  const designKinds = new Set(['blueprint_target_node', 'cross_view_relation', 'runtime_flow', 'design_decision', 'authority_contract']);
  for (const row of rows.filter(item => item.required && item.evidence_level !== 'fact' && designKinds.has(item.kind))) {
    if (row.owner_change_unit_ids.length === 0) {
      issues.push(closureIssue(
        'component_closure_design_unconsumed',
        row.obligation_id,
        `当前蓝图设计未被 CU/组合 owner 消费：${row.blueprint_refs.join(', ')}`,
        'BLOCKER',
        'repair_or_add_change_unit',
      ));
    }
  }
  // 地址全集只取蓝图派生义务：CU touch 与 Feature mapping 义务的 blueprint_refs 是
  // CU/Feature 自身的回声，计入即允许"CU 引用蓝图外地址 + contracts 同步映射"自我洗白。
  const selfDerivedKinds = new Set(['construction_touch', 'feature_construction_mapping', 'feature_runtime_construction']);
  const blueprintAddresses = new Set(rows.filter(row => !selfDerivedKinds.has(row.kind)).flatMap(row => row.blueprint_refs));
  for (const unit of inputs.currentUnits) {
    for (const ref of unit.changeUnit.design_refs) {
      const address = ref.target.kind === 'node' || ref.target.kind === 'flow'
        ? `view:${String(ref.target.view_id)}/${ref.target.kind}:${ref.target.id}`
        : `${ref.target.kind}:${ref.target.id}`;
      if (!blueprintAddresses.has(address)) {
        issues.push(closureIssue(
          'component_closure_design_bypass',
          `change-unit:${unit.changeUnit.change_unit_id}`,
          `CU 使用的设计地址没有进入当前 closure obligation：${address}`,
          'BLOCKER',
          'reconcile_blueprint',
        ));
      }
    }
  }
  return issues;
}
