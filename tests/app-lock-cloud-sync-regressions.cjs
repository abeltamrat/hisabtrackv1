const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('app lock policy and verifier follow the signed-in account in real time', () => {
  const context = read('contexts/AppLockContext.tsx');
  const profile = read('services/CloudProfileService.ts');
  const lock = read('services/AppLockService.ts');

  assert.match(profile, /setAppLockPolicy/);
  assert.match(profile, /subscribeAppLockPolicy/);
  assert.match(profile, /onSnapshot/);
  assert.match(context, /user\?\.uid/);
  assert.match(context, /publishCloudPolicy/);
  assert.match(context, /applyCloudPolicy/);
  assert.match(lock, /getPinVerifier/);
  assert.match(lock, /setPinVerifier/);
  assert.match(lock, /PENDING_CLOUD_POLICY_KEY/);
  assert.doesNotMatch(profile, /appLockPin\s*:/);
});

test('biometric preference remains device specific', () => {
  const profile = read('services/CloudProfileService.ts');
  const settings = read('app/settings.tsx');
  assert.doesNotMatch(profile, /biometricEnabled/);
  assert.match(settings, /this device’s biometric/i);
});
