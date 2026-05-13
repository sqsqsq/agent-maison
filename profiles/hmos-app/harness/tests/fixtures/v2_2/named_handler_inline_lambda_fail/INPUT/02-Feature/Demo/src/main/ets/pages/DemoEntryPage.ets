// DemoEntryPage.ets — 业务 handler 只以 inline 箭头函数存在，整个 02-Feature/
// 没有任何命名形式的实现（不在任何 class 字段、函数声明、导出、类方法中
// 出现该符号名）。named_business_handler 应 BLOCKER FAIL。

@Component
export struct DemoEntryPage {
  build() {
    Column() {
      Button('Tap me')
        .onClick(() => {
          console.info('inline lambda body; no named entry');
        });
    }
  }
}
