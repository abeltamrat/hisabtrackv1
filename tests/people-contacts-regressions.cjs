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
  assert.ok(
    picker.indexOf('setContacts(result.contacts); setLoading(false)')
      < picker.indexOf('await DeviceContactsService.discoverLinkedContacts'),
  );
  assert.match(picker, /<FlatList/);
  assert.doesNotMatch(picker, /shown\.map\(/);
});
