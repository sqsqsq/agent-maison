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
  component?: string;
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
  componentId: string,
  options: ComponentClosureEvaluationOptions = {},
) {
  const loaded = loadCanonicalComponentClosure(projectRoot, componentId);
  const validated = validateComponentClosure(loaded.closure, projectRoot, componentId, options);
  const issues = [...validated.issues];
  const reviewPath = componentClosureReviewPath(projectRoot, componentId);
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
  componentId: string,
  options: ComponentClosureEvaluationOptions = {},
) {
  const evaluated = evaluateComponentClosure(projectRoot, componentId, options);
  const yamlPath = componentClosurePath(projectRoot, componentId);
  const yamlBytes = Buffer.from(YAML.stringify(evaluated.closure), 'utf8');
  atomicWrite(yamlPath, yamlBytes);
  const artifactSha256 = sha256Bytes(yamlBytes);
  atomicWrite(
    componentClosureReviewPath(projectRoot, componentId),
    renderComponentClosureMarkdown(evaluated.closure, artifactSha256),
  );
  return checkCanonicalComponentClosure(projectRoot, componentId, options);
}

function main(): void {
  const args = minimist<CliArgs>(process.argv.slice(2), {
    string: ['project-root', 'component'],
    boolean: ['json', 'write'],
    default: { 'project-root': process.cwd(), json: false, write: false },
  });
  if (!args.component) {
    console.error('用法：check-component-closure --project-root <root> --component <component-id> [--write] [--json]');
    process.exit(2);
  }
  try {
    const result = args.write
      ? writeCanonicalComponentClosure(args['project-root']!, args.component)
      : checkCanonicalComponentClosure(args['project-root']!, args.component);
    const failed = result.issues.some(issue => issue.severity === 'BLOCKER');
    if (args.json) {
      console.log(JSON.stringify({
        status: failed ? 'FAIL' : 'PASS',
        verdict: result.closure.verdict,
        canonical_path: result.canonicalPath,
        artifact_sha256: result.artifactSha256,
        write: args.write,
        issues: result.issues,
      }, null, 2));
    } else if (failed) {
      console.error(`❌ Component closure FAIL (${result.issues.length} issues)`);
      for (const issue of result.issues) console.error(`  [${issue.severity}] ${issue.id} ${issue.path}: ${issue.message}`);
    } else {
      console.log(`✅ Component closure ${result.closure.verdict} — ${result.canonicalPath}`);
      console.log(`   artifact_sha256=${result.artifactSha256}`);
    }
    process.exit(failed ? 1 : 0);
  } catch (error) {
    const payload = { status: 'FAIL', issues: [{ id: 'component_closure_check_failed', severity: 'BLOCKER', path: '$', message: (error as Error).message }] };
    if (args.json) console.log(JSON.stringify(payload, null, 2));
    else console.error(`❌ component_closure_check_failed: ${(error as Error).message}`);
    process.exit(1);
  }
}

if (require.main === module) main();
