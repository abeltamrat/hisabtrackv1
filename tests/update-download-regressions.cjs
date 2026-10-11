const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'UpdateService.ts'), 'utf8');

test('the APK download survives low storage and overlapping update dialogs', () => {
  // Cache can be purged by Android mid-verification; app storage cannot.
  assert.match(source, /const targetDirectory = FileSystem\.documentDirectory \?\? FileSystem\.cacheDirectory;/);
  // One binary install at a time: a second dialog shares the running download.
  assert.match(source, /if \(activeBinaryInstall\) \{[\s\S]*?return activeBinaryInstall;/);
  assert.match(source, /activeBinaryInstall = this\.runInstall\(updateInfo, onProgress\)\.finally\(\(\) => \{ activeBinaryInstall = null; \}\);/);
  // The installed APK is removed once the phone runs that version.
  assert.match(source, /if \(!hasNewerBinary && !isRequired\) \{\s*void this\.removeDownloadedApk\(currentVersion\);/);
});
