/** 1804ac3b real CLI preparation only: never supplies an executor result or completion evidence. */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as YAML from 'yaml';
import { provisionFrameworkUnder, writeHostFile, git } from './real-chain-host';

const REQUIREMENT = '对已有 clamp Feature 按已批准且未变化的 acceptance/contracts 正式交付：修复当前 Not implemented 回归，恢复既有 clamp(value, min, max) 规格（低于下界返回 min，高于上界返回 max，范围内原样返回）。不增加行为、外部契约或验收，不作新设计决定。实际执行全部 unit 断言，独立 review/verifier，经 GoalPhaseRuntime 正式收口。全权处理原目标内工作，不重复询问；总计最多 12 次作者调用、45 分钟，不能突破该上限。';
const SMOKE_REQUIREMENT = '只审查现有 clamp 实现是否满足已批准且未变化的 acceptance/contracts，形成真实 review 报告与所需独立核验，通过本阶段正式 gate/finalizer 即结束。仅 request 终点，不修改产品、不跑后续阶段，不声明 Feature 完整交付。本次最多 4 次作者调用、35 分钟。';
const MODULE_PATH = 'src/math';
const SOURCE_DIR = `${MODULE_PATH}/src/main`;
const SOURCE = `${SOURCE_DIR}/clamp.ts`;
const LIMITS = `${SOURCE_DIR}/limits.ts`;
const ENTRY = `${SOURCE_DIR}/index.ts`;
const PRODUCT_FILES = [SOURCE, LIMITS, ENTRY];
const TEST = `${MODULE_PATH}/src/test/clamp.test.ts`;

function assertNoLinks(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`CLI fixture must not link to source: ${file}`);
    if (entry.isDirectory()) assertNoLinks(file);
  }
}

