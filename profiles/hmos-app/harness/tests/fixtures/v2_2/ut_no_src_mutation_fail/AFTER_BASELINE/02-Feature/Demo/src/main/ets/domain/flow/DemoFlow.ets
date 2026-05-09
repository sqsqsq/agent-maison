// baseline 之后被 Skill 5 阶段 "擅自" 修改的版本。
// 该改动未登记在任何 gap-notes.md 中，ut_no_src_mutation 必须 BLOCKER FAIL。
export class DemoFlow {
  handleClick = async (): Promise<void> => {
    console.info('MUTATED — added new line without user approval');
    console.info('second mutation line');
  };

  // 新增的命名 handler——本来应当先征得用户同意再加
  handleClickAdded = async (): Promise<void> => {
    console.info('new handler silently added by AI');
  };
}
