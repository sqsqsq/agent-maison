import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runUnitCases } from '../utils/unit-cases';

export function runAll() {
  return runUnitCases([{ name: 'probe：env 已被 bootstrap 覆写到临时根，marker 写入成功', run() {
    const dir = process.env.MAISON_GOAL_CHECKPOINT_DIR ?? '';
    if (!path.basename(dir).startsWith('maison-test-trust-')) {
      throw new Error(`trust 根不是 bootstrap 临时目录：${dir}`);
    }
    if (path.resolve(dir) === path.resolve(os.homedir(), '.maison', 'goal-checkpoints')) {
      throw new Error('trust 根指向真实用户主目录');
    }
    fs.writeFileSync(path.join(dir, `probe-marker-${process.pid}.txt`), 'trust-write-probe');
  } }]);
}
