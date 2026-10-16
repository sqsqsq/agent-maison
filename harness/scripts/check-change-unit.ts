import minimist from 'minimist';
import * as fs from 'fs';
import * as path from 'path';
import {
  ChangeUnitResolutionError,
  loadCanonicalChangeUnit,
  enumerateCanonicalChangeUnits,
  deriveChangeUnitFeatureId,
} from './utils/change-unit-path';
import { validateChangeUnit } from './utils/change-unit-validator';
import { validateChangeUnitDesign } from './utils/change-unit-design-gate';
import { acceptChangeUnitDecomposition, deriveDesignPreparationReadiness, evaluateDesignPreparationEntry } from './utils/change-unit-design-preparation';
import { deriveChangeUnitReadySet } from './utils/change-unit-ready-set';
import { ChangeUnitCandidate, ChangeUnitCandidateRejected } from './utils/change-unit-provider-boundary';

interface CliArgs {
  'project-root'?: string;
  blueprint?: string;
  unit?: string;
  json?: boolean;
  'accept-candidates'?: string;
  readiness?: boolean;
}

export function checkCanonicalChangeUnit(projectRoot: string, blueprintId: string, changeUnitId: string) {
  const loaded = loadCanonicalChangeUnit(projectRoot, blueprintId, changeUnitId);
  const artifactIssues = validateChangeUnit(loaded.changeUnit, {
    projectRoot,
    canonicalPath: loaded.canonicalPath,
  });
  const design = artifactIssues.some(item => item.severity === 'BLOCKER')
    ? undefined
    : validateChangeUnitDesign(projectRoot, loaded.changeUnit);
  return { ...loaded, issues: [...artifactIssues, ...(design?.issues ?? [])], design };
}

