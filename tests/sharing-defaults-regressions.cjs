const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('cloud sync and AI sharing are on by default, once for existing users, and restores keep the device choice', () => {
  const settings = read('contexts/AppSettingsContext.tsx');
  assert.match(settings, /const DEFAULTS: AppSettings = \{\s*cloudSyncEnabled: true,\s*aiSharingEnabled: true,\s*sharingDefaultsApplied: true,/);
  assert.match(settings, /if \(!saved \|\| \(saved as AppSettings\)\.sharingDefaultsApplied\) return merged;/, 'only settings saved before the default are upgraded, once');
  assert.equal((settings.match(/applySharingDefaults\((parsed|saved), merged as AppSettings\)/g) || []).length, 2, 'web and native loads both apply it');
  const profile = read('services/CloudProfileService.ts');
  assert.match(profile, /if \(snapshot\.data\(\)\?\.sharingDefaultsApplied !== true\) return null;/, 'an old cloud "off" does not override the new default');
  assert.match(profile, /sharingDefaultsApplied: true,/);
  assert.match(read('services/RestoreService.ts'), /cloudSyncEnabled: current\.cloudSyncEnabled, aiSharingEnabled: current\.aiSharingEnabled/);
  // Backup files still never carry the switches.
  assert.match(read('services/BackupService.ts'), /cloudSyncEnabled: false, aiSharingEnabled: false, puterJsEnabled: false/);
});
