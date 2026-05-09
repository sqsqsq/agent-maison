// 经用户同意后抽成的命名字段函数；已登记在 REPORTS/demo/fixture-run/gap-notes.md
export class DemoFlow {
  handleClick = async (): Promise<void> => {
    console.info('baseline impl');
  };

  // 新增：应用户要求抽成命名入口以便 UT 直接调用
  handleRefresh = async (): Promise<void> => {
    console.info('new approved handler');
  };
}
