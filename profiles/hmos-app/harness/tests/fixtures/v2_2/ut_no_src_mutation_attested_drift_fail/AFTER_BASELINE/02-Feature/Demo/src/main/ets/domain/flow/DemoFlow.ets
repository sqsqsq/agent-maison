// review 闭环之后被改动的业务源码——attestation 内容哈希对账必须 BLOCKER FAIL。
// 门禁只判「review 审过的树变了」，不推断作者。
export class DemoFlow {
  handleClick = async (): Promise<void> => {
    console.info('post-review drift');
    console.info('second drift line');
  };
}
