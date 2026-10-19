const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('local data opens the dashboard before cloud restore finishes', () => {
  const auth = read('contexts/AuthContext.tsx');
  const userReady = auth.indexOf('setUser(firebaseUser ?');
  const dashboardReady = auth.indexOf('setLoading(false);', userReady);
  const cloudPreference = auth.indexOf('CloudProfileService.getCloudSyncEnabled', userReady);
  assert.ok(userReady >= 0 && dashboardReady > userReady && cloudPreference > dashboardReady);
});

test('root navigation follows the authenticated session and startup never returns a blank surface', () => {
  const index = read('app/index.tsx');
  const layout = read('app/_layout.tsx');
  assert.match(index, /const \{ user, loading \} = useAuth\(\)/);
  assert.doesNotMatch(index, /const isAuthenticated = false/);
  assert.match(index, /user \? '\/\(tabs\)' : '\/\(auth\)\/login'/);
  assert.match(layout, /export function ErrorBoundary/);
  assert.match(layout, /Preparing HisabTrack/);
  assert.doesNotMatch(layout, /if \(!onboardingChecked\) \{\s*return null;/);
});

test('optional dashboard analysis waits until startup interactions have settled', () => {
  const dashboard = read('app/(tabs)/index.tsx');
  const deferred = dashboard.indexOf('InteractionManager.runAfterInteractions');
  const analysis = dashboard.indexOf("import('@/services/AppNotificationService')", deferred);
  const mela = dashboard.indexOf("import('@/services/MelaService')", analysis);
  assert.ok(deferred >= 0 && analysis > deferred && mela > analysis);
  assert.match(dashboard.slice(deferred, dashboard.indexOf('}, 15_000);', mela) + 12), /15_000/);
});

test('opening the dashboard defers its checkpointed SMS reconciliation', () => {
  const sms = read('components/SMSAutoSync.tsx');
  assert.doesNotMatch(sms, /setTimeout\(performSync/);
  assert.doesNotMatch(sms, /setInterval\(performSync/);
  assert.doesNotMatch(sms, /nextState === 'active'\) performSync/);
  assert.match(sms, /pending > 0\) return performSync\(\)/);
  assert.match(sms, /InteractionManager\.runAfterInteractions/);
  assert.match(sms, /await performSync\(true\)/);
});
