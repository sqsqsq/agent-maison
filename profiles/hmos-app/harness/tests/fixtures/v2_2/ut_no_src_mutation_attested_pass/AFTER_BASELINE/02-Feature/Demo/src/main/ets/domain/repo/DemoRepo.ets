// coding 阶段新增的业务源文件——未跟踪（untracked），git 基线下会被算成 UT 的改动。
export class DemoRepo {
  load = async (): Promise<void> => {
    console.info('load');
  };
}
