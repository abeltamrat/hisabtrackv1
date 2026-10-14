const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('critical auxiliary datasets are versioned, hashed and restored', () => {
  const source = fs.readFileSync(path.join(root, 'services/AuxiliarySyncService.ts'), 'utf8');
  for (const name of ['communityGroups','recurringItems','goals','drafts','smsLearning','recipientProfiles']) assert.match(source, new RegExp(`'${name}'`));
  assert.match(source, /CryptoDigestAlgorithm\.SHA256/);
  assert.match(source, /remoteRevision/);
  assert.match(source, /last_restore_report/);
  assert.match(source, /mergeConcurrentRecords/);
  assert.match(source, /recordHashes/);
  assert.match(source, /direction: 'MERGED'/);
  assert.match(source, /resolution: 'RECORD_MERGE'/);
  assert.doesNotMatch(source, /throw new Error\(`Cloud conflict in \$\{dataset\}/);
});

test('fresh login opens local data before cloud restore and cloud preference follows the user', () => {
  const auth = fs.readFileSync(path.join(root, 'contexts/AuthContext.tsx'), 'utf8');
  const profile = fs.readFileSync(path.join(root, 'services/CloudProfileService.ts'), 'utf8');
  assert.match(auth, /Restoring your cloud data/);
  const userReady = auth.indexOf('setUser(firebaseUser ?');
  assert.ok(auth.indexOf('setLoading(false)', userReady) < auth.indexOf('await SyncService.syncNow', userReady));
  assert.match(profile, /cloudSyncEnabled/);
});

test('scheduled backup configuration and recovery drill are checked in', () => {
  const script = fs.readFileSync(path.join(root, 'scripts/configure-firestore-backups.ps1'), 'utf8');
  const runbook = fs.readFileSync(path.join(root, 'docs/FIRESTORE_RECOVERY_RUNBOOK.md'), 'utf8');
  assert.match(script, /retention=14d/);
  assert.match(script, /retention=14w/);
  assert.match(script, /recurrence=daily/);
  assert.match(script, /recurrence=weekly/);
  assert.match(runbook, /temporary database/i);
  assert.match(runbook, /hash/i);
});

test('top bar reports offline, pending and fully synced cloud states', () => {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const shell = read('components/AppShell.tsx');
  const sync = read('services/SyncService.ts');
  const internet = read('services/InternetStatusService.ts');
  assert.match(shell, /syncState === 'synced'/);
  assert.match(shell, /'#22c55e'/);
  assert.match(shell, /'#eab308'/);
  assert.match(shell, /'#475569'/);
  assert.match(sync, /setStatus\('pending'\)/);
  assert.match(sync, /setStatus\('syncing'\)/);
  assert.match(sync, /setStatus\('synced'\)/);
  assert.match(sync, /setStatus\('error'\)/);
  assert.match(internet, /generate_204/);
});

test('AI keys and issued Mela connections follow the account through a server-only vault', () => {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const sync = read('services/SyncService.ts');
  const privateConfig = read('services/PrivateConfigurationService.ts');
  const functions = read('functions/index.js');
  const rules = read('firestore.rules');
  assert.match(sync, /PrivateConfigurationService/);
  for (const provider of ['geminiApiKey', 'groqApiKey', 'openRouterApiKey', 'topToolsApiKey']) assert.match(privateConfig, new RegExp(provider));
  assert.match(privateConfig, /restorePortableConnection/);
  assert.match(functions, /managePrivateConfiguration/);
  assert.match(functions, /privateConfigurations\/\$\{uid\}/);
  assert.match(rules, /match \/privateConfigurations\/\{userId\} \{ allow read, write: if false; \}/);
});

test('guided category builder asks questions and saves a reviewed deep hierarchy atomically', () => {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const builder = read('components/AICategoryBuilder.tsx');
  const service = read('services/AICategoryService.ts');
  const context = read('context/TransactionContext.tsx');
  assert.match(builder, /What are you organizing/);
  assert.match(builder, /Where does money come from/);
  assert.match(builder, /What do you spend most on/);
  assert.match(builder, /regular commitments/);
  assert.match(builder, /Review \{selected\.size\}/);
  assert.match(service, /parentTempId/);
  assert.match(service, /Equb/);
  assert.match(service, /Iddir/);
  assert.match(context, /addCategoryHierarchy/);
  assert.match(context, /saveCategories\(next\)/);
});

test('category rows keep destructive actions in an explicit menu', () => {
  const source = fs.readFileSync(path.join(root, 'app/categories.tsx'), 'utf8');
  assert.doesNotMatch(source, /PanResponder|SWIPE_REVEAL|translateX/);
  assert.match(source, /More actions for/);
  assert.match(source, /Choose a category action/);
});

test('mixed cloud currencies are relabeled one-for-one without blocking startup', () => {
  const sync = fs.readFileSync(path.join(root, 'services/SyncService.ts'), 'utf8');
  const auth = fs.readFileSync(path.join(root, 'contexts/AuthContext.tsx'), 'utf8');
  assert.match(sync, /protectMixedCurrencies/);
  assert.match(sync, /numeric amounts were not converted/);
  assert.match(sync, /relabelCurrency\(protectedChanges\.relabelTo, true\)/);
  assert.match(auth, /Cloud recovery problems must not lock/);
  assert.match(auth, /catch \(syncError\)/);
});
