import * as fs from 'fs';
import * as path from 'path';
import minimist from 'minimist';
import * as YAML from 'yaml';
import {
  componentClosurePath,
  loadCanonicalComponentClosure,
  componentClosureReviewPath,
} from './utils/component-closure-path';
import {
  ComponentClosureEvaluationOptions,
  evaluateComponentClosure,
  validateComponentClosure,
} from './utils/component-closure-validator';
import { renderComponentClosureMarkdown } from './utils/component-closure-review-projection';
import { closureIssue } from './utils/component-closure-model';
import { sha256Bytes } from './utils/component-blueprint-path';

interface CliArgs {
  'project-root'?: string;
  blueprint?: string;
  json?: boolean;
  write?: boolean;
}

function atomicWrite(target: string, bytes: Buffer | string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporary, typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes, { flag: 'wx' });
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

export function checkCanonicalComponentClosure(
  projectRoot: string,
  blueprintId: string,
  options: ComponentClosureEvaluationOptions = {},
) {
  const loaded = loadCanonicalComponentClosure(projectRoot, blueprintId);
  const validated = validateComponentClosure(loaded.closure, projectRoot, blueprintId, options);
  const issues = [...validated.issues];
  const reviewPath = componentClosureReviewPath(projectRoot, blueprintId);
  const expectedReview = renderComponentClosureMarkdown(loaded.closure, loaded.artifactSha256);
  if (!fs.existsSync(reviewPath) || fs.readFileSync(reviewPath, 'utf8') !== expectedReview) {
    issues.push(closureIssue('component_closure_review_projection_stale', reviewPath, 'component-closure.md 必须从当前 canonical YAML 原样确定性生成。'));
  }
  if (loaded.closure.verdict !== 'PASS' && loaded.closure.verdict !== 'PASS_WITH_DEGRADATION') {
    issues.push(closureIssue('component_closure_not_closed', '$.verdict', `当前 Component verdict=${loaded.closure.verdict}。`));
  }
  return { ...loaded, issues };
}

export function writeCanonicalComponentClosure(
  projectRoot: string,
  blueprintId: string,
  options: ComponentClosureEvaluationOptions = {},
) {
  const evaluated = evaluateComponentClosure(projectRoot, blueprintId, options);
  const yamlPath = componentClosurePath(projectRoot, blueprintId);
  const yamlBytes = Buffer.from(YAML.stringify(evaluated.closure), 'utf8');
  atomicWrite(yamlPath, yamlBytes);
  const artifactSha256 = sha256Bytes(yamlBytes);
  atomicWrite(
    componentClosureReviewPath(projectRoot, blueprintId),
    renderComponentClosureMarkdown(evaluated.closure, artifactSha256),
  );
  return checkCanonicalComponentClosure(projectRoot, blueprintId, options);
}

function main(): void {
  const args = minimist<CliArgs>(process.argv.slice(2), {
    string: ['project-root', 'blueprint'],
    boolean: ['json', 'write'],
    default: { 'project-root': process.cwd(), json: false, write: false },
  });
  if (!args.blueprint) {
    console.error('用法：check-component-closure --project-root <root> --blueprint <blueprint-id> [--write] [--json]');
    process.exit(2);
  }
  try {
    const result = args.write
      ? writeCanonicalComponentClosure(args['project-root']!, args.blueprint)
      : checkCanonicalComponentClosure(args['project-root']!, args.blueprint);
    const failed = result.issues.some(issue => issue.severity === 'BLOCKER');
    if (args.json) {
      console.log(JSON.stringify({
        status: failed ? 'FAIL' : 'PASS',
        verdict: result.closure.verdict,
        canonical_path: result.canonicalPath,
        artifact_sha256: result.artifactSha256,
        component_id: result.closure.component_id,
        blueprint_id: result.closure.blueprint_id,
        write: args.write,
        issues: result.issues,
      }, null, 2));
    } else if (failed) {
      console.error(`❌ Component closure FAIL (${result.issues.length} issues)`);
      for (const issue of result.issues) console.error(`  [${issue.severity}] ${issue.id} ${issue.path}: ${issue.message}`);
    } else {
      console.log(`✅ Component closure ${result.closure.verdict} — ${result.canonicalPath}`);
      console.log(`   component_id=${String(result.closure.component_id)} blueprint_id=${String(result.closure.blueprint_id)}`);
      console.log(`   artifact_sha256=${result.artifactSha256}`);
    }
    process.exit(failed ? 1 : 0);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String((error as { code?: unknown }).code) : 'component_closure_check_failed';
    const payload = { status: 'FAIL', issues: [{ id: code, severity: 'BLOCKER', path: '$', message: (error as Error).message }] };
    if (args.json) console.log(JSON.stringify(payload, null, 2));
    else console.error(`❌ ${code}: ${(error as Error).message}`);
    process.exit(1);
  }
}

if (require.main === module) main();
