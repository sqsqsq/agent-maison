// 绕过检查的唯一实现：正例（closure.test.ts）与反例（seam-bypass.case.ts）共用同一把尺子，
// 否则"反例判负"只能证明两段不同的代码不一样，证明不了尺子有效。

import * as fs from 'fs';
import * as path from 'path';

/** 接缝的具体 Provider 标识——Consumer 依赖其中任何一个即为绕过。 */
const CONCRETE_PROVIDERS = ['manualLedgerSource', 'autoLedgerSource'];

/**
 * Consumer 是否只经稳定契约取数：逐条检查 import 绑定，任一具体 Provider 被直接引入即判负。
 * 检查的是依赖方向本身，所以只看 import 行，不看正文措辞。
 */
export function consumerAvoidsSeamBypass(consumerFileName: string): boolean {
  const abs = path.resolve(__dirname, '..', '..', 'src', 'ledger', consumerFileName);
  const source = fs.readFileSync(abs, 'utf8');
  const importedBindings = [...source.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'[^']+';/gm)]
    .flatMap(match => match[1].split(',').map(binding => binding.trim()));
  return CONCRETE_PROVIDERS.every(provider => !importedBindings.includes(provider));
}
