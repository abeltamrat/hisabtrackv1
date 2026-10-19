const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Android starts a headless parser for a bank SMS when React is not alive', () => {
  const plugin = read('plugins/withSmsReceiver.js');
  const appConfig = JSON.parse(read('app.json'));

  assert.match(plugin, /val deliveredToReact = HisabSmsModule\.emitSmsReceived\(\)/);
  assert.match(plugin, /if \(!deliveredToReact\) HisabSmsHeadlessService\.start\(context\)/);
  assert.match(plugin, /HeadlessJsTaskConfig\(TASK_NAME, payload, 90_000L, true\)/);
  assert.match(plugin, /HeadlessJsTaskService\.acquireWakeLockNow\(context\)/);
  assert.match(plugin, /sms\.HisabSmsHeadlessService/);
  assert.ok(appConfig.expo.android.permissions.includes('POST_NOTIFICATIONS'));
});

test('headless JavaScript opens the correct user scope before scanning SMS', () => {
  const task = read('services/SmsHeadlessTask.ts');
  const entry = read('index.js');
  const packageJson = JSON.parse(read('package.json'));

  assert.match(task, /await setSessionScope\(scope\)/);
  assert.match(task, /await setDatabaseScope\(scope\)/);
  assert.match(task, /SMSSyncService\.resume\(\)/);
  assert.match(task, /syncAllAccountsBackground/);
  assert.match(entry, /SmsHeadlessTask/);
  assert.equal(packageJson.main, 'index.js');
});

test('Expo prebuild preserves the receiver, headless service and native scope bridge', () => {
  const plugin = read('plugins/withSmsReceiver.js');
  assert.match(plugin, /HisabSmsHeadlessService/);
  assert.match(plugin, /configureScope/);
  assert.match(plugin, /fs\.writeFileSync\(path\.join\(sourceDir, 'HisabSmsHeadlessService\.kt'\)/);
  assert.match(plugin, /application\.service/);
});

test('foreground fallback keeps the receiver configured and consumes queued arrivals automatically', () => {
  const autoSync = read('components/SMSAutoSync.tsx');
  assert.match(autoSync, /useState<boolean \| null>\(null\)/);
  assert.match(autoSync, /if \(smsParsingSelected === null\) return/,
    'startup must preserve the last native configuration until the cloud device choice loads');
  assert.match(autoSync, /NativeSmsReceiver\.consumePendingSignals\(\)/);
  assert.match(autoSync, /if \(pending > 0\) return performSync\(\)/);
  assert.match(autoSync, /NativeSmsReceiver\.subscribe/);
  assert.doesNotMatch(autoSync, /return \(\) => \{ void NativeSmsReceiver\.configureSenders\(\[\]\)/);
});

test('app startup reconciles every SMS account from its durable checkpoint', () => {
  const autoSync = read('components/SMSAutoSync.tsx');
  const syncService = read('services/SMSSyncService.ts');

  assert.match(autoSync, /InteractionManager\.runAfterInteractions/,
    'the initial screen must render before inbox reconciliation begins');
  assert.match(autoSync, /await NativeSmsReceiver\.consumePendingSignals\(\)/);
  assert.match(autoSync, /await performSync\(true\)/,
    'startup must scan even when the native receiver has no queued signal');
  assert.match(autoSync, /incrementalFromCheckpoint[\s\S]*syncAllAccountsBackground\(\)/);
  assert.match(syncService, /getLastSuccessfulSync\(account\.id\)/);
  assert.match(syncService, /scanStartedAt - 60000/,
    'the checkpoint must overlap the previous scan so boundary SMS are not missed');
});