export function prepareSessionCliProject(root: string, adapter: 'claude' | 'codex', isolated: boolean): void {
  if (fs.existsSync(root)) throw new Error(`Refusing to overwrite fixture: ${root}`);
  fs.mkdirSync(root, { recursive: true });
  process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, '.trust');
  const { frameworkRoot } = provisionFrameworkUnder(root);
  const write = (file: string, content: string) => writeHostFile(root, file, content);
  const requirement = adapter === 'codex' ? SMOKE_REQUIREMENT : REQUIREMENT;
  // Fixture-only environmental adaptation: genuine Node/tsc host, no product checker replacement.
  const profileRoot = path.join(frameworkRoot, 'profiles/generic');
  const profile = YAML.parse(fs.readFileSync(path.join(profileRoot, 'profile.yaml'), 'utf8'));
  profile.phases_disabled = [];
  profile.capabilities['coding.compile'] = { provider: 'node_compile', severity: 'BLOCKER' };
  profile.capabilities['ut.compile'] = { provider: 'node_compile', severity: 'BLOCKER' };
  profile.capabilities['ut.run'] = { provider: 'node_test', severity: 'BLOCKER' };
  fs.writeFileSync(path.join(profileRoot, 'profile.yaml'), YAML.stringify(profile));
  fs.cpSync(path.join(__dirname, 'session-node-profile'), path.join(profileRoot, 'harness'), { recursive: true });
  if (!isolated) {
    const file = path.join(frameworkRoot, 'agents', adapter, 'adapter.yaml');
    const declaration = YAML.parse(fs.readFileSync(file, 'utf8'));
    declaration.goal_capability.phase_context_isolation = false;
    fs.writeFileSync(file, YAML.stringify(declaration));
  }
  write('framework.config.json', JSON.stringify({ schema_version: '1.1', project_name: 'SessionCliClamp',
    active_workflow: 'obligation-driven', project_profile: { name: 'generic' },
    architecture: { outer_layers: [{ id: 'src', can_depend_on: [], intra_layer_deps: 'dag' }], module_inner_layers: ['shared', 'data', 'domain', 'presentation'], cross_module_exports_file: path.posix.relative(MODULE_PATH, ENTRY) },
    paths: { features_dir: 'doc/features', module_catalog: 'doc/module-catalog.yaml', glossary: 'doc/glossary.yaml', architecture_md: 'doc/architecture.md', docs_committed: false }, materialized_adapters: [adapter],
  }, null, 2));
  write('framework.local.json', JSON.stringify({ schema_version: '1.0', agent_adapter: adapter }, null, 2));
  write('.gitignore', 'framework/\n.trust/\n.claude/\n.codex/\n');
  write(SOURCE, adapter === 'codex'
    ? 'export function clamp(value: number, min: number, max: number): number {\n  return Math.min(max, Math.max(min, value));\n}\n'
    : 'export function clamp(value: number, min: number, max: number): number {\n  throw new Error("Not implemented");\n}\n');
  write(LIMITS, 'export const FINITE_INPUT_CONTRACT = "finite number; min <= max";\n');
  write(ENTRY, "export { clamp } from './clamp';\nexport { FINITE_INPUT_CONTRACT } from './limits';\n");
  write(`${MODULE_PATH}/src/test/expect.ts`, "import assert from 'node:assert/strict';\nexport const expect = (value: unknown) => ({ toBe: (expected: unknown): void => assert.equal(value, expected) });\n");
  write('doc/requirement.md', requirement + '\n');
  write('doc/module-catalog.yaml', YAML.stringify({ schema_version: '1.0', modules: [{ name: 'math', layer: 'src', sub_layer: null, format: 'library', one_liner: '有限数值区间约束', responsibilities: ['clamp'], NOT_responsible_for: ['UI', 'device'], typical_business_terms: ['区间约束'], easily_confused_with: [], key_exports: ['clamp'], entry_file: ENTRY }] }));
  write('doc/glossary.yaml', YAML.stringify({ schema_version: '1.0', terms: [{ term: '区间约束', canonical_module: 'math', aliases: ['clamp'], definition: '小于下界取下界，大于上界取上界，其余原值' }] }));
  write('doc/architecture.md', '# Architecture\n\nmath exports a finite-number clamp function; no UI, device or external side effects.\n');
  write('doc/features/clamp/contracts.yaml', YAML.stringify({ feature: 'clamp', source: 'doc/requirement.md', version: '1', modules: [{ name: 'math', layer: 'src', package_path: MODULE_PATH }], files: PRODUCT_FILES, module_dependencies: {}, data_models: [], interfaces: [], components: [], prd_to_code_traceability: [{ prd_id: 'AC-1', key_files: [SOURCE] }, { prd_id: 'AC-2', key_files: [SOURCE] }, { prd_id: 'AC-3', key_files: [SOURCE] }] }));
  write('doc/features/clamp/acceptance.yaml', YAML.stringify({ feature: 'clamp', source: 'doc/requirement.md', version: '1', criteria: [
    { id: 'AC-1', description: 'clamp(-2, 0, 10) returns 0', expected_result: '0' },
    { id: 'AC-2', description: 'clamp(12, 0, 10) returns 10', expected_result: '10' },
    { id: 'AC-3', description: 'clamp(4, 0, 10) returns 4', expected_result: '4' },
  ].map(ac => ({ ...ac, priority: 'P1', testable: true, verification_steps: [ac.description], ut_layer: 'unit', ut_focus: ac.description })), boundaries: [] }));
  write('AGENTS.md', `# Session CLI acceptance fixture\n\n用户目标与授权见 doc/requirement.md。按 framework/skills/project/goal-mode/SKILL.md 和其 operations 执行。\n\n这是 ${isolated ? '隔离阶段上下文' : '主上下文执行阶段（无阶段隔离）'} 验收。${isolated ? '每个阶段委派真实独立子代理，子代理按原件路径读完整 instruction。' : '阶段作者在主上下文执行并披露；绝不因此取消独立核验。'} 所有必需 verifier 用真实独立子代理/独立 CLI 消费生产 verifier request，完整结果原样落盘；不得主会话自签。\n\n唯一完整交付控制入口为 goal-mode-entry --next / --report-result；生产 gate/finalizer 必须真实执行，禁止改 summary/receipt/events/completion 或 fixture profile。Node profile 是开发环境适配，真正执行 tsc 和 node --test，不提供预设 PASS。UT 新测试唯一授权落点 ${TEST}，按 acceptance 写三条 it('[AC-N] ...', () => { expect(...).toBe(...); })，使用 node:test 的 it 与 ./expect 的真实 assert 包装。coding 不写新断言；UT 不改产品实现。可读生产原件提供的真实自检/闭环命令。\n`);
  if (adapter === 'claude') {
    fs.copyFileSync(path.join(root, 'AGENTS.md'), path.join(root, 'CLAUDE.md'));
    write('.claude/commands/goal-mode.md', 'Read framework/skills/project/goal-mode/SKILL.md and follow it.\n');
    fs.mkdirSync(path.join(root, '.claude/agents'), { recursive: true });
    for (const name of ['verifier.md', 'phase-executor.md']) fs.copyFileSync(path.join(frameworkRoot, 'agents/claude/templates/agents', name), path.join(root, '.claude/agents', name));
  } else write('.codex/skills/goal-mode/SKILL.md', '---\nname: goal-mode\ndescription: Maison goal entry\n---\nRead framework/skills/project/goal-mode/SKILL.md.\n');
  const isSmoke = adapter === 'codex';
  write('CLI-PROMPT.md', `读取 AGENTS.md、doc/requirement.md 和 framework/skills/project/goal-mode/SKILL.md。${isSmoke ? '仅完成 review 单阶段交接冒烟：当前正确实现是既有输入，禁止改产品或新增后续阶段；request 终点不签 Feature completion。' : '按已有且未变化的批准规格恢复 clamp，完成 coding→review→ut 与实际测试直至正式 Feature 完成；当前 throw 是实现回归，不是新增行为/验收变化。'}\n\n准备工具已通过生产 prepareFeatureScopeCandidate/buildGoalManifestFromInput/createGoalRun 布置合法出生输入与明确预算；run-id=session-cli，尚未调用执行者/门禁或写任何结果。命令从 framework/harness 运行，使用本工程绝对 project-root/framework-root。由你自己的命令工具执行 goal-mode-entry --next --run-mode attended --feature clamp --run-id session-cli --adapter ${adapter}${isSmoke ? '' : ' --authorize-autonomy'}，读返回 request.path 的完整原件（context.instruction），按原身份与精确命令执行、自检、投真正独立 verifier、sync-closure，仅在 next_command 指定的当前 result-e<epoch>.json 写本次真实结果（可用 UTF-8 BOM），原样执行返回的 --report-result @文件 --request 原件路径；消费返回至${isSmoke ? '本阶段正式 gate/finalizer 通过' : '正式 Feature 完成'}。完整交付各次控制调用重传可信原全权授权；冒烟没有全权位。\n\n不能把请求 passed 当质量通过，不手填任何机器结果。${isSmoke ? 'review 阶段可在主上下文执行；必需 verifier 使用真实独立 CLI/子代理，按生产 request 执行。' : isolated ? '作者阶段必须用真实隔离子代理，必需 verifier 另用真实独立子代理。' : '作者阶段在当前主上下文执行，披露无阶段隔离；必需 verifier 仍用实际独立子代理。'} 最多${isSmoke ? '4作者调用及35' : '12作者调用及45'}分钟总上限，计次/时间不重置；不手改框架或降低验收。最终列出真实产物、阶段summary、独立报告与${isSmoke ? '单阶段正式收口事实，明确未执行其它阶段/未签Feature完成' : 'Node断言及正式完成原件'}路径，未完成如实说明。\n`);
  assertNoLinks(root);
  const copied = (relative: string): any => require(path.join(frameworkRoot, 'harness', relative));
  const inventory = copied('scripts/utils/closure-attestation').buildSourceInventory(root, { expectProductSources: true });
  for (const file of PRODUCT_FILES) {
    if (!inventory.files.some((entry: { path: string }) => entry.path === file)) throw new Error(`Real closure inventory missed product: ${file}`);
  }
  if (inventory.files.some((entry: { path: string }) => entry.path.startsWith(`${MODULE_PATH}/src/test/`))) throw new Error('Real closure inventory included test sources');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.name', 'Maison CLI fixture']);
  git(root, ['config', 'user.email', 'session-cli@example.test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['config', 'core.autocrlf', 'false']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'Approved clamp contract and unimplemented baseline']);
  // All state is born by the copied production writers, with budget supplied as input.
  const scope = copied('scripts/utils/feature-track').prepareFeatureScopeCandidate({ projectRoot: root,
    frameworkRoot, feature: 'clamp', completionTarget: isSmoke ? 'request' : 'feature',
    requestedResults: [isSmoke ? 'review existing clamp against approved contract' : 'restore approved clamp and execute unit acceptance'],
    requestedPhases: isSmoke ? ['review'] : ['coding', 'review', 'ut'], requirement,
    requirementSourceFiles: ['doc/requirement.md'],
    ...(isSmoke ? {} : { impact: { userVisibleBehaviorChange: false,
      reason: '恢复已批准且未变化的 clamp 规格；不新增行为、契约或验收，当前 throw 是实现回归', basisPaths: [SOURCE] } }),
  }).scope;
  const manifest = copied('scripts/utils/goal-manifest').buildGoalManifestFromInput({ feature: 'clamp', run_id: 'session-cli',
    requirement, requirement_source_files: ['doc/requirement.md'], adapter, execution_scope: scope,
    chain_override: scope.phase_chain, start_phase: scope.phase_chain[0], end_phase: scope.phase_chain.at(-1),
    budget: { max_total_turns: isSmoke ? 4 : 12, wall_clock_minutes: isSmoke ? 35 : 45, max_retries_per_phase: 3 },
    unattended: { write_mode: 'full-access', approval_mode: 'never', max_turns: 20,
      ...(isSmoke ? { timeout_seconds: 300 } : { phase_timeout_seconds: { coding: 300, review: 300, ut: 300 } }) },
  }, { projectRoot: root });
  copied('scripts/utils/goal-run-creation').createGoalRun({ projectRoot: root, manifest, chain: scope.phase_chain });
  copied('scripts/utils/goal-run-control').ensureRunControl(path.join(root, manifest.report_dir), manifest.run_id);
  if (scope.phase_chain.join(',') !== (isSmoke ? 'review' : 'coding,review,ut')) throw new Error(`Unexpected real scope: ${scope.phase_chain}`);
}

if (require.main === module) {
  const single = process.argv.includes('--single-claude');
  const interrupted = process.argv.includes('--interrupt-once');
  const index = process.argv.indexOf('--output-root');
  const outputRoot = path.resolve(index >= 0 ? process.argv[index + 1] : fs.mkdtempSync(path.join(os.tmpdir(), 'maison-session-cli-')));
  const projects = (single ? [
    { name: 'claude-isolated', adapter: 'claude' as const, isolated: true },
  ] : [
    { name: 'claude-isolated', adapter: 'claude' as const, isolated: true },
    { name: 'claude-main', adapter: 'claude' as const, isolated: false },
    { name: 'codex-smoke', adapter: 'codex' as const, isolated: true },
  ]).map(input => {
    const root = path.join(outputRoot, input.name);
    prepareSessionCliProject(root, input.adapter, input.isolated);
    if (interrupted) {
      require('./session-cli-interruption.cjs').instrumentSlowCompile(root);
      fs.appendFileSync(path.join(root, 'CLI-PROMPT.md'), '\n本次验收的第一次 coding 正式 gate 会由独立观察器仅外杀一次 report CLI。必须使用返回的 next_command 原样命令，不绕过 Windows 守卫、不改 provider/框架/事件/receipt，不重报 passed 催进度；命令被外杀后按相同入口 --next 让真实 runtime 回收上一 gate 并验证优先续作，直到正式 finalizer。原已接受作者报告不得重调作者。其它真实错误如实按原路恢复，不能把中断本身当完成。\n');
    }
    return { ...input, root, prompt: path.join(root, 'CLI-PROMPT.md'), trustRoot: path.join(root, '.trust') };
  });
  process.stdout.write(JSON.stringify({ outputRoot, projects, ...(interrupted ? { interruption_helper: path.join(__dirname, 'session-cli-interruption.cjs') } : {}) }, null, 2) + '\n');
}
