// DemoEntryPage.ets — 关键：注释里写了 `function handleClickCommentOnly`，
// 但**没有**任何真实实现。scanner 必须剥离注释后再匹配，否则会误判 PASS。
//
// TODO: 将来抽出命名入口，目前还是 inline：
//   function handleClickCommentOnly(): void { /* not yet */ }
//   export const handleClickCommentOnly = async () => {};
//
// 以上两行只是 TODO 注释，不是真实代码。

@Component
export struct DemoEntryPage {
  build() {
    Column() {
      Button('Tap me')
        .onClick(() => {
          console.info('still inline; TODO remains');
        });
    }
  }
}
