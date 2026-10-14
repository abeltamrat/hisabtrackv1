const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('people create and edit flows can import phone contacts', () => {
  const picker = read('components/PersonPicker.tsx');
  const detail = read('app/people/[id].tsx');
  assert.match(picker, /Add from phone contacts/);
  assert.match(picker, /PhoneContactPicker/);
  assert.match(detail, /Choose from phone contacts/);
  assert.match(detail, /PhoneContactPicker/);
});

test('contact access is requested only by the contact service and registered contacts use the coin-link badge', () => {
  const service = read('services/DeviceContactsService.ts');
  const picker = read('components/PhoneContactPicker.tsx');
  const config = JSON.parse(read('app.json'));
  assert.match(service, /requestPermissionsAsync/);
  assert.match(service, /discoverLinkedContacts/);
  assert.match(picker, /hisab-coin-icon\.png/);
  assert.match(picker, /name="link"/);
  assert.ok(config.expo.plugins.some(plugin => Array.isArray(plugin) && plugin[0] === 'expo-contacts'));
  assert.ok(config.expo.android.permissions.includes('READ_CONTACTS'));
  assert.ok(config.expo.android.blockedPermissions.includes('android.permission.WRITE_CONTACTS'));
});

test('phone contacts render before badge discovery and use a virtualized cached list', () => {
  const service = read('services/DeviceContactsService.ts');
  const picker = read('components/PhoneContactPicker.tsx');
  assert.match(service, /requestAndLoadLocal/);
  assert.match(service, /LOCAL_CACHE_MS/);
  assert.match(service, /DISCOVERY_CACHE_MS/);
  assert.match(picker, /setContacts\(result\.contacts\); setLoading\(false\)/);
  assert.match(picker, /await DeviceContactsService\.discoverLinkedContacts/);
  const initialLoad = picker.slice(picker.indexOf('const load = async'), picker.indexOf('void load()'));
  assert.ok(
    initialLoad.indexOf('setContacts(result.contacts); setLoading(false)')
      < initialLoad.indexOf('await DeviceContactsService.discoverLinkedContacts'),
  );
  assert.match(picker, /<FlatList/);
  assert.doesNotMatch(picker, /shown\.map\(/);
  assert.match(service, /DISCOVERY_CACHE_MS = 60 \* 1000/);
  assert.doesNotMatch(service, /catch \{\s*discoveryCache =/s, 'failed discovery must never be cached as an empty success');
  assert.match(picker, /Check again/);
});

test('phone contacts can be filtered to discovered HisabTrack users', () => {
  const picker = read('components/PhoneContactPicker.tsx');
  assert.match(picker, /HisabTrack users only/);
  assert.match(picker, /accessibilityRole="checkbox"/);
  assert.match(picker, /hisabTrackOnly && !contact\.linkedAccount/);
  assert.match(picker, /setHisabTrackOnly\(false\)/);
});

test('a number saved in Settings gives a weaker, non-linking HisabTrack badge', () => {
  const fns = read('functions/index.js');
  assert.match(fns, /collectionGroup\('meta'\)\.where\('phoneNumber', 'in', batch\)/);
  assert.match(fns, /verified: true \}\);/);
  assert.match(fns, /verified: false \}\);/);
  assert.match(fns, /if \(saved\.size !== 1\) continue;/, 'a number claimed by several accounts is not a match');
  const indexes = JSON.parse(read('firestore.indexes.json'));
  assert.ok(indexes.fieldOverrides.some(o => o.collectionGroup === 'meta' && o.fieldPath === 'phoneNumber' && o.indexes.some(i => i.queryScope === 'COLLECTION_GROUP')));
  assert.match(read('components/PhoneContactPicker.tsx'), /<HisabContactBadge verified=\{contact\.linkedAccount\.verified\} \/>/);
  assert.match(read('components/PersonPicker.tsx'), /setImportedLinkedAccount\(contact\.linkedAccount\?\.verified \? contact\.linkedAccount : undefined\)/, 'only verified matches link accounts');
});

test('the signed-in user is recognized locally and saved phones are not shown as verified', () => {
  const service = read('services/DeviceContactsService.ts');
  const settings = read('app/settings.tsx');
  assert.match(service, /const savedPhone = normalizePersonPhone\(\(await AuthService\.getUserPhone\(currentUser\.uid\)\) \?\? undefined\)/);
  assert.match(service, /contact\.phones\.includes\(savedPhone\)/);
  assert.match(service, /verified: matchesVerifiedPhone \|\| matchesVerifiedEmail/);
  assert.match(service, /contacts: contacts\.map\(contact => \(\{ \.\.\.contact, linkedAccount: selfMatches\.get\(contact\.id\) \}\)\)/);
  assert.match(settings, /isProfilePhoneVerified \? 'Verified' : 'Saved'/);
});

test('messaging can resolve a discovered app user without falsely verifying the saved person', () => {
  const service = read('services/DeviceContactsService.ts');
  const messages = read('app/messages/index.tsx');
  assert.match(service, /discoverLinkedPerson/);
  assert.match(service, /discoverLinkedContacts\(\[contact\], true\)/, 'messaging should bypass stale contact discovery cache');
  assert.match(messages, /DeviceContactsService\.discoverLinkedPerson\(person\)/);
  assert.match(messages, /MessagingService\.startConversation\(discovered\.uid\)/);
  assert.match(messages, /if \(!person\.linkedUid && discovered\.verified\)/, 'only a verified discovery may be persisted as a linked identity');
});
