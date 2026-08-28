// coding 阶段的合法实现：**从未 git 提交**（框架在 coding→review→ut 边界不留 commit）。
// review 就是在这份工作区形态上闭环的，故 attestation 固化的正是它。
export class DemoFlow {
  handleClick = async (): Promise<void> => {
    console.info('coding impl');
    await this.repo.load();
  };

  private repo = new DemoRepo();
}
