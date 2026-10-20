export class OpenCardCompletionBridge {
  private static listener: ((fullCardNumber: string) => void) | null = null;
  private static pending: string = '';

  static subscribe(listener: (fullCardNumber: string) => void): void {
    OpenCardCompletionBridge.listener = listener;
    const pending: string = OpenCardCompletionBridge.pending;
    OpenCardCompletionBridge.pending = '';
    if (pending.length > 0) {
      listener(pending);
    }
  }

  static unsubscribe(listener: (fullCardNumber: string) => void): void {
    if (OpenCardCompletionBridge.listener === listener) {
      OpenCardCompletionBridge.listener = null;
    }
  }

  static publish(fullCardNumber: string): void {
    if (fullCardNumber.length === 0) {
      return;
    }
    const listener = OpenCardCompletionBridge.listener;
    OpenCardCompletionBridge.pending = listener === null ? fullCardNumber : '';
    if (listener !== null) {
      listener(fullCardNumber);
    }
  }
}
