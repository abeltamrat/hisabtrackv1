const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('Android builds include the guarded update installer module', () => {
  const app = JSON.parse(read('app.json')).expo;
  assert.ok(app.plugins.includes('./plugins/withUpdateInstaller'));
  assert.ok(app.android.permissions.includes('REQUEST_INSTALL_PACKAGES'));

  const plugin = read('plugins/withUpdateInstaller.js');
  assert.match(plugin, /canRequestPackageInstalls\(\)/);
  assert.match(plugin, /archive\.packageName != reactApplicationContext\.packageName/);
  assert.match(plugin, /archiveBuild <= versionCode\(installed\)/);
  assert.match(plugin, /installedCertificates\.intersect\(archiveCertificates\)\.isEmpty\(\)/);
});

test('the assisted installer checks permission and identity before opening an APK', () => {
  const service = read('services/UpdateService.ts');
  const permission = service.indexOf('const installPermission = await this.canRequestPackageInstalls()');
  const download = service.indexOf('FileSystem.createDownloadResumable');
  const validation = service.indexOf('await NativeInstaller.validateApk');
  const installer = service.indexOf("startActivityAsync('android.intent.action.VIEW'");

  assert.ok(permission > 0 && permission < download, 'permission must be checked before download');
  assert.ok(validation > download && validation < installer, 'identity must be checked before installer handoff');
  assert.match(service, /if \(!updateInfo\.expectedSha256\)[\s\S]*?openUpdateUrl/);
});

test('the update notice uses the coin and provides browser fallback', () => {
  const modal = read('components/UpdateModal.tsx');
  assert.match(modal, /<UpdateCoinBadge \/>/);
  assert.match(modal, /Download in Browser/);
  assert.match(modal, /Check Permission & Continue/);
  assert.match(modal, /status\.progress/);
});
