const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('one account-level device controls automatic SMS parsing', () => {
  const profile = read('services/CloudProfileService.ts');
  const devices = read('services/RemotePushService.ts');
  const autoSync = read('components/SMSAutoSync.tsx');
  const background = read('services/BackgroundService.ts');

  assert.match(profile, /smsParserInstallationId/);
  assert.match(devices, /runTransaction/);
  assert.match(devices, /setCurrentDeviceSmsParsing/);
  assert.match(devices, /refreshCurrentDeviceSmsParser/);
  assert.match(autoSync, /smsParsingSelected/);
  assert.match(autoSync, /configureSenders\(smsSenders\)/);
  assert.match(autoSync, /configureScope\(user\?\.uid \|\| null\)/);
  assert.doesNotMatch(autoSync, /return \(\) => \{ void NativeSmsReceiver\.configureSenders\(\[\]\)/);
  assert.match(autoSync, /!hasSmsRef\.current \|\| !smsParsingSelectedRef\.current/);
  assert.match(background, /thisDeviceParsesSms/);
});

test('settings lists account devices, activity and the SMS parsing role', () => {
  const settings = read('app/settings.tsx');
  const devices = read('services/RemotePushService.ts');

  assert.match(settings, /label: t\('devices'\)/);
  assert.match(settings, /t\('usePhoneSmsParsing'\)/);
  assert.match(settings, /t\('smsParsing'\)/);
  assert.match(settings, /t\('onlineNow'\)/);
  assert.match(settings, /t\('lastActive'\)/);
  assert.match(devices, /subscribeAccountDevices/);
  assert.match(devices, /lastSeenAt/);
});

test('device list is isolated to the currently authenticated account', () => {
  const settings = read('app/settings.tsx');
  const devices = read('services/RemotePushService.ts');
  const rules = read('firestore.rules');

  assert.match(settings, /setAccountDevices\(\[\]\)/);
  assert.match(settings, /AuthService\.getCurrentUser\(\)\?\.uid === subscribedUid/);
  assert.match(devices, /getAuth\(getFirebaseApp\(\)\)\.currentUser\?\.uid === uid/);
  assert.match(devices, /record\.ownerUid === uid/);
  assert.match(rules, /d\.ownerUid == userId && d\.ownerUid == request\.auth\.uid/);
});
