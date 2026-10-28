import { InboxStore } from './InboxStore';
export class InboxProjection {
  unreadCount: number;
  private cancel: () => void;
  constructor(store: InboxStore) {
    this.unreadCount = store.list().filter(message => !message.read).length;
    this.cancel = store.subscribe(messages => { this.unreadCount = messages.filter(message => !message.read).length; });
  }
  dispose(): void { this.cancel(); }
}