function main(): void {
  const args = minimist<CliArgs>(process.argv.slice(2), {
    string: ['project-root', 'blueprint', 'unit', 'accept-candidates'],
    boolean: ['json', 'readiness'],
    default: { 'project-root': process.cwd(), json: false },
  });
  const acceptsCandidates = Object.prototype.hasOwnProperty.call(args, 'accept-candidates');
  const preparation = Boolean(args.readiness || acceptsCandidates);
  const unitGiven = Object.prototype.hasOwnProperty.call(args, 'unit');
  if (!args.blueprint || (preparation && unitGiven) || (args.readiness && acceptsCandidates)
    || (acceptsCandidates && !args['accept-candidates']) || (!preparation && !args.unit)) {
    console.error('用法：check-change-unit --project-root <root> --blueprint <blueprint-id> (--unit <id> | --accept-candidates <file> | --readiness) [--json]');
    process.exit(2);
  }
  try {
    if (preparation) {
      const projectRoot = path.resolve(args['project-root']!);
      const retry = ['npm', 'run', 'check:change-unit', '--', '--project-root', projectRoot, '--blueprint', args.blueprint, '--readiness', '--json'];
      let accepted: Array<{ change_unit_id: string; canonical_path: string; feature_id: string }> = [];
      let acceptanceReview;
      if (args['accept-candidates']) {
        const candidatesFile = path.resolve(projectRoot, args['accept-candidates']);
        const candidates: unknown = JSON.parse(fs.readFileSync(candidatesFile, 'utf8'));
        if (!Array.isArray(candidates)) throw new Error('候选文件须为 JSON 数组 [{providerId, artifact}]');
        const entry = evaluateDesignPreparationEntry(projectRoot, args.blueprint);
        if (!entry.canEnter) throw new Error(entry.reasons.join('; '));
        const result = acceptChangeUnitDecomposition(projectRoot, args.blueprint, candidates as ChangeUnitCandidate[]);
        accepted = result.accepted.map(row => ({ change_unit_id: String(row.changeUnit.change_unit_id), canonical_path: row.canonicalPath, feature_id: deriveChangeUnitFeatureId(args.blueprint!, String(row.changeUnit.change_unit_id)) }));
        acceptanceReview = result.reviewDocument;
        try {
          fs.unlinkSync(candidatesFile);
        } catch (error) {
          console.warn(`候选已接受，但临时文件清理失败：${candidatesFile}；${(error as Error).message}。请清理该文件，后续使用 --readiness，不要重复接受。`);
        }
      }
      // Acceptance is already committed. A later readiness failure must never ask for reacceptance.
      let payload;
      try {
        const readiness = deriveDesignPreparationReadiness(projectRoot, args.blueprint);
        const readySet = readiness.blueprintRefs.busy ? undefined : deriveChangeUnitReadySet(projectRoot, args.blueprint);
        const ready = readiness.ready;
        payload = { status: ready ? 'PASS' : 'FAIL', accepted, acceptanceReview, readiness,
          inventory: enumerateCanonicalChangeUnits(projectRoot, args.blueprint).map(row => ({ change_unit_id: String(row.changeUnit.change_unit_id), feature_id: deriveChangeUnitFeatureId(args.blueprint!, String(row.changeUnit.change_unit_id)), canonical_path: row.canonicalPath })),
          ready_ids: ready ? readySet?.ready.map(unit => unit.change_unit_id) ?? [] : [],
          next: (ready ? '仅 ready_ids 可执行；inventory 只列 canonical 身份（含退役）；同一主 Agent 按 change-unit-progression 的 ready-set/selector 继续范围准备与 Goal；本命令未启动施工。' : '保留已接受 CU；修复所列 readiness 问题或等待竞争解除后运行 --readiness。')
            + (acceptanceReview?.status === 'failed' || readiness.reviewDocument?.status === 'failed'
              ? ' 文档物化失败单独报告；按 acceptanceReview/readiness.reviewDocument 的 rebuildCommand 独立重建，不重复接受、不改变施工 readiness。' : ''),
          retry_command: retry, side_effects: 'readiness 复用既有蓝图指针调和与人读文档物化，并非纯只读。' };
      } catch (error) {
        payload = { status: 'FAIL', accepted, acceptanceReview, readiness: { ready: false, reason: (error as Error).message }, retry_command: retry };
      }
      console.log(JSON.stringify(payload, null, 2));
      process.exit(payload.status === 'PASS' ? 0 : 1);
    }
    const result = checkCanonicalChangeUnit(args['project-root']!, args.blueprint, args.unit!);
    const failed = result.issues.some(item => item.severity === 'BLOCKER');
    if (args.json) {
      console.log(JSON.stringify({
        status: failed ? 'FAIL' : 'PASS',
        canonical_path: result.canonicalPath,
        artifact_sha256: result.artifactSha256,
        component_id: result.changeUnit.component_id,
        blueprint_id: result.changeUnit.blueprint_id,
        constructability: result.design?.verdict,
        issues: result.issues,
      }, null, 2));
    } else if (failed) {
      console.error(`❌ Change Unit FAIL (${result.issues.length} issues)`);
      for (const item of result.issues) console.error(`  [${item.severity}] ${item.id} ${item.path}: ${item.message}`);
    } else {
      console.log(`✅ Change Unit PASS — ${result.canonicalPath}`);
      console.log(`   component_id=${String(result.changeUnit.component_id)} blueprint_id=${String(result.changeUnit.blueprint_id)}`);
      console.log(`   artifact_sha256=${result.artifactSha256}`);
    }
    process.exit(failed ? 1 : 0);
  } catch (error) {
    const code = error instanceof ChangeUnitResolutionError || error instanceof ChangeUnitCandidateRejected ? error.code : 'change_unit_check_failed';
    const payload = { status: 'FAIL', issues: [{ id: code, severity: 'BLOCKER', path: '$', message: (error as Error).message }] };
    if (args.json) console.log(JSON.stringify(payload, null, 2));
    else console.error(`❌ ${code}: ${(error as Error).message}`);
    process.exit(1);
  }
}

if (require.main === module) main();
