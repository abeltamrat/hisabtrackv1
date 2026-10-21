const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const functions = read('functions/index.js');
const service = read('services/MessagingService.ts');
const chat = read('app/messages/[id].tsx');

test('only the sender may edit or unsend, and only text messages within their windows', () => {
  assert.match(functions, /if \(current\.senderUid !== uid\) throw new HttpsError\('permission-denied', 'Only the sender can change this message\.'\)/);
  assert.match(functions, /if \(current\.type !== 'TEXT'\) throw new HttpsError\('failed-precondition', 'Cancel a request instead of changing it\.'\)/);
  assert.match(functions, /const MESSAGE_EDIT_WINDOW_MS = 15 \* 60 \* 1000;/);
  assert.match(functions, /const MESSAGE_UNSEND_WINDOW_MS = 48 \* 60 \* 60 \* 1000;/);
  // Unsending removes the text itself, not just a flag the client hides.
  assert.match(functions, /text: admin\.firestore\.FieldValue\.delete\(\), deletedAt: now/);
});

test('delete for me only hides the message for the person who asked', () => {
  assert.match(functions, /hiddenFor: admin\.firestore\.FieldValue\.arrayUnion\(uid\)/);
  assert.match(chat, /!message\.hiddenFor\?\.includes\(user\?\.uid \|\| ''\)/);
});

test('read and delivered times drive sent / delivered / seen ticks', () => {
  assert.match(functions, /\[`readAt\.\$\{uid\}`\]: now, \[`deliveredAt\.\$\{uid\}`\]: now/);
  assert.match(functions, /if \(action === 'markDelivered'\)/);
  assert.match(service, /if \(message\.createdAt <= \(Number\(conversation\?\.readAt\?\.\[otherUid\]\) \|\| 0\)\) return 'SEEN';/);
  // The app-wide unread listener reports delivery once per conversation update.
  assert.match(service, /void this\.markDelivered\(item\.id\)/);
});

test('replies keep a snapshot of the quoted message', () => {
  assert.match(functions, /replyTo = \{\s*id: replyToId, senderUid: original\.senderUid/);
  assert.match(functions, /lastMessageId: messageId/);
});

test('sending is optimistic and a retry reuses the same message id', () => {
  assert.match(chat, /setPending\(current => \[\.\.\.current, item\]\)/);
  assert.match(chat, /MessagingService\.sendText\(id, item\.text, \{ messageId: item\.id, replyToId: item\.replyTo\?\.id \}\)/);
  assert.match(service, /messageId: options\.messageId \|\| generateUUID\(\)/);
});
