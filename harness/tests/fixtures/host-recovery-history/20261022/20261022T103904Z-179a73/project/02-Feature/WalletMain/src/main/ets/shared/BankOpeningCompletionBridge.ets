export class BankOpeningCompletionBridge<T> {
  private pending: T | null = null;
  private listeners: (() => void)[] = [];

  publish(payload: T): void {
    this.pending = payload;
    this.listeners.slice().forEach((listener: () => void) => listener());
  }

  takePending(): T | null {
    const payload: T | null = this.pending;
    this.pending = null;
    return payload;
  }

  subscribe(listener: () => void): void {
    if (this.listeners.indexOf(listener) < 0) {
      this.listeners.push(listener);
    }
  }

  unsubscribe(listener: () => void): void {
    const index: number = this.listeners.indexOf(listener);
    if (index >= 0) {
      this.listeners.splice(index, 1);
    }
  }
}

