/**
 * 与宿主入口 Navigation 绑定的 NavPathStack 为同一实例。
 * NavDestination 等子树不可用 @Prop 传递 NavPathStack（真机 pushPath 易 SIGSEGV），
 * Tab 内首屏子树应用 @Link；无法 Link 的二级页通过本上下文取栈。
 *
 * 由 01-Product 入口在 aboutToAppear（或等价时机）调用 attach，全局仅维护单栈。
 */
export class NavPathContext {
  private static pathStack: NavPathStack | null = null;

  static attach(stack: NavPathStack): void {
    NavPathContext.pathStack = stack;
  }

  static stack(): NavPathStack {
    if (NavPathContext.pathStack === null) {
      throw new Error('NavPathContext: NavPathStack not attached');
    }
    return NavPathContext.pathStack;
  }
}
