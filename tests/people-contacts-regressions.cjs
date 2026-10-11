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
