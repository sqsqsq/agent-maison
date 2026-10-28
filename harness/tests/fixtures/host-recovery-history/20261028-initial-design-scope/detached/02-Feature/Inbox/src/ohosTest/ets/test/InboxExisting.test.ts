import { it } from 'node:test';
import { expect } from './Expect';
import { createInbox, MemoryStorage, InboxProjection } from '../../../../index';
it('[BASE-1] single-read persists and duplicate is quiet', () => {
  const storage = new MemoryStorage([{ id: 'one', text: 'existing message', read: false }]);
  const store = createInbox(storage); const projection = new InboxProjection(store);
  expect(store.markRead('one')).toBe(true); expect(storage.writes).toBe(1); expect(projection.unreadCount).toBe(0);
  expect(store.markRead('one')).toBe(false); expect(storage.writes).toBe(1);
  expect(createInbox(storage).list()[0].read).toBe(true); projection.dispose();
});
