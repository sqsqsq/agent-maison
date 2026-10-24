import minimist from 'minimist';
import * as path from 'path';
import { detectRepoLayout } from '../repo-layout';
import { materializeBlueprintSkillInputs } from './utils/blueprint-skill-projection';

export function prepareBlueprintDesign(args: string[]): string[] {
  const argv = minimist(args, { string: ['feature', 'project-root', 'framework-root', 'phase'] });
  if (!argv.feature) throw new Error('required: --feature <canonical CU feature id>');
  const phase = argv.phase;
  if (phase !== undefined && phase !== 'spec' && phase !== 'plan') throw new Error('--phase must be spec or plan');
  const layout = detectRepoLayout(__dirname);
  return materializeBlueprintSkillInputs(argv['project-root'] ? path.resolve(argv['project-root']) : layout.projectRoot,
    argv.feature, argv['framework-root'] ? path.resolve(argv['framework-root']) : layout.frameworkRoot, undefined, phase);
}
if (require.main === module) {
  try { console.log(JSON.stringify({ written: prepareBlueprintDesign(process.argv.slice(2)) })); }
  catch (error) { console.error(String(error)); process.exitCode = 1; }
}
