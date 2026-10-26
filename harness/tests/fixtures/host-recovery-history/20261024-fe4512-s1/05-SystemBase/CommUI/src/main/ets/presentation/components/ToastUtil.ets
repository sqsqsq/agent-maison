import { promptAction } from '@kit.ArkUI';

export function showToast(message: string): void {
  try {
    promptAction.showToast({
      message: message,
      duration: 2000
    });
  } catch (_e) {
    // 非 UI 上下文时忽略
  }
}
