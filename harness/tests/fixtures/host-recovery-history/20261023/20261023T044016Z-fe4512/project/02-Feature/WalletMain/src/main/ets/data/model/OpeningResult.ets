export interface OpeningResultParams {
  fullCardNumber: string;
  success: boolean;
  errorMessage?: string;
}

/** 开卡结果路由参数；完整卡号仅供后台交接，不得渲染或记录日志。 */
export class OpeningResult {
  fullCardNumber: string;
  success: boolean;
  errorMessage?: string;

  constructor(params: OpeningResultParams) {
    this.fullCardNumber = params.fullCardNumber;
    this.success = params.success;
    this.errorMessage = params.errorMessage;
  }
}
