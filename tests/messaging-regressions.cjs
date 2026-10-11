const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('global header places messages before notifications and shows unread state', () => {
  const source = read('components/AppShell.tsx');
  assert.ok(source.indexOf('router.push(\'/messages\'') < source.indexOf('onPress={togglePreview}'));
  assert.match(source, /listenUnreadCount/);
  assert.match(source, /Messages, \$\{messageUnreadCount\} unread/);
});

test('message requests never create financial records directly', () => {
  const backend = read('functions/index.js');
  const messaging = backend.slice(backend.indexOf('exports.mutateConversation'));
  assert.doesNotMatch(messaging, /users\/\$\{[^}]+\}\/transactions|sharedLoans\/|sharedFunds\//);
  assert.match(messaging, /status: 'PENDING'/);
  assert.match(read('docs/MESSAGING_AND_REQUESTS_PLAN.md'), /never posts a transaction/i);
});

test('conversation writes are callable-only and reads require membership', () => {
  const rules = read('firestore.rules');
  const block = rules.slice(rules.indexOf('match /conversations/'));
  assert.match(block, /request\.auth\.uid in resource\.data\.participantUids/);
  assert.match(block, /allow write: if false/);
});
