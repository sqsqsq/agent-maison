import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'harness', 'tests', 'unit');
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
  const p = path.join(dir, f);
  let s = fs.readFileSync(p, 'utf8');
  const o = s;
  const reps = [
    [/ids\.has\('prd'\)/g, "ids.has('spec')"],
    [/isPhaseGlobalInWorkflow\(spec, 'prd'\)/g, "isPhaseGlobalInWorkflow(spec, 'spec')"],
    [/indexOf\('prd'\)/g, "indexOf('spec')"],
    [/inspectFeatureArtifacts\(feature, 'prd'\)/g, "inspectFeatureArtifacts(feature, 'spec')"],
    [/'prd', 'spec\.md'/g, "'spec', 'spec.md'"],
    [/chain\[0\] === 'prd'/g, "chain[0] === 'spec'"],
    [/!chain\.includes\('prd'\)/g, "!chain.includes('spec')"],
    [/done\.has\('prd'\)/g, "done.has('spec')"],
    [/PHASE: 'prd'/g, "PHASE: 'spec'"],
    [/assert\(cmd\.includes\('prd'\)/g, "assert(cmd.includes('spec')"],
    [/prior\[0\]\.phase === 'prd'/g, "prior[0].phase === 'spec'"],
    [/prior\[1\]\.phase === 'design'/g, "prior[1].phase === 'plan'"],
    [/\['prd', 'testing'\]/g, "['spec', 'testing']"],
    [/\['prd', 'coding'\]/g, "['spec', 'coding']"],
    [/resolveAutoChain\(workflow, 'prd'/g, "resolveAutoChain(workflow, 'spec'"],
    [/validateFeatureChainDag\(workflow, \['prd'/g, "validateFeatureChainDag(workflow, ['spec'"],
    [/applies_to: 'design'/g, "applies_to: 'plan'"],
    [/assert\(md\.includes\('prd'\)/g, "assert(md.includes('spec')"],
    [/resolveAutoChain\(workflow, 'design'/g, "resolveAutoChain(workflow, 'plan'"],
    [/\{ phase: 'prd'/g, "{ phase: 'spec'"],
    [/\{ phase: 'design'/g, "{ phase: 'plan'"],
    [/phase: 'prd'/g, "phase: 'spec'"],
    [/phase: 'design'/g, "phase: 'plan'"],
    [/'prd',/g, "'spec',"],
    [/'design',/g, "'plan',"],
  ];
  for (const [re, to] of reps) s = s.replace(re, to);
  if (s !== o) fs.writeFileSync(p, s);
}
console.log('done');
