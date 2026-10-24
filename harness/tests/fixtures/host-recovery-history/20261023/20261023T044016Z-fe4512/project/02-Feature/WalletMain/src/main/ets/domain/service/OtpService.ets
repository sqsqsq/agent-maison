/** 本地短信模拟服务；不发送网络请求，也不记录手机号。 */
export class OtpService {
  async sendMockCode(_mobile: string): Promise<void> {
    return Promise.resolve();
  }
}
