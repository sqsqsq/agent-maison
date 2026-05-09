// v2.2 named_business_handler 放宽 fixture：
// 验证以下 4 种合法命名形态都能被识别。

export class DemoFlow {
  // 形态 1：ArkTS 类字段 + async + 箭头函数
  handleClickArrow = async (): Promise<void> => {
    console.info('handleClickArrow called');
  };

  // 形态 2：类字段 + 类型注解 + 箭头函数（注解中含 `=>`，验证负向前瞻）
  handleClickWithType: (id: string) => Promise<void> = async (id: string): Promise<void> => {
    console.info('handleClickWithType called with', id);
  };

  // 形态 4：传统 method 形式（基线对照，确认未误伤）
  async handleClickMethod(id: string): Promise<void> {
    console.info('handleClickMethod called with', id);
  }
}

// 形态 3：顶层 const 赋值的箭头函数
export const handleClickConst = async (): Promise<void> => {
  console.info('handleClickConst called');
};
