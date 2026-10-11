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

test('runtime 1.0.4 has a checksum-pinned installer bridge to the signed 1.0.5 APK', () => {
  const config = read('app.config.js');
  const service = read('services/UpdateService.ts');
  assert.match(config, /HISAB_RUNTIME_VERSION_OVERRIDE/);
  assert.match(service, /latestVersion: '1\.0\.5'/);
  assert.match(service, /latestBuildNumber: 103/);
  assert.match(service, /releases\/download\/v1\.0\.5\/hisabtrack-1\.0\.5-build-103\.apk/);
  assert.match(service, /androidSha256: 'a9e4ef028d71166714008ea44eba4062fcdd191e102829110091c14f9e77098a'/);
  assert.match(service, /androidSize: 103295634/);
  assert.match(service, /legacyVerifiedInstaller: true/);
  assert.match(service, /legacyVerifiedInstaller: usingBundledBridge && Boolean\(data\.legacyVerifiedInstaller\)/);
  assert.match(service, /\(!NativeInstaller && !updateInfo\.legacyVerifiedInstaller\)/);
  assert.match(service, /if \(NativeInstaller\)[\s\S]*?NativeInstaller\.validateApk/);
});

test('APK verification hashes bounded chunks instead of loading the whole file', () => {
  const service = read('services/UpdateService.ts');
  assert.match(service, /sha256\.create\(\)/);
  assert.match(service, /const chunkSize = 1024 \* 1024/);
  assert.match(service, /handle\.readBytes\(Math\.min\(chunkSize, file\.size - bytesRead\)\)/);
  assert.match(service, /handle\.close\(\)/);
  assert.doesNotMatch(service, /await file\.bytes\(\)/);
});

test('a complete cached APK is verified and reused after a failed install attempt', () => {
  const service = read('services/UpdateService.ts');
  assert.match(service, /const canReuseDownload = existingFile\.exists/);
  assert.match(service, /existingFile\.size === updateInfo\.expectedSize/);
  assert.match(service, /if \(!canReuseDownload && FileSystem\.deleteAsync\)/);
  assert.match(service, /message: 'Using the completed update download\.\.\.'/);
  assert.match(service, /verifyDownloadedPackage\(downloadedUri/);
});
